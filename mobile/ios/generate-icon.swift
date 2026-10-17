import AppKit

// Vector version of Kaobase's guilloche mark, rendered for the iOS asset catalog.
let size = 1024
let image = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: image)
NSColor(red: 0xec / 255.0, green: 0xee / 255.0, blue: 0xe8 / 255.0, alpha: 1).setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: size, height: size)).fill()
NSColor(red: 0x44 / 255.0, green: 0x33 / 255.0, blue: 0xe0 / 255.0, alpha: 1).setStroke()
for index in 0..<12 {
    let path = NSBezierPath(ovalIn: NSRect(x: -155, y: -330, width: 310, height: 660))
    var transform = AffineTransform()
    transform.translate(x: 512, y: 512)
    transform.rotate(byDegrees: CGFloat(index) * 15)
    path.transform(using: transform)
    path.lineWidth = 9
    path.stroke()
}
NSColor(red: 0x44 / 255.0, green: 0x33 / 255.0, blue: 0xe0 / 255.0, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 465, y: 465, width: 94, height: 94)).fill()
NSGraphicsContext.restoreGraphicsState()
let output = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Kaobase/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
try image.representation(using: .png, properties: [:])!.write(to: output)
print("App icon rendered.")
