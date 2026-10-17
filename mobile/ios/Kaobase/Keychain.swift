import Foundation
import Security

struct AuthUser: Codable, Sendable { let id: String; let email: String? }
struct AuthSession: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let user: AuthUser
}

protocol SessionStorage: Sendable {
    func read() throws -> AuthSession?
    func save(_ session: AuthSession) throws
    func clear() throws
}
struct KeychainStorage: SessionStorage {
    func read() throws -> AuthSession? { try SessionKeychain.read() }
    func save(_ session: AuthSession) throws { try SessionKeychain.save(session) }
    func clear() throws { try SessionKeychain.clear() }
}

enum SessionKeychain {
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "com.kaobase.ios") + ".neon.session",
         kSecAttrAccount as String: "neon"]
    }
    static func read() throws -> AuthSession? {
        var attributes = query
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw failure }
        return try JSONDecoder().decode(AuthSession.self, from: data)
    }
    static func save(_ session: AuthSession) throws {
        let value: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(session),
                                  kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, value as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(value) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw failure }
        } else if status != errSecSuccess { throw failure }
    }
    static func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure }
    }
    private static var failure: AppError { .server("La session n’a pas pu être enregistrée dans le trousseau de l’iPhone.") }
}
