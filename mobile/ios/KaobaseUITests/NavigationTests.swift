import XCTest

@MainActor
final class NavigationTests: XCTestCase {
    func testNativeDashboardAndAppSearch() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Bonjour, Alex."].waitForExistence(timeout: 15))
        app.tabBars.buttons["Apps"].tap()
        XCTAssertTrue(app.buttons["Explorer le catalogue"].waitForExistence(timeout: 5))
        let search = app.searchFields.firstMatch
        if !search.exists { app.swipeDown() }
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap(); search.typeText("Notion")
        XCTAssertTrue(app.staticTexts["Notion"].exists)
        XCTAssertFalse(app.staticTexts["Spotify"].exists)
    }
    func testNativeOperationFormAndTaskNavigation() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo"]
        app.launch()
        app.tabBars.buttons["Opérations"].tap()
        app.navigationBars.buttons["Ajouter"].tap()
        XCTAssertTrue(app.navigationBars["Nouvelle opération"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Enregistrer"].isEnabled)
        app.buttons["Annuler"].tap()
        app.tabBars.buttons["Plus"].tap()
        app.buttons["Tâches"].tap()
        XCTAssertTrue(app.staticTexts["Vérifier l’abonnement de sport"].waitForExistence(timeout: 5))
    }
    func testLoginAndSignupAreNative() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.textFields["email"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.secureTextFields["password"].exists)
        XCTAssertFalse(app.buttons["Se connecter"].isEnabled)
        app.buttons["toggleSignup"].tap()
        XCTAssertTrue(app.buttons["Créer mon compte"].exists)
        XCTAssertFalse(app.buttons["Créer mon compte"].isEnabled)
    }
}
