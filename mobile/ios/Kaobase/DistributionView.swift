import SwiftUI
import Charts

struct DistributionView: View {
    let items: [DistributionItem]
    let currency: String
    var title = "Répartition des dépenses"
    @State private var percent = true
    private var total: Decimal { items.reduce(0) { $0 + $1.amount } }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(title).font(.headline)
            Picker("Afficher les montants", selection: $percent) { Text("Pourcentage").tag(true); Text(currency).tag(false) }.pickerStyle(.segmented)
            if total > 0 {
                Chart(items.filter { $0.amount > 0 }) { item in
                    SectorMark(angle: .value("Montant", NSDecimalNumber(decimal: item.amount).doubleValue), innerRadius: .ratio(0.72), angularInset: 1.5)
                        .foregroundStyle(Color(hex: item.color))
                        .accessibilityLabel(item.name).accessibilityValue(value(item.amount))
                }.frame(height: 180).chartLegend(.hidden)
                    .chartBackground { _ in VStack(spacing: 4) { Text(Money.format(total, currency: currency)).font(.headline).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6).frame(maxWidth: 120); Text("au total").font(.caption).foregroundStyle(Palette.muted) } }
            } else { Text("Aucune dépense pour cette sélection.").font(.callout).foregroundStyle(Palette.muted) }
            ForEach(items) { item in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Rectangle().fill(Color(hex: item.color)).frame(width: 8, height: 8)
                    Text(item.name).font(.subheadline)
                    Spacer(minLength: 8)
                    Text(value(item.amount)).font(.subheadline.monospacedDigit()).foregroundStyle(Palette.muted)
                }.accessibilityElement(children: .combine)
            }
        }.padding(.vertical, 8)
    }
    private func value(_ amount: Decimal) -> String {
        if !percent { return Money.format(amount, currency: currency) }
        let ratio = total > 0 ? NSDecimalNumber(decimal: amount / total).doubleValue : 0
        return ratio.formatted(.percent.precision(.fractionLength(0...1)).locale(Locale(identifier: "fr_FR")))
    }
}
