import SwiftUI

@main
struct KaobaseApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(Palette.accent)
                .task { await model.start() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active && model.phase == .ready { Task { await model.refresh() } }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        @Bindable var model = model
        Group {
            switch model.phase {
            case .loading: ProgressView("Ouverture de Kaobase…")
            case .login: LoginView()
            case .setup: SetupView()
            case .ready: MainTabs()
            case .unavailable:
                ContentUnavailableView {
                    Label("Kaobase est indisponible", systemImage: "wifi.exclamationmark")
                } description: { Text(model.error ?? "Réessaie dans un instant.") }
                actions: {
                    Button("Réessayer") { model.error = nil; Task { await model.start() } }.buttonStyle(.borderedProminent)
                    Button("Se déconnecter") { Task { await model.signOut() } }
                }
            }
        }
        .background(Palette.paper)
        // Financial information is obscured in the system app switcher.
        .overlay {
            if scenePhase != .active {
                Palette.paper.ignoresSafeArea().overlay(BrandMark().frame(width: 70, height: 70))
            }
        }
        .alert("Kaobase", isPresented: Binding(get: { model.error != nil && model.phase != .unavailable }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            DashboardView().tabItem { Label("Accueil", systemImage: "square.grid.2x2") }
            TransactionsView().tabItem { Label("Opérations", systemImage: "arrow.left.arrow.right") }
            AppsView().tabItem { Label("Apps", systemImage: "app.badge") }
            AgentView().tabItem { Label("Assistant", systemImage: "sparkles") }
            MoreView().tabItem { Label("Plus", systemImage: "ellipsis") }
        }
    }
}
