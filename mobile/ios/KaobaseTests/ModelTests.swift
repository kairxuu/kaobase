import XCTest
import UIKit
@testable import Kaobase

final class ModelTests: XCTestCase {
    func testFrenchAmountsAreExactAndRejectExtraDecimals() {
        XCTAssertEqual(Money.parse("1250,50"), Decimal(string: "1250.50"))
        XCTAssertEqual(Money.parse("-42.60"), Decimal(string: "-42.60"))
        for input in ["", "NaN", "1,234", "1.2.3", "12abc", "10000000001", "1e3"] { XCTAssertNil(Money.parse(input), input) }
    }
    func testDateUsesProfileTimezoneInsteadOfUTCDay() {
        let instant = ISO8601DateFormatter().date(from: "2026-10-16T23:30:00Z")!
        XCTAssertEqual(Dates.day(instant, timezone: "Europe/Paris"), "2026-10-17")
        XCTAssertEqual(Dates.day(instant, timezone: "America/New_York"), "2026-10-16")
    }
    func testNeverOpensCredentialURLsOrExecutableSchemes() {
        for input in ["javascript:alert(1)", "file:///etc/passwd", "https://user:secret@example.com", "kaobase://token"] { XCTAssertNil(safeExternalURL(input)) }
        XCTAssertNotNil(safeExternalURL("https://www.notion.so/"))
    }
    func testConfigurationAcceptsOnlyHTTPSOrigins() throws {
        for value in ["http://example.com", "https://example.com/path", "https://user:secret@example.com", "https://example.com/?token=secret"] {
            XCTAssertThrowsError(try AppConfiguration(website: value))
        }
        XCTAssertNoThrow(try AppConfiguration(website: "https://example.com"))
    }
    func testDecodePostgRESTAndCamelCaseServerFields() throws {
        let raw = #"{"accounts":[{"id":"a","name":"Compte","kind":"checking","currency":"EUR","space":"perso","balance":12.34},{"id":"b","name":"USD","kind":"checking","currency":"USD","space":"pro","balance":100}],"categories":[],"summary":{"month":"2026-10","income":0,"expenses":0,"net":0,"count":0,"byCategory":[]},"budgets":[{"categoryId":"food","category":"Food","limit":100,"spent":25.50,"remaining":74.50,"percent":26}],"transactions":[],"subscriptions":[],"tasks":[],"apps":[{"id":"app","name":"Notion","url":"https://notion.so","account_label":"Perso","category":"work","space":"perso","pinned":true}],"connections":[]}"#
        let result = try APIClient.decoder().decode(Overview.self, from: Data(raw.utf8))
        XCTAssertEqual(result.apps.first?.accountLabel, "Perso")
        XCTAssertEqual(result.budgets.first?.categoryId, "food")
        XCTAssertEqual(result.balances.count, 2)
        XCTAssertEqual(result.balances.first { $0.currency == "EUR" }?.amount, Decimal(string: "12.34"))
    }
    func testMonthlySubscriptionCostConvertsPeriods() {
        let yearly = Subscription(id: "1", name: "Annual", amount: 120, period: "yearly", nextDue: nil, status: "active", space: "perso")
        XCTAssertEqual(yearly.monthlyCost, 10)
    }
}

extension ModelTests {
    func testDistributionRetainsEmptyCategoriesAndExcludesTransfersAndIncome() {
        let categories = [Category(id: "food", name: "Courses", kind: "expense", color: "#123456"), Category(id: "empty", name: "Loisirs", kind: "expense", color: "#654321"), Category(id: "transfer", name: "Virement", kind: "transfer", color: "#888888")]
        let rows = DistributionItem.grouped([("food", 10), ("food", 2.50), ("transfer", 100), (nil, 5), ("food", -50)], categories: categories)
        XCTAssertEqual(rows.first?.amount, 12.50)
        XCTAssertEqual(rows.first { $0.id == "empty" }?.amount, 0)
        XCTAssertEqual(rows.first { $0.id == "uncategorized" }?.amount, 5)
        XCTAssertFalse(rows.contains { $0.id == "transfer" })
        XCTAssertEqual(rows.reduce(0) { $0 + $1.amount }, 17.50)
    }
    func testSubscriptionCategoryDecodesAndOldPayloadStillWorks() throws {
        let raw = #"{"id":"s","name":"Music","amount":120,"period":"yearly","status":"active","space":"perso","category_id":"music"}"#
        let row = try APIClient.decoder().decode(Subscription.self, from: Data(raw.utf8))
        XCTAssertEqual(row.categoryId, "music")
        XCTAssertEqual(row.monthlyCost, 10)
        // Decodable treats the optional category as nil for older server payloads.
        let old = #"{"id":"s","name":"Music","amount":12,"period":"monthly","status":"active","space":"perso"}"#
        XCTAssertNil(try APIClient.decoder().decode(Subscription.self, from: Data(old.utf8)).categoryId)
    }
    func testLogoAliasesUseBundledAssetsAndNeverSendPrivateHosts() {
        XCTAssertEqual(AppIcons.host("https://www.amazon.com/orders?account=private"), "amazon.fr")
        XCTAssertEqual(AppIcons.host("https://gmail.com"), "mail.google.com")
        for value in ["https://127.0.0.1", "https://192.168.1.1", "https://service.internal", "https://example.test", "https://user:secret@github.com", "file:///tmp/test"] { XCTAssertNil(AppIcons.host(value)) }
    }
    func testSavingsTotalsStaySeparateByCurrencyAndIncludedInOverallBalance() {
        let accounts = [Account(id: "1", name: "Livret A", kind: "savings", currency: "EUR", space: "perso", balance: 500), Account(id: "2", name: "Courant", kind: "checking", currency: "EUR", space: "perso", balance: 20), Account(id: "3", name: "USD", kind: "savings", currency: "USD", space: "pro", balance: 30)]
        let overview = Overview(accounts: accounts, categories: [], summary: MonthSummary(month: "2026-10", income: 0, expenses: 0, net: 0, count: 0, byCategory: []), budgets: [], transactions: [], subscriptions: [], tasks: [], apps: [], connections: [])
        XCTAssertEqual(overview.savings.count, 2)
        XCTAssertEqual(overview.savingsBalances.first { $0.currency == "EUR" }?.amount, 500)
        XCTAssertEqual(overview.balances.first { $0.currency == "EUR" }?.amount, 520)
        XCTAssertEqual(overview.savingsBalances.first { $0.currency == "USD" }?.amount, 30)
    }
}


extension ModelTests {
    @MainActor
    func testEveryKnownLogoAndBrandRoseIsBundled() {
        for host in AppIcons.local { XCTAssertNotNil(UIImage(named: "App_" + host), host) }
        XCTAssertNotNil(UIImage(named: "BrandRose"))
    }
}
