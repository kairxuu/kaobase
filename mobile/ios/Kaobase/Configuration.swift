import Foundation

struct AppConfiguration: Sendable {
    let website: URL
    let auth: URL
    let publicKey: String

    init(website: String, auth: String, publicKey: String) throws {
        func origin(_ value: String) throws -> URL {
            guard let url = URL(string: value), url.scheme == "https", url.host != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.path.isEmpty || url.path == "/" else { throw AppError.configuration }
            return url
        }
        self.website = try origin(website)
        self.auth = try origin(auth)
        guard !publicKey.isEmpty, !publicKey.hasPrefix("sb_secret_") else { throw AppError.configuration }
        self.publicKey = publicKey
    }

    static func load(bundle: Bundle = .main) throws -> AppConfiguration {
        guard let url = bundle.url(forResource: "Config.local", withExtension: "plist"),
              let values = try PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil) as? [String: String],
              let website = values["WebsiteURL"], let auth = values["SupabaseURL"], let key = values["SupabasePublicKey"] else {
            throw AppError.configuration
        }
        return try AppConfiguration(website: website, auth: auth, publicKey: key)
    }
}

enum AppError: LocalizedError {
    case configuration, sessionExpired, authRejected(String), server(String), invalidResponse
    var errorDescription: String? {
        switch self {
        case .configuration: "La configuration iOS manque. Lance le script de configuration indiqué dans le guide iOS, puis reconstruis l’app."
        case .sessionExpired: "Ta session a expiré. Reconnecte-toi."
        case .authRejected(let message): message
        case .server(let message): message
        case .invalidResponse: "Le serveur ne répond pas comme prévu. Vérifie que la dernière version de Kaobase est déployée."
        }
    }
}
