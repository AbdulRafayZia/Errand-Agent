// swift-tools-version:5.10
import PackageDescription

// Core of the native Errand iPhone app.
// - ErrandKit: encryption, pairing, messages and the relay connection.
// - ErrandUI: the SwiftUI screens.
// Both build on macOS too, so they can be checked without Xcode, and
// `swift run InteropCheck` verifies the crypto against the Mac agent's TypeScript.
let package = Package(
    name: "ErrandKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "ErrandKit", targets: ["ErrandKit"]),
        .library(name: "ErrandUI", targets: ["ErrandUI"]),
    ],
    targets: [
        .target(name: "ErrandKit"),
        .target(name: "ErrandUI", dependencies: ["ErrandKit"]),
        .executableTarget(name: "InteropCheck", dependencies: ["ErrandKit"]),
    ]
)
