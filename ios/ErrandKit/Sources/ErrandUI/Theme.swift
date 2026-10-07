import ErrandKit
import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// Same tokens as the mockups and the web app.
enum Palette {
    static let bg = Color(hex: 0xF5F3EE)
    static let surface = Color.white
    static let line = Color(hex: 0xE4E0D6)
    static let ink = Color(hex: 0x1B1B18)
    static let ink2 = Color(hex: 0x5C5A52)
    static let faint = Color(hex: 0x8A877D)
    static let green = Color(hex: 0x23704A)
    static let greenTint = Color(hex: 0xE3F0E7)
    static let amberInk = Color(hex: 0x7A4E06)
    static let amberTint = Color(hex: 0xFBEFD9)
    static let amberLine = Color(hex: 0xE8C88A)
    static let red = Color(hex: 0xB3261E)
    static let redTint = Color(hex: 0xF3E1DF)
    static let blue = Color(hex: 0x1F5FAD)
    static let blueTint = Color(hex: 0xE3ECF7)
    static let muted = Color(hex: 0xECEAE4)
}

struct CardStyle: ViewModifier {
    var fill: Color = Palette.surface
    var stroke: Color = Palette.line

    func body(content: Content) -> some View {
        content
            .background(fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(stroke, lineWidth: 1))
    }
}

extension View {
    func card(fill: Color = Palette.surface, stroke: Color = Palette.line) -> some View {
        modifier(CardStyle(fill: fill, stroke: stroke))
    }

    /// iOS-only modifiers, skipped when the package is compile-checked on macOS.
    @ViewBuilder func inlineNavigationTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    @ViewBuilder func plainKeyboard() -> some View {
        #if os(iOS)
        textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        autocorrectionDisabled()
        #endif
    }
}

struct PillButtonStyle: ButtonStyle {
    var fill: Color = Palette.green
    var foreground: Color = .white
    var stroke: Color? = nil

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(foreground)
            .background(fill, in: Capsule())
            .overlay(Capsule().stroke(stroke ?? .clear, lineWidth: 1.5))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct StatusDot: View {
    let status: TaskStatus
    var size: CGFloat = 28

    var body: some View {
        let (symbol, fg, bg): (String, Color, Color) = switch status {
        case .done: ("checkmark", Palette.green, Palette.greenTint)
        case .waiting: ("clock", Palette.amberInk, Palette.amberTint)
        case .running, .queued: ("clock", Palette.blue, Palette.blueTint)
        case .failed: ("xmark", Palette.red, Palette.redTint)
        case .stopped: ("stop.fill", Palette.ink2, Palette.muted)
        }
        Image(systemName: symbol)
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(fg)
            .frame(width: size, height: size)
            .background(bg, in: Circle())
            .accessibilityLabel(status.label)
    }
}

extension ErrandTask {
    var shortTitle: String {
        let text = prompt.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return text.count > 60 ? String(text.prefix(59)) + "…" : text
    }
}

func relative(_ date: Date) -> String {
    let seconds = Date().timeIntervalSince(date)
    if seconds < 45 { return "now" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    return formatter.localizedString(for: date, relativeTo: Date())
}
