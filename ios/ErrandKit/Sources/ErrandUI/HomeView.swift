import ErrandKit
import SwiftUI

struct MainTabs: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView {
            HomeView().tabItem { Label("Home", systemImage: "house") }
            ActivityView().tabItem { Label("Activity", systemImage: "waveform.path.ecg") }
            SettingsView().tabItem { Label("Settings", systemImage: "slider.horizontal.3") }
        }
        .sheet(item: $model.openApproval) { approval in
            ApprovalSheet(approval: approval)
        }
    }
}

private struct QuickAction: Identifiable {
    let id = UUID()
    let icon: String
    let label: String
    let prompt: String
}

private let quickActions = [
    QuickAction(icon: "envelope", label: "Email a file", prompt: "Email [person] the file [name] and say "),
    QuickAction(icon: "terminal", label: "Project task", prompt: "In the [project] folder, "),
    QuickAction(icon: "magnifyingglass", label: "Find a file", prompt: "Find the file "),
    QuickAction(icon: "text.alignleft", label: "Summarise inbox", prompt: "Summarise the unread emails in my Mail inbox from today."),
]

struct HomeView: View {
    @EnvironmentObject private var model: AppModel
    @State private var prompt = ""
    @FocusState private var composing: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    MacCard()
                    ForEach(model.approvals) { approval in
                        WaitingCard(approval: approval)
                    }
                    Text("Quick actions").font(.system(size: 15, weight: .semibold))
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                        ForEach(quickActions) { action in
                            Button {
                                prompt = action.prompt
                                composing = true
                            } label: {
                                Label(action.label, systemImage: action.icon)
                                    .font(.system(size: 14, weight: .medium))
                                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                                    .padding(.horizontal, 14)
                                    .card()
                            }
                            .foregroundStyle(Palette.ink)
                        }
                    }
                    Text("Recent").font(.system(size: 15, weight: .semibold))
                    if model.tasks.isEmpty {
                        Text("No tasks yet. Tell your Mac what to do below.")
                            .foregroundStyle(Palette.ink2)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    } else {
                        TaskList(tasks: Array(model.tasks.prefix(5)))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .background(Palette.bg)
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle("Errand")
            .inlineNavigationTitle()
            .navigationDestination(for: String.self) { TaskDetailView(taskId: $0) }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Tell your Mac what to do…", text: $prompt, axis: .vertical)
                .lineLimit(1...5)
                .focused($composing)
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 24))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color(hex: 0xD6D1C4)))
            Button {
                let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty, model.send(.createTask(prompt: text)) {
                    prompt = ""
                    composing = false
                }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(Palette.green, in: Circle())
            }
            .disabled(prompt.trimmingCharacters(in: .whitespaces).isEmpty || !model.isOnline)
            .accessibilityLabel("Send task")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Palette.bg)
    }
}

struct MacCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let mac = model.mac
        let running = model.tasks.filter { $0.status.isActive }.count
        let today = model.tasks.filter { $0.status == .done && Calendar.current.isDateInToday($0.created) }.count
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "laptopcomputer")
                    .font(.system(size: 20))
                    .foregroundStyle(model.isOnline ? Palette.green : Palette.ink2)
                    .frame(width: 44, height: 44)
                    .background(model.isOnline ? Palette.greenTint : Palette.muted, in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 2) {
                    Text(mac?.name ?? model.pairing?.macName ?? "Your Mac").font(.system(size: 16, weight: .semibold))
                    HStack(spacing: 6) {
                        Circle().fill(model.isOnline ? Palette.green : Palette.faint).frame(width: 8, height: 8)
                        Text(statusLine).font(.footnote).foregroundStyle(Palette.ink2)
                    }
                }
                Spacer()
                Button {
                    model.send(.pause(!(mac?.paused ?? false)))
                } label: {
                    Image(systemName: mac?.paused == true ? "play.fill" : "pause.fill")
                        .frame(width: 44, height: 44)
                        .background(Palette.bg, in: Circle())
                        .overlay(Circle().stroke(Palette.line))
                }
                .foregroundStyle(Palette.ink)
                .disabled(!model.isOnline)
                .accessibilityLabel(mac?.paused == true ? "Resume agent" : "Pause agent")
            }
            HStack(spacing: 8) {
                Stat(label: "Battery", value: mac?.battery.map { "\($0.percent)%" } ?? "—")
                Stat(label: "Running", value: "\(running) \(running == 1 ? "task" : "tasks")")
                Stat(label: "Today", value: "\(today) done")
            }
        }
        .padding(16)
        .card()
    }

    private var statusLine: String {
        switch model.link {
        case .online:
            guard let mac = model.mac else { return "Online" }
            if mac.paused { return "Online · Paused" }
            let power = mac.battery.map { $0.charging ? " · On power" : " · On battery" } ?? ""
            return "Online · \(mac.busy ? "Working" : "Idle")\(power)"
        case .macOffline: return "Mac is offline or asleep"
        default: return "Connecting…"
        }
    }
}

private struct Stat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 11)).foregroundStyle(Palette.ink2)
            Text(value).font(.system(size: 14, weight: .semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Palette.bg, in: RoundedRectangle(cornerRadius: 10))
    }
}

struct WaitingCard: View {
    @EnvironmentObject private var model: AppModel
    let approval: Approval

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "clock").font(.system(size: 20)).foregroundStyle(Palette.amberInk)
            VStack(alignment: .leading, spacing: 2) {
                Text("Waiting on you").font(.caption.weight(.semibold)).foregroundStyle(Palette.amberInk)
                Text(approval.title).font(.system(size: 15, weight: .semibold))
                Text(model.task(approval.taskId)?.shortTitle ?? approval.reason)
                    .font(.footnote)
                    .foregroundStyle(Color(hex: 0x5C4A2A))
                    .lineLimit(2)
            }
            Spacer()
            Button("Review") { model.openApproval = approval }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .background(Palette.ink, in: Capsule())
        }
        .padding(14)
        .card(fill: Palette.amberTint, stroke: Palette.amberLine)
    }
}

struct TaskList: View {
    let tasks: [ErrandTask]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                NavigationLink(value: task.id) {
                    HStack(spacing: 12) {
                        StatusDot(status: task.status)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(task.shortTitle).font(.system(size: 14, weight: .medium)).lineLimit(1)
                            Text(meta(task)).font(.caption).foregroundStyle(Palette.ink2)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(Palette.faint)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .contentShape(Rectangle())
                }
                .foregroundStyle(Palette.ink)
                if index < tasks.count - 1 { Divider().overlay(Palette.line) }
            }
        }
        .card()
    }

    private func meta(_ task: ErrandTask) -> String {
        task.status.isActive
            ? "\(task.status.label) · \(task.steps.count) step\(task.steps.count == 1 ? "" : "s")"
            : "\(task.status.label) · \(relative(task.updated))"
    }
}
