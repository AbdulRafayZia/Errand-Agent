import ErrandKit
import SwiftUI

struct PairView: View {
    @EnvironmentObject private var model: AppModel
    @State private var scanning = false
    @State private var link = ""
    @State private var badCode = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Brand()
                Text("Pair your Mac").font(.system(size: 30, weight: .semibold))
                Text("On your Mac, run `bun run pair` in the Errand folder. It shows a QR code to scan here.")
                    .foregroundStyle(Palette.ink2)

                if let error = model.pairingError {
                    Banner(text: error)
                }
                if badCode {
                    Banner(text: "That QR code isn't an Errand pairing code.")
                }

                Button {
                    badCode = false
                    scanning = true
                } label: {
                    Label("Scan QR code", systemImage: "qrcode.viewfinder")
                }
                .buttonStyle(PillButtonStyle())

                VStack(alignment: .leading, spacing: 12) {
                    StepRow(number: 1, text: "Start the Errand agent on your Mac")
                    StepRow(number: 2, text: "Scan the QR code it shows")
                    StepRow(number: 3, text: "Approve with Touch ID on the Mac")
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Or paste the pairing link").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink2)
                    TextField("https://…/#pair=…", text: $link)
                        .plainKeyboard()
                        .padding(.horizontal, 16)
                        .frame(minHeight: 48)
                        .card()
                    Button("Pair") { badCode = !model.pair(with: link) }
                        .buttonStyle(PillButtonStyle(fill: Palette.surface, foreground: Palette.ink, stroke: Palette.line))
                        .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                Note(text: "Your phone and Mac create a private key together. The relay passes messages along but can't read your tasks.")
            }
            .padding(24)
        }
        .sheet(isPresented: $scanning) {
            ScannerSheet { value in
                scanning = false
                badCode = !model.pair(with: value)
            }
        }
    }
}

struct PairConfirmView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Brand()
            Text("Confirm on your Mac").font(.system(size: 30, weight: .semibold))
            Text("Your Mac is asking for Touch ID or your password. Approve only if it shows this same code.")
                .foregroundStyle(Palette.ink2)
            Text(model.pairing?.code ?? "")
                .font(.system(size: 44, weight: .medium, design: .monospaced))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
                .card()
                .accessibilityLabel("Pairing code \(model.pairing?.code ?? "")")
            HStack(spacing: 8) {
                Circle().fill(model.awaitingMac ? Palette.amberInk : Palette.faint).frame(width: 8, height: 8)
                Text(statusText).font(.subheadline).foregroundStyle(Palette.ink2)
            }
            Note(text: "A photo of the QR code isn't enough to pair. Every new phone has to be approved by someone at your unlocked Mac.")
            Spacer()
            Button("Cancel") { model.unpair() }
                .buttonStyle(PillButtonStyle(fill: Palette.surface, foreground: Palette.ink, stroke: Palette.line))
        }
        .padding(24)
    }

    private var statusText: String {
        if model.awaitingMac { return "Waiting for you to approve on \(model.pairing?.macName ?? "your Mac")…" }
        if model.link == .macOffline { return "Your Mac isn't connected. Make sure Errand is running." }
        return "Contacting your Mac…"
    }
}

struct ScannerSheet: View {
    let onResult: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                #if os(iOS)
                QRScannerView(onResult: onResult)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16).stroke(Color(hex: 0x7FD1A0), lineWidth: 3).padding(60)
                    )
                    .aspectRatio(1, contentMode: .fit)
                #endif
                Text("Point at the QR code on your Mac").foregroundStyle(Palette.ink2)
                Spacer()
            }
            .padding(20)
            .navigationTitle("Scan the code")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }
}

struct StepRow: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Text("\(number)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.green)
                .frame(width: 24, height: 24)
                .background(Palette.greenTint, in: Circle())
            Text(text).font(.subheadline)
        }
    }
}

struct Banner: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Color(hex: 0x7D1A14))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Palette.redTint, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct Note: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock").foregroundStyle(Palette.green)
            Text(text).font(.footnote).foregroundStyle(Color(hex: 0x3D3B35))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}
