import AppKit

// Render the website's rose with an opaque canvas for the iOS asset catalog.
let size = 1024
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
guard let rose = NSImage(contentsOf: root.appendingPathComponent("public/brand/kaobase-rosace.png")),
      let source = rose.cgImage(forProposedRect: nil, context: nil, hints: nil),
      let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("Unable to load the rose or create its canvas")
}
context.setFillColor(CGColor(red: 0xec / 255.0, green: 0xee / 255.0, blue: 0xe8 / 255.0, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: size, height: size))
context.interpolationQuality = .high
context.draw(source, in: CGRect(x: 112, y: 112, width: 800, height: 800))
guard let rendered = context.makeImage(), let png = NSBitmapImageRep(cgImage: rendered).representation(using: .png, properties: [:]) else { fatalError("Unable to encode icon") }
let output = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Kaobase/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
try png.write(to: output)
print("App icon rendered.")
