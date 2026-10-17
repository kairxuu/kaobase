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
