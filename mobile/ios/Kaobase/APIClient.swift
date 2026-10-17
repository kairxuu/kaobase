import Foundation

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor APIClient {
    let configuration: AppConfiguration
    private let transport: URLSession
    private let storage: any SessionStorage
    private var session: AuthSession?
    private var refreshTask: Task<AuthSession, Error>?
    private var generation = 0

    init(configuration: AppConfiguration, transport: URLSession? = nil, storage: any SessionStorage = KeychainStorage()) {
        self.configuration = configuration
        self.storage = storage
        if let transport { self.transport = transport }
        else {
            let config = URLSessionConfiguration.ephemeral
            config.httpShouldSetCookies = false
            config.httpCookieStorage = nil
            config.urlCache = nil
            config.timeoutIntervalForRequest = 90
            self.transport = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
        }
    }
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
    func restore() throws -> Bool {
        session = try storage.read()
        return session != nil
    }
    private struct AuthResponse: Decodable {
        let accessToken: String?
        let refreshToken: String?
        let expiresIn: Double?
        let user: AuthUser?
        func session() throws -> AuthSession {
            guard let accessToken, let refreshToken, let user, let expiresIn else { throw AppError.invalidResponse }
            return AuthSession(accessToken: accessToken, refreshToken: refreshToken, expiresAt: Date().addingTimeInterval(expiresIn), user: user)
        }
    }
    private struct ErrorBody: Decodable { let error: String?; let errorCode: String?; let code: String?; let msg: String? }

    private func send(_ request: URLRequest, auth: Bool = false) async throws -> Data {
        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 && !auth { throw AppError.sessionExpired }
            if auth {
                let error = try? Self.decoder().decode(ErrorBody.self, from: data)
                let code = error?.code ?? error?.errorCode ?? ""
                switch code {
                case "INVALID_EMAIL_OR_PASSWORD", "SESSION_EXPIRED": throw AppError.authRejected("E-mail ou mot de passe incorrect, ou session expirée.")
                case "EMAIL_NOT_VERIFIED": throw AppError.verificationRequired
                case "USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL": throw AppError.server("Cette adresse possède déjà un compte.")
                case "PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG": throw AppError.server("Choisis un mot de passe d’au moins 8 caractères.")
                default: throw AppError.server(http.statusCode == 429 ? "Trop de tentatives. Réessaie dans quelques minutes." : error?.error ?? "La connexion a échoué. Vérifie tes informations et réessaie.")
                }
            }
            let error = try? Self.decoder().decode(ErrorBody.self, from: data)
            throw AppError.server(error?.error ?? "Le serveur est momentanément indisponible. Réessaie.")
        }
        return data
    }
    private func authRequest(path: String, payload: [String: JSONValue]) throws -> URLRequest {
        var request = URLRequest(url: configuration.website.appendingPathComponent("api/mobile/auth/" + path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        return request
    }
    func signIn(email: String, password: String) async throws {
        let request = try authRequest(path: "sign-in", payload: ["email": .string(email), "password": .string(password)])
        let next = try Self.decoder().decode(AuthResponse.self, from: await send(request, auth: true)).session()
        try storage.save(next); generation += 1; session = next
    }
    /// Confirmation-enabled projects return no session: sign in after following the email.
    func signUp(email: String, password: String) async throws -> Bool {
        let request = try authRequest(path: "sign-up", payload: ["email": .string(email), "password": .string(password)])
        let response = try Self.decoder().decode(AuthResponse.self, from: await send(request, auth: true))
        guard response.accessToken != nil else { return false }
        let next = try response.session()
        try storage.save(next); generation += 1; session = next
        return true
    }
    func verifyEmail(email: String, code: String) async throws {
        let request = try authRequest(path: "verify", payload: ["email": .string(email), "otp": .string(code)])
        let next = try Self.decoder().decode(AuthResponse.self, from: await send(request, auth: true)).session()
        try storage.save(next); generation += 1; session = next
    }
    func resendVerification(email: String) async throws {
        _ = try await send(authRequest(path: "resend", payload: ["email": .string(email)]), auth: true)
    }
    func requestReset(email: String) async throws {
        _ = try await send(authRequest(path: "request-reset", payload: ["email": .string(email)]), auth: true)
    }
    func resetPassword(email: String, code: String, password: String) async throws {
        _ = try await send(authRequest(path: "reset", payload: ["email": .string(email), "otp": .string(code), "password": .string(password)]), auth: true)
    }
    private func refresh() async throws -> AuthSession {
        if let refreshTask {
            let version = generation
            let next = try await refreshTask.value
            guard version == generation else { throw AppError.sessionExpired }
            return next
        }
        guard let old = session else { throw AppError.sessionExpired }
        let version = generation
        let request = try authRequest(path: "refresh", payload: ["refresh_token": .string(old.refreshToken)])
        let task = Task { try Self.decoder().decode(AuthResponse.self, from: await self.send(request, auth: true)).session() }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let next = try await task.value
            guard version == generation else { throw AppError.sessionExpired }
            try storage.save(next); session = next
            return next
        } catch {
            // Network failures keep the refresh token for a later retry.
            if version == generation, case AppError.authRejected = error { try? storage.clear(); session = nil; throw AppError.sessionExpired }
            throw error
        }
    }
    func request<T: Decodable & Sendable>(_ path: String, method: String = "GET", query: [URLQueryItem] = [], payload: [String: JSONValue]? = nil) async throws -> T {
        let version = generation
        guard var current = session else { throw AppError.sessionExpired }
        if current.expiresAt.timeIntervalSinceNow < 60 { current = try await refresh() }
        guard version == generation else { throw AppError.sessionExpired }
        func makeRequest(_ token: String) throws -> URLRequest {
            var parts = URLComponents(url: configuration.website.appendingPathComponent("api/mobile/" + path), resolvingAgainstBaseURL: false)!
            if !query.isEmpty { parts.queryItems = query }
            var request = URLRequest(url: parts.url!)
            request.httpMethod = method
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if let payload {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONEncoder().encode(payload)
            }
            return request
        }
        let data: Data
        do { data = try await send(makeRequest(current.accessToken)) }
        catch AppError.sessionExpired {
            guard version == generation else { throw AppError.sessionExpired }
            // Another concurrent request may already have refreshed the rejected token.
            if let latest = session, latest.accessToken != current.accessToken { current = latest }
            else { current = try await refresh() }
            data = try await send(makeRequest(current.accessToken))
        }
        guard version == generation else { throw AppError.sessionExpired }
        do { return try Self.decoder().decode(T.self, from: data) }
        catch { throw AppError.invalidResponse }
    }
    func signOut() async throws {
        let old = session
        // Clearing the Keychain must succeed before presenting a logged-out screen.
        try storage.clear(); generation += 1; session = nil
        refreshTask?.cancel(); refreshTask = nil
        if let old {
            var request = try authRequest(path: "sign-out", payload: ["refresh_token": .string(old.refreshToken)])
            request.timeoutInterval = 5
            request.setValue("Bearer " + old.accessToken, forHTTPHeaderField: "Authorization")
            _ = try? await send(request, auth: true)
        }
    }
}
