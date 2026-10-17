import SwiftUI

enum Palette {
    static let accent = Color(light: 0x4433e0, dark: 0x9a90ff)
    static let onAccent = Color(light: 0xffffff, dark: 0x17121f)
    static let paper = Color(light: 0xeceee8, dark: 0x17121f)
    static let sheet = Color(light: 0xf6f7f2, dark: 0x201a2c)
    static let ink = Color(light: 0x231a38, dark: 0xeeeaf6)
    static let gain = Color(light: 0x1d7348, dark: 0x6fd39f)
    static let loss = Color(light: 0xb0284e, dark: 0xff7d9c)
}
extension Color {
    init(rgb: UInt32) { self.init(.sRGB, red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255, opacity: 1) }
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
        })
    }
    init(hex: String) { self.init(rgb: UInt32(hex.replacingOccurrences(of: "#", with: ""), radix: 16) ?? 0x4433e0) }
}
struct BrandMark: View {
    var body: some View {
        ZStack {
            ForEach(0..<12) { index in
                Ellipse().stroke(Palette.accent.opacity(0.6), lineWidth: 1.2).frame(width: 30, height: 62).rotationEffect(.degrees(Double(index) * 15))
            }
            Circle().fill(Palette.accent).frame(width: 9, height: 9)
        }
        .accessibilityHidden(true)
    }
}
struct Panel<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View { VStack(alignment: .leading, spacing: 16) { content }.frame(maxWidth: .infinity, alignment: .leading).padding(20).background(Palette.sheet, in: RoundedRectangle(cornerRadius: 24)) }
}
struct SectionHeading: View {
    let title: String
    var body: some View { Text(title).font(.headline).foregroundStyle(Palette.ink) }
}
struct InlineError: View {
    let text: String?
    var body: some View { if let text { Label(text, systemImage: "exclamationmark.circle").font(.callout).foregroundStyle(Palette.loss).accessibilityIdentifier("formError") } }
}
struct BusyButton: View {
    let title: String
    let busy: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack { Spacer(); if busy { ProgressView().tint(Palette.onAccent) }; Text(title); Spacer() }.foregroundStyle(Palette.onAccent).padding(.vertical, 7)
        }.buttonStyle(.borderedProminent).disabled(busy)
    }
}
struct SpacePicker: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        @Bindable var model = model
        Picker("Espace", selection: $model.space) {
            Text("Tous").tag("all"); Text("Perso").tag("perso"); Text("Pro").tag("pro")
        }.pickerStyle(.segmented).onChange(of: model.space) { _, _ in Task { await model.refresh() } }
    }
}
struct FormSpacePicker: View {
    @Binding var space: String
    var body: some View { Picker("Espace", selection: $space) { Text("Personnel").tag("perso"); Text("Professionnel").tag("pro") } }
}
struct AmountField: View {
    let title: String
    @Binding var text: String
    var body: some View { TextField(title, text: $text).keyboardType(.decimalPad).accessibilityLabel(title) }
}
