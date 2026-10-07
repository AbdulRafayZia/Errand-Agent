# Errand for iPhone (native)

SwiftUI app with the same screens as the web app, plus a Face ID lock and Keychain storage for the pairing keys. It talks to the same relay and Mac agent, using the same end-to-end encryption.

| Folder | What it is |
| --- | --- |
| `ErrandKit/Sources/ErrandKit` | Encryption (CryptoKit), messages, pairing, the relay connection, app state |
| `ErrandKit/Sources/ErrandUI` | The screens: pair, confirm code, home, task, approval, activity, settings, Face ID lock |
| `ErrandKit/Sources/InteropCheck` | Checks the Swift encryption against the Mac agent's TypeScript |
| `Errand/` | The app target: entry point and app icon |
| `project.yml` | XcodeGen description; the `.xcodeproj` is generated from it |

## Check it without Xcode

```bash
bun run ios:check
```

This builds the package for macOS and runs the Swift ↔ TypeScript encryption cross-check.

## Run it on your iPhone

Needs Xcode (Mac App Store) and `brew install xcodegen`.

1. Generate and open the project:
   ```bash
   cd ios && xcodegen generate && open Errand.xcodeproj
   ```
2. In Xcode, select the **Errand** target › **Signing & Capabilities**, and choose your **Team**. A free Apple ID works for your own phone. If Xcode says the bundle identifier is taken, change `com.abdulrafay.errand` to something unique.
3. Connect your iPhone by cable, pick it as the run destination, and press **Run** (⌘R).
4. First time only: on the iPhone, open Settings › General › VPN & Device Management and trust your developer certificate. Also turn on Settings › Privacy & Security › **Developer Mode**.
5. In the app, tap **Scan QR code** and run `bun run pair` on the Mac.

With a free Apple ID, the app must be re-installed from Xcode every 7 days. A paid Apple Developer account ($99/year) removes that limit and is needed for TestFlight, the App Store, and native push notifications.

## Not yet in the native app

- Push notifications: these need a paid developer account and an APNs key. Until then, use the Home Screen web app for notifications.
- Dark mode (the app is light-only for now)
