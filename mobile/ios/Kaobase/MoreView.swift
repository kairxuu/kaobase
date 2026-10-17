import SwiftUI

struct MoreView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 15) {
                        Text(String((model.profile?.displayName ?? "K").prefix(1)).uppercased()).font(.title2).foregroundStyle(Palette.accent).frame(width: 50, height: 50).background(Palette.accent.opacity(0.12), in: Circle())
                        VStack(alignment: .leading, spacing: 4) { Text(model.profile?.displayName ?? "Mon compte").font(.headline); Text(model.profile?.email ?? "").font(.caption).foregroundStyle(.secondary) }
                    }.padding(.vertical, 8)
                }
                Section("Organiser") {
                    NavigationLink { SubscriptionsView() } label: { Label("Abonnements", systemImage: "repeat") }
                    NavigationLink { TasksView() } label: { Label("Tâches", systemImage: "checklist") }
                    NavigationLink { SavingsView() } label: { Label("Épargne", systemImage: "leaf") }
                    NavigationLink { AccountsView() } label: { Label("Comptes", systemImage: "building.columns") }
                    NavigationLink { BudgetsView() } label: { Label("Budgets", systemImage: "chart.pie") }
                }
                Section("Préférences") { NavigationLink { ProfileView() } label: { Label("Mon profil", systemImage: "person.crop.circle") } }
                if let url = model.website { Section { Link(destination: url) { Label("Ouvrir Kaobase web", systemImage: "safari") } } }
                Section { LogoutButton() }
                Section { Text("Kaobase pour iPhone · " + (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")).font(.footnote).foregroundStyle(.secondary) }
            }.navigationTitle("Ton espace").scrollContentBackground(.hidden).background(Palette.paper)
        }
    }
}
struct LogoutButton: View {
    @Environment(AppModel.self) private var model
    @State private var confirm = false
    @State private var busy = false
    var body: some View {
        Button("Se déconnecter", role: .destructive) { confirm = true }.disabled(busy)
            .confirmationDialog("Se déconnecter de cet iPhone ?", isPresented: $confirm, titleVisibility: .visible) {
                Button("Se déconnecter", role: .destructive) { busy = true; Task { await model.signOut(); busy = false } }
            }
    }
}

struct SubscriptionsView: View {
    @Environment(AppModel.self) private var model
    @State private var editor = false
    @State private var deleting: Subscription?
    @State private var selected: Subscription?
    private var active: [Subscription] { (model.overview?.subscriptions ?? []).filter { $0.status == "active" } }
    var body: some View {
        List {
            SpacePicker().listRowBackground(Color.clear)
            Section {
                DistributionView(items: DistributionItem.grouped(active.map { ($0.categoryId, $0.monthlyCost) }, categories: model.overview?.categories ?? []), currency: model.currency, title: "Répartition mensuelle")
            }
            ForEach(model.overview?.subscriptions ?? []) { subscription in
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text(subscription.name).font(.headline); Spacer(); Text(Money.format(subscription.amount, currency: model.currency)).monospacedDigit() }
                    Text("Par \(subscription.periodLabel)\(subscription.nextDue.map { " · " + Dates.label($0) } ?? "")").font(.caption).foregroundStyle(.secondary)
                    Button("Catégorie : " + (model.overview?.categories.first { $0.id == subscription.categoryId }?.name ?? "Sans catégorie")) { selected = subscription }.font(.caption).buttonStyle(.borderless)
                    if subscription.status == "suggested" {
                        HStack {
                            Button("Confirmer") { setStatus(subscription, "active") }.buttonStyle(.bordered)
                            Button("Ignorer") { setStatus(subscription, "rejected") }.buttonStyle(.borderless)
                        }
                    }
                }.swipeActions { Button("Supprimer", role: .destructive) { deleting = subscription } }
            }
            if model.overview?.subscriptions.isEmpty == true { ContentUnavailableView("Aucun abonnement", systemImage: "repeat", description: Text("Ajoute tes paiements réguliers pour suivre leurs échéances.")) }
        }.navigationTitle("Abonnements").toolbar { Button("Ajouter", systemImage: "plus") { editor = true } }
            .sheet(isPresented: $editor) { ItemEditor(kind: .subscription) }
            .sheet(item: $selected) { SubscriptionCategoryEditor(subscription: $0) }
            .refreshable { await model.refresh() }
            .confirmationDialog("Supprimer cet abonnement ?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Supprimer", role: .destructive) { guard let row = deleting else { return }; deleting = nil; Task { do { try await model.mutate("subscriptions/" + row.id, method: "DELETE") } catch { model.error = error.localizedDescription } } }
            }
    }
    private func setStatus(_ subscription: Subscription, _ status: String) { Task { do { try await model.mutate("subscriptions/" + subscription.id, method: "PATCH", payload: ["status": .string(status)]) } catch { model.error = error.localizedDescription } } }
}

struct TasksView: View {
    @Environment(AppModel.self) private var model
    @State private var editor = false
    @State private var deleting: KaobaseTask?
    var body: some View {
        List {
            SpacePicker().listRowBackground(Color.clear)
            ForEach(["todo", "doing", "done"], id: \.self) { status in
                let rows = (model.overview?.tasks ?? []).filter { $0.status == status }
                if !rows.isEmpty {
                    Section(status == "done" ? "Terminées" : status == "doing" ? "En cours" : "À faire") {
                        ForEach(rows) { row in
                            HStack(spacing: 12) {
                                Button { toggle(row) } label: { Image(systemName: row.status == "done" ? "checkmark.circle.fill" : "circle").font(.title2) }.buttonStyle(.borderless).accessibilityLabel(row.status == "done" ? "Rouvrir \(row.title)" : "Terminer \(row.title)")
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(row.title).strikethrough(row.status == "done")
                                    if let date = row.dueDate { Text(Dates.label(date)).font(.caption).foregroundStyle(.secondary) }
                                    if row.priority == "high" { Text("Priorité haute").font(.caption2).foregroundStyle(Palette.loss) }
                                }
                            }.swipeActions { Button("Supprimer", role: .destructive) { deleting = row } }
                        }
                    }
                }
            }
            if model.overview?.tasks.isEmpty == true { ContentUnavailableView("L’esprit libre", systemImage: "checklist", description: Text("Ajoute un rappel ou une tâche à ne pas oublier.")) }
        }.navigationTitle("Tâches").toolbar { Button("Ajouter", systemImage: "plus") { editor = true } }
            .sheet(isPresented: $editor) { ItemEditor(kind: .task) }
            .refreshable { await model.refresh() }
            .confirmationDialog("Supprimer cette tâche ?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Supprimer", role: .destructive) { guard let row = deleting else { return }; deleting = nil; Task { do { try await model.mutate("tasks/" + row.id, method: "DELETE") } catch { model.error = error.localizedDescription } } }
            }
    }
    private func toggle(_ row: KaobaseTask) { Task { do { try await model.mutate("tasks/" + row.id, method: "PATCH", payload: ["status": .string(row.status == "done" ? "todo" : "done")]) } catch { model.error = error.localizedDescription } } }
}

struct AccountsView: View {
    @Environment(AppModel.self) private var model
    @State private var editor = false
    var body: some View {
        List {
            SpacePicker().listRowBackground(Color.clear)
            ForEach(model.overview?.accounts ?? []) { account in
                VStack(alignment: .leading, spacing: 6) {
                    Text(account.name).font(.headline)
                    Text(Money.format(account.balance, currency: account.currency)).font(.title2).fontDesign(.default)
                    Text(account.space == "pro" ? "Professionnel" : "Personnel").font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 6)
            }
        }.navigationTitle("Comptes").toolbar { Button("Ajouter", systemImage: "plus") { editor = true } }.sheet(isPresented: $editor) { ItemEditor(kind: .account) }.refreshable { await model.refresh() }
    }
}
struct BudgetsView: View {
    @Environment(AppModel.self) private var model
    @State private var editor = false
    @State private var deleting: Budget?
    var body: some View {
        List {
            ForEach(model.overview?.budgets ?? []) { budget in
                VStack(alignment: .leading, spacing: 10) {
                    HStack { Text(budget.category).font(.headline); Spacer(); Text("\(budget.percent) %").foregroundStyle(budget.percent > 100 ? Palette.loss : Palette.accent) }
                    ProgressView(value: Double(min(max(budget.percent, 0), 100)), total: 100)
                    Text("\(Money.format(budget.spent, currency: model.currency)) / \(Money.format(budget.limit, currency: model.currency))").font(.subheadline)
                }.padding(.vertical, 5).swipeActions { Button("Supprimer", role: .destructive) { deleting = budget } }
            }
            if model.overview?.budgets.isEmpty == true { ContentUnavailableView("Garde le cap", systemImage: "chart.pie", description: Text("Fixe un budget mensuel pour une catégorie de dépenses.")) }
        }.navigationTitle("Budgets").toolbar { Button("Ajouter", systemImage: "plus") { editor = true } }.sheet(isPresented: $editor) { ItemEditor(kind: .budget) }
            .confirmationDialog("Supprimer ce budget ?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Supprimer", role: .destructive) { guard let row = deleting else { return }; deleting = nil; Task { do { try await model.mutate("budgets/" + row.id, method: "DELETE") } catch { model.error = error.localizedDescription } } }
            }
    }
}

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @State private var name = ""
    @State private var currency = "EUR"
    @State private var timezone = "Europe/Paris"
    @State private var busy = false
    @State private var error: String?
    @State private var saved = false
    var body: some View {
        Form {
            Section("Mon profil") {
                TextField("Nom d’affichage", text: $name)
                LabeledContent("E-mail", value: model.profile?.email ?? "")
                CurrencyPicker(currency: $currency)
                Picker("Fuseau horaire", selection: $timezone) { ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0).tag($0) } }
            }
            Section { InlineError(text: error); if saved { Label("Profil enregistré", systemImage: "checkmark").foregroundStyle(Palette.gain) }; BusyButton(title: "Enregistrer", busy: busy) { save() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty) }
        }.navigationTitle("Mon profil").onAppear { name = model.profile?.displayName ?? ""; currency = model.currency; timezone = model.profile?.timezone ?? "Europe/Paris" }
    }
    private func save() {
        busy = true; error = nil; saved = false
        Task { defer { busy = false }; do { try await model.mutate("profile", payload: ["displayName": .string(name), "currency": .string(currency), "timezone": .string(timezone)]); await model.load(); saved = true } catch { self.error = error.localizedDescription } }
    }
}

struct ItemEditor: View {
    enum Kind { case task, subscription, account, budget }
    let kind: Kind
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var amount = ""
    @State private var date = Date()
    @State private var hasDate = true
    @State private var space = "perso"
    @State private var priority = "medium"
    @State private var period = "monthly"
    @State private var accountKind = "checking"
    @State private var categoryId = ""
    @State private var busy = false
    @State private var error: String?
    private var title: String { switch kind { case .task: "Nouvelle tâche"; case .subscription: "Nouvel abonnement"; case .account: "Nouveau compte"; case .budget: "Budget mensuel" } }
    private var valid: Bool {
        if kind == .budget { return !categoryId.isEmpty && (Money.parse(amount) ?? 0) > 0 }
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return false }
        return kind == .task || (Money.parse(amount) != nil && (kind == .account || (Money.parse(amount) ?? 0) > 0))
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if kind == .budget { Picker("Catégorie", selection: $categoryId) { Text("Choisir").tag(""); ForEach((model.overview?.categories ?? []).filter { $0.kind == "expense" }) { Text($0.name).tag($0.id) } } }
                    else { TextField(kind == .task ? "Titre de la tâche" : "Nom", text: $name) }
                    if kind != .task { AmountField(title: kind == .account ? "Solde de départ" : "Montant", text: $amount) }
                    if kind == .subscription {
                        Picker("Catégorie", selection: $categoryId) { Text("Sans catégorie").tag(""); ForEach((model.overview?.categories ?? []).filter { $0.kind == "expense" }) { Text($0.name).tag($0.id) } }
                        Picker("Fréquence", selection: $period) { Text("Chaque semaine").tag("weekly"); Text("Chaque mois").tag("monthly"); Text("Chaque trimestre").tag("quarterly"); Text("Chaque année").tag("yearly") }
                    }
                    if kind == .task || kind == .subscription {
                        Toggle(kind == .task ? "Ajouter une échéance" : "Prochaine échéance", isOn: $hasDate)
                        if hasDate { DatePicker("Date", selection: $date, displayedComponents: .date) }
                    }
                    if kind == .task { Picker("Priorité", selection: $priority) { Text("Basse").tag("low"); Text("Normale").tag("medium"); Text("Haute").tag("high") } }
                    if kind == .account { AccountKindPicker(kind: $accountKind) }
                    if kind != .budget { FormSpacePicker(space: $space) }
                }
                Section { InlineError(text: error); BusyButton(title: "Enregistrer", busy: busy) { save() }.disabled(!valid) }
            }.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() }.disabled(busy) } }
                .onAppear { space = model.space == "pro" ? "pro" : "perso" }
        }.interactiveDismissDisabled(busy)
    }
    private func save() {
        busy = true; error = nil
        let due: JSONValue = hasDate ? .string(Dates.day(date, timezone: model.profile?.timezone ?? TimeZone.current.identifier)) : .null
        let path: String
        let payload: [String: JSONValue]
        switch kind {
        case .task: path = "tasks"; payload = ["title": .string(name), "priority": .string(priority), "dueDate": due, "space": .string(space)]
        case .subscription: path = "subscriptions"; payload = ["name": .string(name), "amount": .number(Money.parse(amount) ?? 0), "period": .string(period), "nextDue": due, "space": .string(space), "categoryId": .optional(categoryId.isEmpty ? nil : categoryId)]
        case .account: path = "accounts"; payload = ["name": .string(name), "kind": .string(accountKind), "openingBalance": .number(Money.parse(amount) ?? 0), "space": .string(space)]
        case .budget: path = "budgets"; payload = ["categoryId": .string(categoryId), "monthlyLimit": .number(Money.parse(amount) ?? 0)]
        }
        Task { defer { busy = false }; do { try await model.mutate(path, payload: payload); dismiss() } catch { self.error = error.localizedDescription } }
    }
}

struct SubscriptionCategoryEditor: View {
    let subscription: Subscription
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var category = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section(subscription.name) {
                    Picker("Catégorie", selection: $category) {
                        Text("Sans catégorie").tag("")
                        ForEach((model.overview?.categories ?? []).filter { $0.kind == "expense" }) { Text($0.name).tag($0.id) }
                    }
                }
                Section { InlineError(text: error); BusyButton(title: "Enregistrer", busy: busy) { save() } }
            }.navigationTitle("Catégorie").navigationBarTitleDisplayMode(.inline)
                .onAppear { category = subscription.categoryId ?? "" }
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() }.disabled(busy) } }
        }.interactiveDismissDisabled(busy)
    }
    private func save() {
        busy = true; error = nil
        Task { defer { busy = false }; do {
            try await model.mutate("subscriptions/" + subscription.id, method: "PATCH", payload: ["categoryId": .optional(category.isEmpty ? nil : category)]); dismiss()
        } catch { self.error = error.localizedDescription } }
    }
}
