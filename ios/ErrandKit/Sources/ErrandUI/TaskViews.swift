import ErrandKit
import SwiftUI

struct TaskDetailView: View {
    @EnvironmentObject private var model: AppModel
    let taskId: String
    @State private var followup = ""

    var body: some View {
        Group {
            if let task = model.task(taskId) {
                content(task)
            } else {
                Text("This task isn't available.").foregroundStyle(Palette.ink2)
            }
        }
        .background(Palette.bg)
        .navigationTitle(model.task(taskId)?.shortTitle ?? "Task")
        .inlineNavigationTitle()
    }

    private func content(_ task: ErrandTask) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("\(task.status.label)\(task.costUsd.map { String(format: " · $%.2f", $0) } ?? "")")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(task.status == .waiting ? Palette.amberInk : task.status == .failed ? Palette.red : Palette.ink2)
                    ForEach([task.prompt] + task.followups, id: \.self) { text in
                        Text(text)
                            .foregroundStyle(Palette.bg)
                            .padding(12)
                            .background(Palette.ink, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 4, topTrailingRadius: 18))
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    if !task.steps.isEmpty { steps(task) }
                    if task.status.isActive, let note = task.note {
                        ResultCard(title: "Latest from your Mac", text: note, tone: Palette.ink2)
                    }
                    if let result = task.result { ResultCard(title: "Result", text: result, tone: Palette.green) }
                    if let error = task.error { ResultCard(title: task.status.label, text: error, tone: Palette.red) }
                    if !task.filesTouched.isEmpty {
                        Text("Files touched").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink2)
                        ForEach(task.filesTouched, id: \.self) { path in
                            Label(path.split(separator: "/").suffix(2).joined(separator: "/"), systemImage: "doc")
                                .font(.system(size: 13, design: .monospaced))
                                .lineLimit(1)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .card()
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(20)
            }
            .onChange(of: task.steps.count) { _, _ in withAnimation { proxy.scrollTo("bottom") } }
            .safeAreaInset(edge: .bottom) { footer(task) }
        }
    }

    private func steps(_ task: ErrandTask) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(task.steps) { step in
                if let pending = model.approvals.first(where: { $0.stepId == step.id }) {
                    HStack(spacing: 12) {
                        StepIcon(status: .waiting)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(step.title).font(.system(size: 14, weight: .medium))
                            Text("Needs your approval").font(.caption).foregroundStyle(Palette.ink2)
                        }
                        Spacer()
                        Button("Review") { model.openApproval = pending }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 40)
                            .background(Palette.ink, in: Capsule())
                    }
                    .padding(10)
                    .background(Palette.amberTint, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.amberLine))
                } else {
                    HStack(alignment: .top, spacing: 12) {
                        StepIcon(status: step.status)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(step.title).font(.system(size: 14, weight: .medium))
                            if step.status == .denied {
                                Text("You denied this").font(.caption).foregroundStyle(Palette.ink2)
                            } else if let detail = step.detail {
                                Text(detail).font(.system(size: 12, design: .monospaced)).foregroundStyle(Palette.ink2).lineLimit(3)
                            }
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func footer(_ task: ErrandTask) -> some View {
        HStack(spacing: 8) {
            TextField(task.status.isActive ? "Wait for it to finish…" : "Add an instruction…", text: $followup)
                .padding(.horizontal, 16)
                .frame(minHeight: 48)
                .background(Palette.surface, in: Capsule())
                .overlay(Capsule().stroke(Color(hex: 0xD6D1C4)))
                .disabled(task.status.isActive)
            if task.status.isActive {
                Button {
                    model.send(.stopTask(taskId: task.id))
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, 16)
                        .frame(minHeight: 48)
                        .foregroundStyle(Palette.red)
                        .background(Palette.surface, in: Capsule())
                        .overlay(Capsule().stroke(Palette.red, lineWidth: 1.5))
                }
            } else {
                Button {
                    let text = followup.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty, model.send(.followup(taskId: task.id, prompt: text)) { followup = "" }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .background(Palette.green, in: Circle())
                }
                .disabled(followup.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel("Send instruction")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Palette.bg)
    }
}

private struct StepIcon: View {
    let status: StepStatus

    var body: some View {
        let (symbol, fg, bg): (String, Color, Color) = switch status {
        case .done: ("checkmark", Palette.green, Palette.greenTint)
        case .running: ("clock", Palette.blue, Palette.blueTint)
        case .waiting: ("clock", .white, Palette.amberInk)
        case .error, .denied: ("xmark", Palette.red, Palette.redTint)
        }
        Image(systemName: symbol)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(fg)
            .frame(width: 24, height: 24)
            .background(bg, in: Circle())
    }
}

private struct ResultCard: View {
    let title: String
    let text: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(tone)
            Text(text).textSelection(.enabled)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

struct ApprovalSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let approval: Approval
    @State private var remember = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Needs your approval")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.amberInk)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Palette.amberTint, in: Capsule())
                    .overlay(Capsule().stroke(Palette.amberLine))
                Text(approval.title).font(.system(size: 24, weight: .semibold))
                Text(approval.reason).foregroundStyle(Palette.ink2)
                preview
                if let label = approval.rememberLabel {
                    Toggle(label, isOn: $remember).font(.subheadline)
                }
                Button {
                    if model.send(.respond(approvalId: approval.id, approve: true, remember: remember)) { dismiss() }
                } label: {
                    Label("Approve", systemImage: "checkmark")
                }
                .buttonStyle(PillButtonStyle())
                Button("Deny") {
                    if model.send(.respond(approvalId: approval.id, approve: false, remember: false)) { dismiss() }
                }
                .buttonStyle(PillButtonStyle(fill: Palette.surface, foreground: Palette.red, stroke: Palette.red))
            }
            .padding(20)
        }
        .background(Palette.bg)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder private var preview: some View {
        let p = approval.preview
        if approval.kind == .email {
            VStack(alignment: .leading, spacing: 0) {
                EmailRow(label: "To", value: (p.to ?? []).joined(separator: ", "))
                Divider().overlay(Palette.line)
                EmailRow(label: "Subject", value: p.subject ?? "")
                Divider().overlay(Palette.line)
                Text(p.body ?? "").font(.subheadline).padding(16).frame(maxWidth: .infinity, alignment: .leading)
                ForEach(p.attachments ?? [], id: \.self) { file in
                    Label(file.split(separator: "/").last.map(String.init) ?? file, systemImage: "paperclip")
                        .font(.system(size: 13, design: .monospaced))
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.bg, in: RoundedRectangle(cornerRadius: 10))
                        .padding([.horizontal, .bottom], 16)
                }
            }
            .card()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach([p.command, p.path, p.input].compactMap { $0 }, id: \.self) { text in
                    Text(text).font(.system(size: 13, design: .monospaced)).textSelection(.enabled)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }
}

private struct EmailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(label).foregroundStyle(Palette.ink2).frame(width: 60, alignment: .leading)
            Text(value).fontWeight(.medium)
        }
        .font(.subheadline)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
