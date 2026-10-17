import Foundation

struct Profile: Codable, Sendable {
    let id: String
    let displayName: String?
    let currency: String
    let timezone: String
    let onboardingCompletedAt: String?
    let email: String
}
struct SetupAccount: Codable, Sendable {
    let id: String
    let name: String
    let kind: String
    let space: String
    let openingBalance: Decimal
}
struct Bootstrap: Decodable, Sendable {
    let profile: Profile
    let setupAccount: SetupAccount?
}
struct Account: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let kind: String
    let currency: String
    let space: String
    let balance: Decimal
}
struct Category: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let kind: String
    let color: String
}
struct Transaction: Codable, Identifiable, Sendable {
    let id: String
    let accountId: String?
    let bookedAt: String
    let amount: Decimal
    let labelRaw: String
    let merchant: String
    let categoryId: String?
    let categorizedBy: String?
    let source: String
}
struct Subscription: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let amount: Decimal
    let period: String
    let nextDue: String?
    let status: String
    let space: String
    var categoryId: String? = nil
    var monthlyCost: Decimal {
        switch period {
        case "weekly": amount * 52 / 12
        case "quarterly": amount / 3
        case "yearly": amount / 12
        default: amount
        }
    }
    var periodLabel: String {
        switch period { case "weekly": "semaine"; case "quarterly": "trimestre"; case "yearly": "an"; default: "mois" }
    }
}
struct KaobaseTask: Codable, Identifiable, Sendable {
    let id: String
    let title: String
    let description: String?
    let status: String
    let priority: String
    let dueDate: String?
    let space: String
}
struct AppShortcut: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let url: String
    let accountLabel: String
    let category: String
    let space: String
    let pinned: Bool
    var destination: URL? { safeExternalURL(url) }
}
struct AppConnection: Codable, Identifiable, Sendable {
    let id: String
    let shortcutId: String
    let providerName: String
}
struct CategoryTotal: Codable, Identifiable, Sendable {
    var id: String { categoryId ?? "none" }
    let categoryId: String?
    let name: String
    let color: String
    let total: Decimal
}
struct MonthSummary: Codable, Sendable {
    let month: String
    let income: Decimal
    let expenses: Decimal
    let net: Decimal
    let count: Int
    let byCategory: [CategoryTotal]
}
struct Budget: Codable, Identifiable, Sendable {
    var id: String { categoryId }
    let categoryId: String
    let category: String
    let limit: Decimal
    let spent: Decimal
    let remaining: Decimal
    let percent: Int
}
struct Overview: Codable, Sendable {
    let accounts: [Account]
    let categories: [Category]
    let summary: MonthSummary
    let budgets: [Budget]
    let transactions: [Transaction]
    let subscriptions: [Subscription]
    let tasks: [KaobaseTask]
    let apps: [AppShortcut]
    let connections: [AppConnection]
    var savings: [Account] { accounts.filter { $0.kind == "savings" } }
    var savingsBalances: [(currency: String, amount: Decimal)] {
        Dictionary(grouping: savings, by: \.currency).map { currency, rows in
            (currency, rows.reduce(Decimal.zero) { $0 + $1.balance })
        }.sorted { $0.currency < $1.currency }
    }
    // Amounts in different currencies are deliberately kept separate.
    var balances: [(currency: String, amount: Decimal)] {
        Dictionary(grouping: accounts, by: \.currency).map { currency, rows in
            (currency, rows.reduce(Decimal.zero) { $0 + $1.balance })
        }.sorted { $0.currency < $1.currency }
    }
}
struct CatalogEntry: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let description: String
    let category: String
    let url: String?
}
struct Catalog: Decodable, Sendable {
    let apps: [CatalogEntry]
    let warning: String?
}
struct AgentDeletion: Codable, Identifiable, Sendable {
    let id: String
    let description: String
}
struct AgentReply: Decodable, Sendable {
    let text: String
    let agent: String
    let deletions: [AgentDeletion]
}
struct ChatMessage: Codable, Identifiable, Sendable {
    var id = UUID()
    let text: String
    let isUser: Bool
    var deletions: [AgentDeletion] = []
}
struct ConversationSummary: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let lastAt: String
}
struct ConversationDetail: Decodable, Sendable {
    struct Message: Decodable, Sendable {
        let role: String
        let content: String
    }
    let messages: [Message]
    let deletions: [AgentDeletion]
}
struct DistributionItem: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let color: String
    let amount: Decimal
    static func grouped(_ rows: [(String?, Decimal)], categories: [Category]) -> [DistributionItem] {
        let transfers = Set(categories.filter { $0.kind == "transfer" }.map(\.id))
        var totals: [String: Decimal] = [:]
        for (category, amount) in rows where amount > 0 && !transfers.contains(category ?? "") {
            totals[category ?? "uncategorized", default: 0] += amount
        }
        var result = categories.filter { $0.kind == "expense" || totals[$0.id] != nil }.filter { $0.kind != "transfer" }.map {
            DistributionItem(id: $0.id, name: $0.name, color: $0.color, amount: totals.removeValue(forKey: $0.id) ?? 0)
        }
        result += totals.map { DistributionItem(id: $0.key, name: "Sans catégorie", color: "#8e8a96", amount: $0.value) }
        return result.sorted { $0.amount == $1.amount ? $0.name < $1.name : $0.amount > $1.amount }
    }
}
struct Success: Decodable, Sendable { let ok: Bool }
enum JSONValue: Encodable, Sendable {
    case string(String), number(Decimal), bool(Bool), null
    func encode(to encoder: Encoder) throws {
        var box = encoder.singleValueContainer()
        switch self {
        case .string(let value): try box.encode(value)
        case .number(let value): try box.encode(value)
        case .bool(let value): try box.encode(value)
        case .null: try box.encodeNil()
        }
    }
    static func optional(_ value: String?) -> JSONValue { value.map(JSONValue.string) ?? .null }
}

func safeExternalURL(_ value: String) -> URL? {
    guard let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
          url.host != nil, url.user == nil, url.password == nil else { return nil }
    return url
}
enum Money {
    static func parse(_ text: String) -> Decimal? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
        guard clean.range(of: #"^-?\d+(\.\d{1,2})?$"#, options: .regularExpression) != nil,
              let value = Decimal(string: clean, locale: Locale(identifier: "en_US_POSIX")), abs(value) <= Decimal(10_000_000_000) else { return nil }
        return value
    }
    static func format(_ value: Decimal, currency: String) -> String {
        value.formatted(.currency(code: currency).locale(Locale(identifier: "fr_FR")))
    }
}
enum Dates {
    static func day(_ date: Date, timezone: String = TimeZone.current.identifier) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: timezone); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
    static func month(_ date: Date, timezone: String) -> String { String(day(date, timezone: timezone).prefix(7)) }
    static func label(_ raw: String) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: raw) else { return raw }
        return date.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: "fr_FR")))
    }
}
