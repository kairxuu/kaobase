import Foundation
import Observation

/// App-owned state: changing tabs never cancels an answer or discards a draft.
@MainActor @Observable
final class ChatStore {
    struct Thread: Codable, Identifiable {
        var id: String
        var messages: [ChatMessage] = []
        var draft = ""
        var updatedAt = Date()
        var pendingSince: Date?
        var savedOnServer: Bool?
        var title: String { String((messages.first(where: \.isUser)?.text ?? draft).trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)) }
    }
    private struct Archive: Codable { var activeId: String; var threads: [String: Thread] }
    var activeId = UUID().uuidString.lowercased()
    private(set) var threads: [String: Thread] = [:]
    private(set) var history: [ConversationSummary] = []
    private(set) var sending = false
    private(set) var loading = false
    var error: String?
    var storageError: String?
    private var userId: String?
    private var client: APIClient?
    private var directory: URL
    private var generation = 0
    private var recovering: Set<String> = []
    private var demo = false
    var current: Thread { threads[activeId] ?? Thread(id: activeId) }
    var messages: [ChatMessage] { current.messages }
    var busy: Bool { sending || current.pendingSince != nil }
    var draft: String {
        get { current.draft }
        set { var thread = current; thread.draft = String(newValue.prefix(4000)); thread.updatedAt = Date(); threads[activeId] = thread; persist() }
    }
    var entries: [ConversationSummary] {
        var rows = Dictionary(uniqueKeysWithValues: history.map { ($0.id, $0) })
        for thread in threads.values where !thread.title.isEmpty {
            let local = ConversationSummary(id: thread.id, title: thread.title, lastAt: ISO8601DateFormatter().string(from: thread.updatedAt))
            if rows[thread.id] == nil || local.lastAt > rows[thread.id]!.lastAt { rows[thread.id] = local }
        }
        return rows.values.sorted { $0.lastAt > $1.lastAt }
    }
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Conversations", isDirectory: true)
    }
    func configure(userId: String?, client: APIClient?, demo: Bool = false) {
        guard self.userId != userId || self.demo != demo else { self.client = client; return }
        generation += 1; self.userId = userId; self.client = client; self.demo = demo
        threads = [:]; history = []; sending = false; loading = false; recovering = []; error = nil; storageError = nil
        activeId = UUID().uuidString.lowercased()
        guard let file, FileManager.default.fileExists(atPath: file.path) else { return }
        do {
            let archive = try JSONDecoder().decode(Archive.self, from: Data(contentsOf: file))
            threads = archive.threads; activeId = archive.activeId
        } catch { storageError = "Le brouillon local n’a pas pu être ouvert. L’historique enregistré reste disponible." }
    }
    private var file: URL? {
        guard let userId, !demo else { return nil }
        // Identity never becomes an arbitrary path component.
        let name = Data(userId.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
        return directory.appendingPathComponent(name + ".json")
    }
    private func persist() {
        guard let file else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var folder = directory
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try folder.setResourceValues(values)
            let data = try JSONEncoder().encode(Archive(activeId: activeId, threads: threads))
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            storageError = nil
        } catch { storageError = "Le brouillon ne peut pas être sauvegardé sur cet iPhone pour le moment." }
    }
    func newConversation() {
        guard !sending else { return }
        activeId = UUID().uuidString.lowercased(); threads[activeId] = Thread(id: activeId); error = nil; persist()
    }
    func select(_ id: String) async {
        activeId = id; error = nil; persist()
        await refreshCurrent()
    }
    func refreshHistory() async {
        guard !demo, let client else { return }
        let version = generation
        do {
            let rows: [ConversationSummary] = try await client.request("conversations")
            guard version == generation else { return }
            history = rows
            let serverIds = Set(rows.map(\.id))
            // Respect deletions made on the web; retain an unsent draft as a new thread.
            for (id, thread) in threads where thread.savedOnServer == true && !serverIds.contains(id) && thread.pendingSince == nil && !sending {
                threads.removeValue(forKey: id)
                if !thread.draft.isEmpty {
                    let replacement = UUID().uuidString.lowercased()
                    threads[replacement] = Thread(id: replacement, draft: thread.draft)
                    if activeId == id { activeId = replacement }
                } else if activeId == id { activeId = UUID().uuidString.lowercased() }
            }
            for id in serverIds { threads[id]?.savedOnServer = true }
            persist()
            if threads.isEmpty, let first = rows.first { activeId = first.id; persist() }
        } catch { if version == generation { self.error = error.localizedDescription } }
    }
    func refreshCurrent() async {
        guard !demo, client != nil else { return }
        loading = true; let version = generation, id = activeId
        await fetchThread(id)
        guard version == generation else { return }
        loading = false
        recover(id)
    }
    private func recover(_ id: String) {
        guard threads[id]?.pendingSince != nil, !sending, !recovering.contains(id) else { return }
        recovering.insert(id)
        let version = generation
        Task {
            defer { if version == generation { recovering.remove(id) } }
            while version == generation, !sending, let start = threads[id]?.pendingSince {
                if Date().timeIntervalSince(start) > 100 {
                    threads[id]?.pendingSince = nil; persist()
                    if activeId == id { error = "La réponse n’est pas encore disponible. Actualise l’historique avant de renvoyer une demande." }
                    break
                }
                try? await Task.sleep(for: .seconds(4))
                guard version == generation else { return }
                await fetchThread(id)
            }
        }
    }
    private func fetchThread(_ id: String) async {
        guard let client else { return }
        let version = generation
        do {
            let detail: ConversationDetail = try await client.request("conversations/" + id)
            guard version == generation else { return }
            var thread = threads[id] ?? Thread(id: id)
            if !detail.messages.isEmpty { thread.savedOnServer = true }
            let server = detail.messages.map { ChatMessage(text: $0.content, isUser: $0.role == "user") }
            // Keep an unsaved draft/request while a server write is still in flight.
            if server.count >= thread.messages.count {
                thread.messages = server
                if server.last?.isUser == false { thread.pendingSince = nil }
            }
            for index in thread.messages.indices { thread.messages[index].deletions = [] }
            if let index = thread.messages.lastIndex(where: { !$0.isUser }) { thread.messages[index].deletions = detail.deletions }
            threads[id] = thread; persist()
        } catch { if version == generation { self.error = error.localizedDescription } }
    }
    func send(space: String) async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 4000, !busy else { return }
        guard !demo, let client else { error = "Connecte-toi pour discuter avec l’assistant."; return }
        let id = activeId, version = generation
        var thread = current; thread.draft = ""; thread.messages.append(ChatMessage(text: text, isUser: true))
        thread.pendingSince = Date(); thread.updatedAt = Date(); threads[id] = thread
        sending = true; error = nil; persist()
        defer { if version == generation { sending = false } }
        do {
            let reply: AgentReply = try await client.request("agents", method: "POST", payload: ["message": .string(text), "conversationId": .string(id), "agent": .string("auto"), "space": .string(space)])
            guard version == generation else { return }
            var result = threads[id] ?? thread
            if result.messages.count <= thread.messages.count {
                result.messages.append(ChatMessage(text: reply.text, isUser: false, deletions: reply.deletions))
            } else if let last = result.messages.lastIndex(where: { !$0.isUser }) {
                result.messages[last].deletions = reply.deletions
            }
            result.pendingSince = nil; result.updatedAt = Date(); threads[id] = result; persist()
            await refreshHistory()
        } catch {
            guard version == generation else { return }
            // A timeout is ambiguous: never automatically replay an action.
            self.error = error.localizedDescription
            sending = false
            await fetchThread(id)
            recover(id)
        }
    }
    func remove(_ id: String) async throws {
        guard !sending, threads[id]?.pendingSince == nil else { throw AppError.server("Attends la fin de la réponse avant de supprimer cette conversation.") }
        let version = generation
        if !demo {
            guard let client else { throw AppError.configuration }
            let _: Success = try await client.request("conversations/" + id, method: "DELETE")
        }
        guard version == generation else { return }
        threads.removeValue(forKey: id); history.removeAll { $0.id == id }
        if activeId == id { activeId = UUID().uuidString.lowercased() }
        persist()
    }
    func decide(_ deletion: AgentDeletion, confirm: Bool) async throws {
        guard let client else { throw AppError.configuration }
        let id = activeId, version = generation
        let _: Success = try await client.request("agents/decision", method: "POST", payload: ["requestId": .string(deletion.id), "conversationId": .string(id), "decision": .string(confirm ? "confirm" : "cancel")])
        guard version == generation else { return }
        var thread = threads[id] ?? Thread(id: id)
        for index in thread.messages.indices { thread.messages[index].deletions.removeAll { $0.id == deletion.id } }
        threads[id] = thread; persist()
    }
}
