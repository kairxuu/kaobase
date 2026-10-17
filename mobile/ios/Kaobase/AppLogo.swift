import SwiftUI

/// Match the website's local logos; only a public hostname reaches the fallback provider.
enum AppIcons {
    static let local: Set<String> = ["amazon.fr", "mail.google.com", "drive.google.com", "calendar.google.com", "notion.so", "slack.com", "github.com", "outlook.live.com", "onedrive.live.com", "open.spotify.com", "dropbox.com", "trello.com", "netflix.com", "paypal.com", "canva.com", "figma.com", "proton.me"]
    static let aliases = ["amazon.com": "amazon.fr", "amazon.de": "amazon.fr", "amazon.co.uk": "amazon.fr", "notion.com": "notion.so", "spotify.com": "open.spotify.com", "gmail.com": "mail.google.com", "outlook.com": "outlook.live.com", "onedrive.com": "onedrive.live.com", "protonmail.com": "proton.me", "mail.proton.me": "proton.me"]
    static func host(_ value: String) -> String? {
        guard let url = safeExternalURL(value), var host = url.host?.lowercased() else { return nil }
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
        guard host.count <= 253, host.range(of: #"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"#, options: .regularExpression) != nil,
              !["local", "localhost", "internal", "test", "invalid", "example"].contains(String(host.split(separator: ".").last ?? "")) else { return nil }
        return aliases[host] ?? host
    }
}
struct AppLogo: View {
    let url: String
    var size: CGFloat = 42
    var body: some View {
        Group {
            if let host = AppIcons.host(url) {
                if AppIcons.local.contains(host) { Image("App_" + host).resizable().scaledToFit() }
                else { AsyncImage(url: URL(string: "https://icon.horse/icon/" + host)) { phase in
                    if let image = phase.image { image.resizable().scaledToFit() } else { fallback }
                } }
            } else { fallback }
        }.padding(6).frame(width: size, height: size).background(Color.white, in: RoundedRectangle(cornerRadius: 4)).accessibilityHidden(true)
    }
    private var fallback: some View { Image(systemName: "square.grid.2x2").resizable().scaledToFit().foregroundStyle(Palette.accent).padding(4) }
}
