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


extension NavigationTests {
    func testSavingsAndSubscriptionDistribution() {
        let app = XCUIApplication(); app.launchArguments = ["--demo"]; app.launch()
        app.tabBars.buttons["Plus"].tap(); app.buttons["Épargne"].tap()
        XCTAssertTrue(app.navigationBars["Épargne"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["Ajouter un livret"].tap()
        XCTAssertTrue(app.navigationBars["Nouveau livret"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["Nom du compte"].value as? String, "Livret A")
        app.buttons["Annuler"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Abonnements"].tap()
        XCTAssertTrue(app.staticTexts["Répartition mensuelle"].waitForExistence(timeout: 5))
        app.segmentedControls.buttons["EUR"].tap()
        XCTAssertTrue(app.staticTexts["Spotify"].exists)
    }
    func testAssistantDraftHistoryAndCustomDeleteConfirmation() {
        let app = XCUIApplication(); app.launchArguments = ["--demo"]; app.launch()
        app.tabBars.buttons["Assistant"].tap()
        let draft = app.descendants(matching: .any).matching(identifier: "chatDraft").firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 5))
        draft.tap(); draft.typeText("Mon brouillon")
        let typed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "Mon brouillon"), object: draft)
        XCTAssertEqual(XCTWaiter.wait(for: [typed], timeout: 5), .completed)
        app.buttons["Terminé"].tap()
        app.tabBars.buttons["Accueil"].tap(); app.tabBars.buttons["Assistant"].tap()
        XCTAssertEqual(draft.value as? String, "Mon brouillon")
        app.navigationBars.buttons["Nouvelle conversation"].tap()
        app.navigationBars.buttons["Historique"].tap()
        XCTAssertTrue(app.staticTexts["Mon brouillon"].waitForExistence(timeout: 5))
        app.buttons["Supprimer"].tap()
        XCTAssertTrue(app.staticTexts["Supprimer cette conversation ?"].waitForExistence(timeout: 5))
        app.buttons["Annuler"].tap()
        XCTAssertTrue(app.staticTexts["Mon brouillon"].exists)
        app.buttons["Supprimer"].tap()
        app.buttons["Confirmer la suppression"].tap()
        XCTAssertTrue(app.staticTexts["Aucune conversation"].waitForExistence(timeout: 5))
    }
}
