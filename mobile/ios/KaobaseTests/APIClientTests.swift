import XCTest
@testable import Kaobase

private final class MemoryStorage: SessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var session: AuthSession?
    init(expired: Bool) {
        session = AuthSession(accessToken: "user-access", refreshToken: "user-refresh", expiresAt: Date().addingTimeInterval(expired ? -1 : 3600), user: AuthUser(id: "test", email: nil))
    }
    func read() -> AuthSession? { lock.withLock { session } }
    func save(_ value: AuthSession) { lock.withLock { session = value } }
    func clear() { lock.withLock { session = nil } }
}
private final class StubState: @unchecked Sendable {
    private let lock = NSLock()
    var requests: [URLRequest] { lock.withLock { history } }
    private var history: [URLRequest] = []
    private var handler: (@Sendable (URLRequest) throws -> (Int, String))?
    func set(_ handler: @escaping @Sendable (URLRequest) throws -> (Int, String)) { lock.withLock { self.handler = handler; history = [] } }
    func response(_ request: URLRequest) throws -> (Int, String) {
        let callback = lock.withLock { history.append(request); return handler }
        return try callback!(request)
    }
}
private final class StubProtocol: URLProtocol, @unchecked Sendable {
    static let state = StubState()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.state.response(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
final class APIClientTests: XCTestCase {
    private func api(storage: MemoryStorage) throws -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return APIClient(configuration: try AppConfiguration(website: "https://app.example.test"), transport: URLSession(configuration: config), storage: storage)
    }
    func testBackendReceivesOnlyBearerAndEncodedQuery() async throws {
        let storage = MemoryStorage(expired: false)
        let api = try api(storage: storage)
        _ = try await api.restore()
        StubProtocol.state.set { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer user-access")
            XCTAssertNil(request.value(forHTTPHeaderField: "apikey"))
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "café & thé")
            return (200, "{\"ok\":true}")
        }
        let response: Success = try await api.request("tasks", query: [.init(name: "search", value: "café & thé")])
        XCTAssertTrue(response.ok)
        XCTAssertEqual(StubProtocol.state.requests.count, 1)
    }
    func testConcurrentRequestsRotateRefreshTokenOnlyOnce() async throws {
        let storage = MemoryStorage(expired: true)
        let api = try api(storage: storage)
        _ = try await api.restore()
        StubProtocol.state.set { request in
            if request.url!.path.contains("/auth/refresh") {
                Thread.sleep(forTimeInterval: 0.1)
                return (200, #"{"access_token":"rotated-access","refresh_token":"rotated-refresh","expires_in":3600,"user":{"id":"test"}}"#)
            }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer rotated-access")
            return (200, "{\"ok\":true}")
        }
        async let first: Success = api.request("one")
        async let second: Success = api.request("two")
        let results = try await [first, second]
        XCTAssertTrue(results.allSatisfy(\.ok))
        XCTAssertEqual(StubProtocol.state.requests.filter { $0.url!.path.contains("/auth/refresh") }.count, 1)
        XCTAssertEqual(storage.read()?.refreshToken, "rotated-refresh")
    }
    func testTransientAuthOutageKeepsSessionForRetry() async throws {
        let storage = MemoryStorage(expired: true)
        let api = try api(storage: storage)
        _ = try await api.restore()
        StubProtocol.state.set { _ in (503, "{}") }
        do { let _: Success = try await api.request("overview"); XCTFail("Expected failure") } catch {}
        XCTAssertEqual(storage.read()?.refreshToken, "user-refresh")
    }
    func testRejectedRefreshClearsSession() async throws {
        let storage = MemoryStorage(expired: true)
        let api = try api(storage: storage)
        _ = try await api.restore()
        StubProtocol.state.set { _ in (400, #"{"code":"SESSION_EXPIRED"}"#) }
        do { let _: Success = try await api.request("overview"); XCTFail("Expected failure") } catch {}
        XCTAssertNil(storage.read())
    }
}

@MainActor
final class ChatStoreTests: XCTestCase {
    private func api() async throws -> APIClient {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let api = APIClient(configuration: try AppConfiguration(website: "https://app.example.test"), transport: URLSession(configuration: config), storage: MemoryStorage(expired: false))
        _ = try await api.restore(); return api
    }
    func testDraftAndActiveConversationSurviveRelaunchAndAreIsolatedByUser() async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let first = ChatStore(directory: folder); first.configure(userId: "alice", client: nil)
        let id = first.activeId; first.draft = "Mon brouillon personnel"
        first.newConversation(); let secondId = first.activeId
        first.draft = "Deuxième brouillon"
        XCTAssertEqual(first.entries.count, 2)
        let restored = ChatStore(directory: folder); restored.configure(userId: "alice", client: nil)
        XCTAssertEqual(restored.activeId, secondId)
        XCTAssertEqual(restored.draft, "Deuxième brouillon")
        await restored.select(id)
        XCTAssertEqual(restored.draft, "Mon brouillon personnel")
        restored.configure(userId: "bob", client: nil)
        XCTAssertTrue(restored.draft.isEmpty); XCTAssertTrue(restored.entries.isEmpty)
        restored.configure(userId: "alice", client: nil)
        XCTAssertEqual(restored.activeId, id); XCTAssertEqual(restored.draft, "Mon brouillon personnel")
        XCTAssertNil(restored.storageError)
    }
    func testAnswerSurvivesSelectingAnotherConversationAndDoesNotReplayOnRestore() async throws {
        let client = try await api()
        StubProtocol.state.set { request in
            if request.httpMethod == "POST" { Thread.sleep(forTimeInterval: 0.15); return (200, #"{"text":"Réponse conservée","agent":"finance","deletions":[]}"#) }
            if request.url!.path.hasSuffix("/conversations") { return (200, "[]") }
            return (200, #"{"messages":[],"deletions":[]}"#)
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = ChatStore(directory: folder); store.configure(userId: "alice", client: client)
        let original = store.activeId; store.draft = "Bonjour"
        let send = Task { await store.send(space: "all") }
        try await Task.sleep(for: .milliseconds(30))
        await store.select(UUID().uuidString.lowercased())
        await send.value
        XCTAssertEqual(store.threads[original]?.messages.last?.text, "Réponse conservée")
        XCTAssertTrue(store.messages.isEmpty)
        let restored = ChatStore(directory: folder); restored.configure(userId: "alice", client: client)
        await restored.select(original)
        XCTAssertEqual(restored.messages.count, 2)
        XCTAssertEqual(StubProtocol.state.requests.filter { $0.httpMethod == "POST" }.count, 1)
        XCTAssertFalse(restored.busy)
    }
    func testLateAnswerAfterLogoutCannotLeakIntoNextAccount() async throws {
        let client = try await api()
        StubProtocol.state.set { _ in Thread.sleep(forTimeInterval: 0.15); return (200, #"{"text":"Privé","agent":"finance","deletions":[]}"#) }
        let store = ChatStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        store.configure(userId: "alice", client: client); store.draft = "Question privée"
        let send = Task { await store.send(space: "all") }
        try await Task.sleep(for: .milliseconds(30))
        store.configure(userId: "bob", client: client)
        await send.value
        XCTAssertTrue(store.messages.isEmpty); XCTAssertTrue(store.entries.isEmpty); XCTAssertFalse(store.sending)
    }
    func testDeletingDraftRequiresExplicitCallAndRemovesItFromRestoredHistory() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let client = try await api()
        StubProtocol.state.set { _ in (200, "{\"ok\":true}") }
        let store = ChatStore(directory: folder); store.configure(userId: "alice", client: client)
        store.draft = "À supprimer"; let original = store.activeId
        store.newConversation()
        XCTAssertEqual(store.entries.count, 1)
        try await store.remove(original)
        XCTAssertTrue(store.entries.isEmpty)
        let restored = ChatStore(directory: folder); restored.configure(userId: "alice", client: client)
        XCTAssertTrue(restored.entries.isEmpty)
        XCTAssertEqual(StubProtocol.state.requests.filter { $0.httpMethod == "DELETE" }.count, 1)
    }
}


extension ChatStoreTests {
    func testInterruptedAnswerRecoversFromServerWithoutReplayingAction() async throws {
        let client = try await api()
        StubProtocol.state.set { request in
            XCTAssertEqual(request.httpMethod, "GET")
            return (200, #"{"messages":[{"role":"user","content":"Ma question"},{"role":"assistant","content":"Terminée"}],"deletions":[]}"#)
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let id = UUID().uuidString.lowercased()
        struct Saved: Encodable { let activeId: String; let threads: [String: ChatStore.Thread] }
        let thread = ChatStore.Thread(id: id, messages: [ChatMessage(text: "Ma question", isUser: true)], pendingSince: Date())
        let file = folder.appendingPathComponent(Data("alice".utf8).base64EncodedString() + ".json")
        try JSONEncoder().encode(Saved(activeId: id, threads: [id: thread])).write(to: file)
        let store = ChatStore(directory: folder); store.configure(userId: "alice", client: client)
        XCTAssertTrue(store.busy)
        await store.refreshCurrent()
        XCTAssertFalse(store.busy)
        XCTAssertEqual(store.messages.last?.text, "Terminée")
        XCTAssertEqual(StubProtocol.state.requests.count, 1)
    }
    func testStorageFailurePreservesDraftAndIsVisible() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data("not a directory".utf8).write(to: file)
        let store = ChatStore(directory: file); store.configure(userId: "alice", client: nil)
        store.draft = "Ne pas perdre ce texte"
        XCTAssertEqual(store.draft, "Ne pas perdre ce texte")
        XCTAssertNotNil(store.storageError)
    }
}


extension ChatStoreTests {
    func testWebDeletionDoesNotResurrectCachedMessagesButKeepsUnsentDraft() async throws {
        let client = try await api(), id = UUID().uuidString.lowercased()
        StubProtocol.state.set { request in
            if request.url!.path.hasSuffix("/conversations") { return (200, "[{\"id\":\"" + id + "\",\"title\":\"Question\",\"lastAt\":\"2026-10-18\"}]") }
            return (200, #"{"messages":[{"role":"user","content":"Question"},{"role":"assistant","content":"Réponse"}],"deletions":[]}"#)
        }
        let store = ChatStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        store.configure(userId: "alice", client: client)
        await store.refreshHistory(); await store.refreshCurrent()
        XCTAssertEqual(store.messages.count, 2)
        store.draft = "Brouillon à garder"
        StubProtocol.state.set { _ in (200, "[]") }
        await store.refreshHistory()
        XCTAssertNil(store.threads[id])
        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertEqual(store.draft, "Brouillon à garder")
        XCTAssertNotEqual(store.activeId, id)
    }
}
