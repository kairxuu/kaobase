import SwiftUI
import Charts

struct DashboardView: View {
    @Environment(AppModel.self) private var model
    @State private var addTransaction = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.isDemo ? "APERÇU · DONNÉES FICTIVES" : "TON ESPACE, EN CLAIR").font(.caption2.weight(.semibold)).tracking(2).foregroundStyle(Palette.muted)
                            Text("Bonjour\(model.profile?.displayName.flatMap { $0.isEmpty ? nil : ", " + $0 } ?? "").").font(.system(size: 32, weight: .medium, design: .default))
                        }
                        Spacer(); BrandMark().frame(width: 48, height: 60)
                    }
                    SpacePicker()
                    if let data = model.overview {
                        balancePanel(data)
                        HStack(spacing: 12) {
                            metric("Entrées ce mois", amount: data.summary.income, icon: "arrow.down.left", color: Palette.gain)
                            metric("Sorties ce mois", amount: data.summary.expenses, icon: "arrow.up.right", color: Palette.loss)
                        }
                        Panel {
                            NavigationLink { SavingsView() } label: {
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack { SectionHeading(title: "Dont épargne"); Spacer(); Image(systemName: "arrow.up.right") }
                                    ForEach(data.savingsBalances, id: \.currency) { item in
                                        Text(Money.format(item.amount, currency: item.currency)).font(.title2.weight(.semibold)).monospacedDigit()
                                    }
                                    Text(data.savings.isEmpty ? "Ajouter un Livret A, un LEP…" : "\(data.savings.count) \(data.savings.count == 1 ? "compte" : "comptes") · déjà inclus dans le solde total").font(.caption).foregroundStyle(Palette.muted)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(.plain)
                        }
                        if !data.apps.filter(\.pinned).isEmpty {
                            Panel {
                                SectionHeading(title: "À portée de main")
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))], spacing: 18) {
                                    ForEach(data.apps.filter(\.pinned)) { app in
                                        if let url = app.destination {
                                            Link(destination: url) {
                                                VStack(spacing: 8) {
                                                    AppLogo(url: app.url, size: 46)
                                                    Text(app.name).font(.caption).lineLimit(1)
                                                }
                                            }.accessibilityLabel("Ouvrir \(app.name)")
                                        }
                                    }
                                }
                            }
                        }
                        Panel {
                            NavigationLink { SubscriptionsView() } label: {
                                HStack { SectionHeading(title: "Abonnements"); Spacer(); Image(systemName: "arrow.up.right") }
                            }.buttonStyle(.plain)
                            let active = data.subscriptions.filter { $0.status == "active" }
                            Text(Money.format(active.reduce(0) { $0 + $1.monthlyCost }, currency: model.currency) + " / mois").font(.title3.weight(.semibold)).monospacedDigit()
                            if let next = active.first, let due = next.nextDue { Text("À venir : \(next.name) · \(Dates.label(due))").font(.caption).foregroundStyle(Palette.muted) }
                        }
                        Panel {
                            NavigationLink { TasksView() } label: {
                                HStack { SectionHeading(title: "À faire"); Spacer(); Image(systemName: "arrow.up.right") }
                            }.buttonStyle(.plain)
                            let remaining = data.tasks.filter { $0.status != "done" }
                            if remaining.isEmpty { Text("Aucune tâche en attente.").font(.subheadline).foregroundStyle(Palette.muted) }
                            ForEach(remaining.prefix(3)) { task in Text(task.title).font(.subheadline) }
                        }
                        Panel {
                            SectionHeading(title: "Dernières opérations")
                            if data.transactions.isEmpty { Text("Ajoute ta première opération pour commencer.").foregroundStyle(Palette.muted) }
                            ForEach(data.transactions.prefix(5)) { transaction in TransactionRow(transaction: transaction) }
                        }
                    }
                }.padding(20).frame(maxWidth: 720)
            }.frame(maxWidth: .infinity).background(Palette.paper).foregroundStyle(Palette.ink)
                .navigationTitle("Kaobase").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Ajouter une opération", systemImage: "plus") { addTransaction = true } } }
                .refreshable { await model.refresh() }
                .sheet(isPresented: $addTransaction) { TransactionEditor() }
        }
    }
    private func balancePanel(_ data: Overview) -> some View {
        Panel {
            Text("SOLDE DE TES COMPTES").font(.caption.weight(.semibold)).tracking(1.6).foregroundStyle(Palette.muted)
            if data.balances.isEmpty { Text("Aucun compte").font(.title) }
            ForEach(data.balances, id: \.currency) { item in
                Text(Money.format(item.amount, currency: item.currency)).font(.system(size: 38, weight: .medium, design: .default)).minimumScaleFactor(0.6).lineLimit(1)
            }
            Button { addTransaction = true } label: { Label("Ajouter une opération", systemImage: "plus").foregroundStyle(Palette.onAccent).frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).padding(.top, 4)
        }
    }
    private func metric(_ title: String, amount: Decimal, icon: String, color: Color) -> some View {
        Panel { Image(systemName: icon).foregroundStyle(color); Text(title).font(.caption).foregroundStyle(Palette.muted); Text(Money.format(amount, currency: model.currency)).font(.headline).minimumScaleFactor(0.6).lineLimit(1) }
    }
}

struct TransactionRow: View {
    @Environment(AppModel.self) private var model
    let transaction: Transaction
    private var category: Category? { model.overview?.categories.first { $0.id == transaction.categoryId } }
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: transaction.amount > 0 ? "arrow.down.left" : "arrow.up.right").font(.callout.weight(.medium)).foregroundStyle(transaction.amount > 0 ? Palette.gain : Palette.ink).frame(width: 38, height: 38).background((category.map { Color(hex: $0.color) } ?? Palette.accent).opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 4) { Text(transaction.labelRaw).font(.subheadline.weight(.medium)).lineLimit(1); Text("\(category?.name ?? "Non catégorisé") · \(Dates.label(transaction.bookedAt))").font(.caption).foregroundStyle(Palette.muted) }
            Spacer(minLength: 4)
            Text(Money.format(transaction.amount, currency: model.overview?.accounts.first { $0.id == transaction.accountId }?.currency ?? model.currency)).font(.subheadline.monospacedDigit()).foregroundStyle(transaction.amount > 0 ? Palette.gain : Palette.ink)
        }.accessibilityElement(children: .combine)
    }
}
