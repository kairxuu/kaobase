import SwiftUI

struct TransactionsView: View {
    @Environment(AppModel.self) private var model
    @State private var transactions: [Transaction] = []
    @State private var search = ""
    @State private var busy = false
    @State private var hasMore = true
    @State private var editor = false
    @State private var toDelete: Transaction?
    @State private var selected: Transaction?
    @State private var loadVersion = 0
    var body: some View {
        NavigationStack {
            List {
                SpacePicker().listRowBackground(Color.clear)
                ForEach(transactions) { transaction in
                    Button { selected = transaction } label: { TransactionRow(transaction: transaction) }.buttonStyle(.plain)
                        .swipeActions { Button("Supprimer", role: .destructive) { toDelete = transaction } }
                }
                if busy { ProgressView().frame(maxWidth: .infinity) }
                else if hasMore && !transactions.isEmpty { Button("Charger la suite") { Task { await load(reset: false) } } }
                if transactions.isEmpty && !busy { ContentUnavailableView(search.isEmpty ? "Aucune opération" : "Aucun résultat", systemImage: "arrow.left.arrow.right", description: Text("Ajoute une opération ou modifie ta recherche.")) }
            }.listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Palette.paper)
                .navigationTitle("Opérations")
                .searchable(text: $search, prompt: "Libellé ou commerçant")
                .toolbar { Button("Ajouter", systemImage: "plus") { editor = true } }
                .task(id: search + "|" + model.space) {
                    if !search.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
                    guard !Task.isCancelled else { return }
                    await load(reset: true)
                }
                .refreshable { await load(reset: true); await model.refresh() }
                .sheet(isPresented: $editor, onDismiss: { Task { await load(reset: true) } }) { TransactionEditor() }
                .sheet(item: $selected, onDismiss: { Task { await load(reset: true) } }) { transaction in TransactionCategoryEditor(transaction: transaction) }
                .confirmationDialog("Supprimer cette opération ?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), titleVisibility: .visible) {
                    Button("Supprimer", role: .destructive) {
                        guard let transaction = toDelete else { return }; toDelete = nil
                        Task { do { try await model.mutate("transactions/" + transaction.id, method: "DELETE"); await load(reset: true) } catch { model.error = error.localizedDescription } }
                    }
                }
        }
    }
    private func load(reset: Bool) async {
        if !reset && busy { return }
        loadVersion += 1; let version = loadVersion
        busy = true
        defer { if version == loadVersion { busy = false } }
        if model.isDemo { transactions = (model.overview?.transactions ?? []).filter { search.isEmpty || $0.labelRaw.localizedCaseInsensitiveContains(search) }; hasMore = false; return }
        guard let client = model.client else { return }
        do {
            let offset = reset ? 0 : transactions.count
            let rows: [Transaction] = try await client.request("transactions", query: model.query + [.init(name: "offset", value: String(offset)), .init(name: "search", value: search)])
            guard version == loadVersion, !Task.isCancelled else { return }
            if reset { transactions = rows } else { let existing = Set(transactions.map(\.id)); transactions += rows.filter { !existing.contains($0.id) } }
            hasMore = rows.count == 100
        } catch is CancellationError { }
        catch { if !Task.isCancelled { model.error = error.localizedDescription } }
    }
}

struct TransactionEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var amount = ""
    @State private var income = false
    @State private var date = Date()
    @State private var accountId = ""
    @State private var categoryId = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Opération") {
                    Picker("Type", selection: $income) { Text("Dépense").tag(false); Text("Revenu").tag(true) }.pickerStyle(.segmented)
                    TextField("Libellé", text: $label)
                    AmountField(title: "Montant", text: $amount)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Compte", selection: $accountId) { Text("Choisir un compte").tag(""); ForEach(model.overview?.accounts ?? []) { Text($0.name).tag($0.id) } }
                    Picker("Catégorie", selection: $categoryId) { Text("Non catégorisé").tag(""); ForEach(model.overview?.categories ?? []) { Text($0.name).tag($0.id) } }
                }
                Section { InlineError(text: error); BusyButton(title: "Enregistrer", busy: busy) { save() }.disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || (Money.parse(amount) ?? 0) <= 0 || accountId.isEmpty) }
            }.navigationTitle("Nouvelle opération").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() }.disabled(busy) } }
                .onAppear { accountId = model.overview?.accounts.first?.id ?? "" }
        }.interactiveDismissDisabled(busy)
    }
    private func save() {
        guard let value = Money.parse(amount), value > 0 else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                try await model.mutate("transactions", payload: ["accountId": .optional(accountId.isEmpty ? nil : accountId), "bookedAt": .string(Dates.day(date, timezone: model.profile?.timezone ?? TimeZone.current.identifier)), "amount": .number(income ? value : -value), "label": .string(label), "categoryId": .optional(categoryId.isEmpty ? nil : categoryId)])
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
struct TransactionCategoryEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let transaction: Transaction
    @State private var category = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section { TransactionRow(transaction: transaction) }
                Section("Catégorisation") {
                    Picker("Catégorie", selection: $category) { Text("Non catégorisé").tag(""); ForEach(model.overview?.categories ?? []) { Text($0.name).tag($0.id) } }
                    Text("Kaobase retient tes choix pour les prochaines opérations du même commerçant.").font(.footnote).foregroundStyle(.secondary)
                }
                Section { InlineError(text: error); BusyButton(title: "Enregistrer", busy: busy) {
                    busy = true
                    Task { defer { busy = false }; do { try await model.mutate("transactions/" + transaction.id, method: "PATCH", payload: ["categoryId": .optional(category.isEmpty ? nil : category)]); dismiss() } catch { self.error = error.localizedDescription } }
                } }
            }.navigationTitle("Opération").navigationBarTitleDisplayMode(.inline).onAppear { category = transaction.categoryId ?? "" }
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Fermer") { dismiss() }.disabled(busy) } }
        }.interactiveDismissDisabled(busy)
    }
}
