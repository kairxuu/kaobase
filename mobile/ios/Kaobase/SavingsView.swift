import SwiftUI

struct SavingsView: View {
    @Environment(AppModel.self) private var model
    @State private var editor = false
    var body: some View {
        List {
            SpacePicker().listRowBackground(Color.clear)
            Section {
                ForEach(model.overview?.savingsBalances ?? [], id: \.currency) { item in
                    Text(Money.format(item.amount, currency: item.currency)).font(.largeTitle.weight(.semibold)).monospacedDigit()
                }
                Text("Ces montants sont déjà inclus dans le solde de l’accueil.").font(.footnote).foregroundStyle(Palette.muted)
            }
            Section("Mes livrets") {
                ForEach(model.overview?.savings ?? []) { account in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(account.name).font(.headline)
                        Text(Money.format(account.balance, currency: account.currency)).monospacedDigit()
                        Text(account.space == "pro" ? "Professionnel" : "Personnel").font(.caption).foregroundStyle(Palette.muted)
                    }.padding(.vertical, 6)
                }
                if model.overview?.savings.isEmpty != false { Text("Ajoute un Livret A, un LEP ou un autre compte d’épargne.").foregroundStyle(Palette.muted) }
            }
        }.scrollContentBackground(.hidden).background(Palette.paper).navigationTitle("Épargne")
            .toolbar { Button("Ajouter un livret", systemImage: "plus") { editor = true } }
            .sheet(isPresented: $editor) { SavingsEditor() }.refreshable { await model.refresh() }
    }
}
struct SavingsEditor: View {
    static let products = ["Livret A", "LEP", "LDDS", "PEL", "CEL", "Autre livret"]
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var product = "Livret A"
    @State private var name = "Livret A"
    @State private var amount = "0"
    @State private var space = "perso"
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Compte d’épargne") {
                    Picker("Type de livret", selection: $product) { ForEach(Self.products, id: \.self) { Text($0).tag($0) } }.onChange(of: product) { _, value in name = value }
                    TextField("Nom du compte", text: $name)
                    AmountField(title: "Solde de départ", text: $amount)
                    FormSpacePicker(space: $space)
                }
                Section { Text("Les opérations ajoutées à ce compte mettront son solde à jour.").font(.footnote).foregroundStyle(Palette.muted) }
                Section { InlineError(text: error); BusyButton(title: "Enregistrer", busy: busy) { save() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || Money.parse(amount) == nil) }
            }.navigationTitle("Nouveau livret").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() }.disabled(busy) } }
                .onAppear { space = model.space == "pro" ? "pro" : "perso" }
        }.interactiveDismissDisabled(busy)
    }
    private func save() {
        guard let value = Money.parse(amount) else { return }
        busy = true; error = nil
        Task { defer { busy = false }; do {
            try await model.mutate("accounts", payload: ["name": .string(name), "kind": .string("savings"), "openingBalance": .number(value), "space": .string(space)]); dismiss()
        } catch { self.error = error.localizedDescription } }
    }
}
