import XCTest
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
