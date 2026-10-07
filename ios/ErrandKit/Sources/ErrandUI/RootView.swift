import ErrandKit
import LocalAuthentication
import SwiftUI

/// Top of the app: pairing, then the main tabs, behind an optional Face ID lock.
public struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("errand.requireFaceID") private var requireFaceID = true
    @State private var unlocked = false

    public init() {}

    public var body: some View {
        ZStack {
            Palette.bg.ignoresSafeArea()
            if model.pairing == nil {
                PairView()
            } else if !model.isPaired {
                PairConfirmView()
            } else {
                MainTabs()
            }
            if requireFaceID && model.isPaired && !unlocked {
                LockView(unlocked: $unlocked)
            }
        }
        .overlay(alignment: .bottom) { ToastView() }
        .tint(Palette.green)
        .preferredColorScheme(.light)
        .onAppear { model.connect() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                model.connect()
            case .background:
                // The Mac then sends notifications instead of live updates; relock on return.
                model.disconnect()
                unlocked = false
            default:
                break
            }
        }
    }
}

// MARK: - Face ID lock

struct LockView: View {
    @Binding var unlocked: Bool
    @State private var failed = false

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Logo(size: 64)
            Text("Errand is locked").font(.title2.weight(.semibold))
            Text("Anyone holding your unlocked phone could control your Mac, so Errand asks for Face ID first.")
                .font(.subheadline)
                .foregroundStyle(Palette.ink2)
                .multilineTextAlignment(.center)
            Spacer()
            Button(failed ? "Try again" : "Unlock") { authenticate() }
                .buttonStyle(PillButtonStyle())
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.bg.ignoresSafeArea())
        .onAppear(perform: authenticate)
    }

    private func authenticate() {
        let context = LAContext()
        var error: NSError?
        // Falls back to the phone passcode when Face ID isn't set up.
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            unlocked = true
            return
        }
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Errand to control your Mac") { success, _ in
            DispatchQueue.main.async {
                unlocked = success
                failed = !success
            }
        }
    }
}

// MARK: - Shared bits

struct Logo: View {
    var size: CGFloat = 32

    var body: some View {
        Text("E")
            .font(.system(size: size * 0.5, weight: .bold))
            .foregroundStyle(Palette.bg)
            .frame(width: size, height: size)
            .background(Palette.ink, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
            .accessibilityHidden(true)
    }
}

struct Brand: View {
    var body: some View {
        HStack(spacing: 10) {
            Logo()
            Text("Errand").font(.system(size: 19, weight: .semibold))
        }
    }
}

struct ToastView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if let toast = model.toast {
            Text(toast)
                .font(.subheadline)
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Palette.ink, in: Capsule())
                .padding(.bottom, 100)
                .transition(.opacity)
                .task(id: toast) {
                    try? await Task.sleep(for: .seconds(4))
                    if model.toast == toast { model.toast = nil }
                }
        }
    }
}
