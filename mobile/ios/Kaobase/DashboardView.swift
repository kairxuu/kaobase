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
                            Text(model.isDemo ? "APERÇU · DONNÉES FICTIVES" : "TON ESPACE, EN CLAIR").font(.caption2.weight(.semibold)).tracking(2).foregroundStyle(.secondary)
                            Text("Bonjour\(model.profile?.displayName.flatMap { $0.isEmpty ? nil : ", " + $0 } ?? "").").font(.system(size: 32, weight: .medium, design: .serif))
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
                        if !data.apps.filter(\.pinned).isEmpty {
                            Panel {
                                SectionHeading(title: "À portée de main")
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))], spacing: 18) {
                                    ForEach(data.apps.filter(\.pinned)) { app in
                                        if let url = app.destination {
                                            Link(destination: url) {
                                                VStack(spacing: 8) {
                                                    Text(String(app.name.prefix(1)).uppercased()).font(.title2.weight(.semibold)).frame(width: 50, height: 50).background(Palette.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 15))
                                                    Text(app.name).font(.caption).lineLimit(1)
                                                }
                                            }.accessibilityLabel("Ouvrir \(app.name)")
                                        }
                                    }
                                }
                            }
                        }
                        if !data.summary.byCategory.isEmpty {
                            Panel {
                                SectionHeading(title: "Où va ton argent ?")
                                Chart(data.summary.byCategory.prefix(6)) { category in
                                    BarMark(x: .value("Montant", NSDecimalNumber(decimal: category.total).doubleValue), y: .value("Catégorie", category.name))
                                        .foregroundStyle(Color(hex: category.color)).cornerRadius(5)
                                }.frame(height: CGFloat(min(data.summary.byCategory.count, 6) * 36)).chartXAxis(.hidden)
                                ForEach(data.summary.byCategory.prefix(4)) { category in
                                    HStack { Circle().fill(Color(hex: category.color)).frame(width: 7, height: 7); Text(category.name).font(.subheadline); Spacer(); Text(Money.format(category.total, currency: model.currency)).font(.subheadline.monospacedDigit()) }
                                }
                            }
                        }
                        if !data.budgets.isEmpty {
                            Panel {
                                SectionHeading(title: "Tes budgets")
                                ForEach(data.budgets) { budget in
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack { Text(budget.category); Spacer(); Text("\(budget.percent) %").foregroundStyle(budget.percent > 100 ? Palette.loss : Palette.accent) }.font(.subheadline)
                                        ProgressView(value: min(max(Double(budget.percent), 0), 100), total: 100).tint(budget.percent > 100 ? Palette.loss : Palette.accent)
                                        Text("\(Money.format(budget.spent, currency: model.currency)) sur \(Money.format(budget.limit, currency: model.currency))").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        Panel {
                            SectionHeading(title: "Dernières opérations")
                            if data.transactions.isEmpty { Text("Ajoute ta première opération pour commencer.").foregroundStyle(.secondary) }
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
            Text("SOLDE DE TES COMPTES").font(.caption.weight(.semibold)).tracking(1.6).foregroundStyle(.secondary)
            if data.balances.isEmpty { Text("Aucun compte").font(.title) }
            ForEach(data.balances, id: \.currency) { item in
                Text(Money.format(item.amount, currency: item.currency)).font(.system(size: 38, weight: .medium, design: .serif)).minimumScaleFactor(0.6).lineLimit(1)
            }
            ForEach(data.accounts) { account in
                HStack { Label(account.name, systemImage: account.kind == "savings" ? "leaf" : "building.columns").font(.subheadline); Spacer(); Text(Money.format(account.balance, currency: account.currency)).font(.subheadline.monospacedDigit()) }.foregroundStyle(.secondary)
            }
            Button { addTransaction = true } label: { Label("Ajouter une opération", systemImage: "plus").foregroundStyle(Palette.onAccent).frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).padding(.top, 4)
        }
    }
    private func metric(_ title: String, amount: Decimal, icon: String, color: Color) -> some View {
        Panel { Image(systemName: icon).foregroundStyle(color); Text(title).font(.caption).foregroundStyle(.secondary); Text(Money.format(amount, currency: model.currency)).font(.headline).minimumScaleFactor(0.6).lineLimit(1) }
    }
}

struct TransactionRow: View {
    @Environment(AppModel.self) private var model
    let transaction: Transaction
    private var category: Category? { model.overview?.categories.first { $0.id == transaction.categoryId } }
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: transaction.amount > 0 ? "arrow.down.left" : "arrow.up.right").font(.callout.weight(.medium)).foregroundStyle(transaction.amount > 0 ? Palette.gain : Palette.ink).frame(width: 38, height: 38).background((category.map { Color(hex: $0.color) } ?? Palette.accent).opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 4) { Text(transaction.labelRaw).font(.subheadline.weight(.medium)).lineLimit(1); Text("\(category?.name ?? "Non catégorisé") · \(Dates.label(transaction.bookedAt))").font(.caption).foregroundStyle(.secondary) }
            Spacer(minLength: 4)
            Text(Money.format(transaction.amount, currency: model.overview?.accounts.first { $0.id == transaction.accountId }?.currency ?? model.currency)).font(.subheadline.monospacedDigit()).foregroundStyle(transaction.amount > 0 ? Palette.gain : Palette.ink)
        }.accessibilityElement(children: .combine)
    }
}
