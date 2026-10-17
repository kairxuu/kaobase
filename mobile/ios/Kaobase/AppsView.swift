import SwiftUI

enum AppCategories {
    static let values = [("banking", "Banque & finances"), ("work", "Travail & organisation"), ("communication", "Communication"), ("shopping", "Achats"), ("entertainment", "Loisirs & abonnements"), ("other", "Autres")]
    static func label(_ id: String) -> String { values.first { $0.0 == id }?.1 ?? "Autres" }
}
struct AppsView: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var category = "all"
    @State private var ascending = true
    @State private var showCatalog = false
    @State private var editor = false
    @State private var toDelete: AppShortcut?
    private var apps: [AppShortcut] {
        (model.overview?.apps ?? []).filter {
            (category == "all" || $0.category == category) && (search.isEmpty || ($0.name + " " + $0.accountLabel).localizedCaseInsensitiveContains(search))
        }.sorted { ascending ? $0.name.localizedStandardCompare($1.name) == .orderedAscending : $0.name.localizedStandardCompare($1.name) == .orderedDescending }
    }
    var body: some View {
        NavigationStack {
            List {
                SpacePicker().listRowBackground(Color.clear)
                Section {
                    Button { showCatalog = true } label: { Label("Explorer le catalogue", systemImage: "square.grid.2x2") }
                    Picker("Catégorie", selection: $category) { Text("Toutes").tag("all"); ForEach(AppCategories.values, id: \.0) { Text($0.1).tag($0.0) } }
                }
                Section("Mes apps · \(apps.count)") {
                    ForEach(apps) { app in
                        HStack(spacing: 14) {
                            if let url = app.destination {
                                Link(destination: url) {
                                    HStack(spacing: 12) {
                                        Text(String(app.name.prefix(1)).uppercased()).font(.title3.weight(.semibold)).frame(width: 42, height: 42).background(Palette.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 13))
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(app.name).foregroundStyle(Palette.ink)
                                            Text(app.accountLabel.isEmpty ? AppCategories.label(app.category) : app.accountLabel).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                            if model.overview?.connections.contains(where: { $0.shortcutId == app.id }) == true { Label("Compte connecté", systemImage: "checkmark.shield").font(.caption2).foregroundStyle(Palette.gain) }
                                        }
                                        Spacer(minLength: 0)
                                    }
                                }
                            }
                            Button { Task { do { try await model.mutate("apps/" + app.id, method: "PATCH", payload: ["pinned": .bool(!app.pinned)]) } catch { model.error = error.localizedDescription } } } label: {
                                Image(systemName: app.pinned ? "pin.fill" : "pin").foregroundStyle(app.pinned ? Palette.accent : .secondary)
                            }.buttonStyle(.borderless).accessibilityLabel(app.pinned ? "Désépingler \(app.name)" : "Épingler \(app.name)")
                        }.swipeActions { Button("Supprimer", role: .destructive) { toDelete = app } }
                    }
                    if apps.isEmpty { ContentUnavailableView("Tes apps, à portée de main", systemImage: "app.badge", description: Text("Ajoute un raccourci depuis le catalogue ou avec son adresse.")) }
                }
            }.navigationTitle("Apps").searchable(text: $search, prompt: "App ou compte")
                .scrollContentBackground(.hidden).background(Palette.paper)
                .toolbar {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button("Inverser le tri", systemImage: ascending ? "arrow.down" : "arrow.up") { ascending.toggle() }
                        Button("Ajouter une app", systemImage: "plus") { editor = true }
                    }
                }
                .refreshable { await model.refresh() }
                .sheet(isPresented: $editor) { AppEditor() }
                .sheet(isPresented: $showCatalog) { CatalogView() }
                .confirmationDialog("Supprimer ce raccourci ?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), titleVisibility: .visible) {
                    Button("Supprimer", role: .destructive) {
                        guard let app = toDelete else { return }; toDelete = nil
                        Task { do { try await model.mutate("apps/" + app.id, method: "DELETE") } catch { model.error = error.localizedDescription } }
                    }
                }
        }
    }
}

struct CatalogView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var catalog: Catalog?
    @State private var search = ""
    @State private var selected: CatalogEntry?
    @State private var error: String?
    private var entries: [CatalogEntry] { (catalog?.apps ?? []).filter { search.isEmpty || ($0.name + " " + $0.description).localizedCaseInsensitiveContains(search) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }
    var body: some View {
        NavigationStack {
            List {
                if let warning = catalog?.warning { Section { Text(warning).font(.footnote).foregroundStyle(.secondary) } }
                if let error { Section { InlineError(text: error); Button("Réessayer") { Task { await load() } } } }
                if catalog == nil && error == nil { ProgressView("Chargement des apps…") }
                ForEach(entries) { entry in
                    Button { selected = entry } label: {
                        VStack(alignment: .leading, spacing: 5) { Text(entry.name).foregroundStyle(Palette.ink); Text(entry.description).font(.caption).foregroundStyle(.secondary) }.padding(.vertical, 3)
                    }
                }
                if catalog != nil && entries.isEmpty { ContentUnavailableView.search(text: search) }
            }.navigationTitle("Catalogue").searchable(text: $search, prompt: "Rechercher une app")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Fermer") { dismiss() } } }
                .task { await load() }
                .sheet(item: $selected) { entry in AppEditor(preset: entry) }
        }
    }
    private func load() async {
        error = nil
        guard !model.isDemo else { error = "Connecte-toi pour explorer le catalogue en ligne."; return }
        do { guard let client = model.client else { throw AppError.configuration }; catalog = try await client.request("catalog") }
        catch { self.error = error.localizedDescription }
    }
}
struct AppEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var preset: CatalogEntry?
    @State private var name = ""
    @State private var url = ""
    @State private var account = ""
    @State private var category = "other"
    @State private var space = "perso"
    @State private var pinned = true
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("L’app et ton compte") {
                    TextField("Nom de l’app", text: $name)
                    TextField("https://mon-app.com", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("E-mail ou nom du compte (facultatif)", text: $account).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Picker("Catégorie", selection: $category) { ForEach(AppCategories.values, id: \.0) { Text($0.1).tag($0.0) } }
                    FormSpacePicker(space: $space)
                    Toggle("Épingler sur l’accueil", isOn: $pinned)
                }
                Section { Text("Ce raccourci ouvre le service. Les connexions OAuth se configurent pour le moment depuis Kaobase web.").font(.footnote).foregroundStyle(.secondary) }
                Section { InlineError(text: error); BusyButton(title: "Ajouter l’app", busy: busy) { save() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || url.isEmpty) }
            }.navigationTitle("Nouvelle app").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() }.disabled(busy) } }
                .onAppear { if let preset { name = preset.name; url = preset.url ?? ""; category = preset.category }; space = model.space == "pro" ? "pro" : "perso" }
        }.interactiveDismissDisabled(busy)
    }
    private func save() {
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                try await model.mutate("apps", payload: ["name": .string(name), "url": .string(url), "accountLabel": .string(account), "category": .string(category), "space": .string(space), "pinned": .bool(pinned)])
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
