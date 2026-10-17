import Foundation
import Observation

@MainActor @Observable
final class AppModel {
    enum Phase { case loading, login, setup, ready, unavailable }
    let chat = ChatStore()
    var phase: Phase = .loading
    var profile: Profile?
    var setupAccount: SetupAccount?
    var overview: Overview?
    var space = "all"
    var error: String?
    var isRefreshing = false
    private var refreshQueued = false
    var isDemo = false
    private(set) var client: APIClient?
    var currency: String { profile?.currency ?? "EUR" }
    var query: [URLQueryItem] {
        [.init(name: "space", value: space), .init(name: "month", value: Dates.month(Date(), timezone: profile?.timezone ?? TimeZone.current.identifier))]
    }
    var website: URL? { try? AppConfiguration.load().website }

    func start() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--demo") {
            isDemo = true; chat.configure(userId: "preview", client: nil, demo: true); profile = Demo.profile; overview = Demo.overview; phase = .ready
            return
        }
        #endif
        do {
            let api = try APIClient(configuration: AppConfiguration.load())
            client = api
            guard try await api.restore() else { phase = .login; return }
            await load()
        } catch { self.error = error.localizedDescription; phase = .unavailable }
    }
    func load() async {
        do {
            guard let client else { throw AppError.configuration }
            let result: Bootstrap = try await client.request("bootstrap")
            profile = result.profile; setupAccount = result.setupAccount
            chat.configure(userId: result.profile.id, client: client)
            if result.profile.onboardingCompletedAt == nil { phase = .setup }
            else { try await reload(); phase = .ready }
        } catch AppError.sessionExpired { profile = nil; overview = nil; phase = .login; error = AppError.sessionExpired.localizedDescription }
        catch { self.error = error.localizedDescription; if overview == nil { phase = .unavailable } }
    }
    func reload() async throws {
        if isDemo { return }
        guard let client else { throw AppError.configuration }
        let selectedSpace = space
        let selectedUser = profile?.id
        let result: Overview = try await client.request("overview", query: query)
        if space == selectedSpace && profile?.id == selectedUser { overview = result }
    }
    func refresh() async {
        guard !isRefreshing else { refreshQueued = true; return }
        isRefreshing = true
        defer {
            isRefreshing = false
            if refreshQueued { refreshQueued = false; Task { await refresh() } }
        }
        do { try await reload() }
        catch AppError.sessionExpired { phase = .login; overview = nil; error = AppError.sessionExpired.localizedDescription }
        catch { self.error = error.localizedDescription }
    }
    func authenticate(email: String, password: String, signup: Bool) async throws -> Bool {
        guard let client else { throw AppError.configuration }
        if signup {
            guard try await client.signUp(email: email, password: password) else { return false }
        } else { try await client.signIn(email: email, password: password) }
        await load()
        return true
    }
    func mutate(_ path: String, method: String = "POST", payload: [String: JSONValue]? = nil) async throws {
        guard !isDemo else { throw AppError.server("Le mode aperçu ne modifie aucune donnée. Connecte-toi pour enregistrer.") }
        guard let client else { throw AppError.configuration }
        let _: Success = try await client.request(path, method: method, payload: payload)
        // A failed refresh must not make a saved form look unsaved (duplicate retry).
        await refresh()
    }
    func signOut() async {
        do {
            if !isDemo { try await client?.signOut() }
            chat.configure(userId: nil, client: nil)
            isDemo = false; overview = nil; profile = nil; setupAccount = nil; space = "all"
            phase = .login
            if client == nil { client = try APIClient(configuration: AppConfiguration.load()) }
        } catch { self.error = error.localizedDescription }
    }
}
