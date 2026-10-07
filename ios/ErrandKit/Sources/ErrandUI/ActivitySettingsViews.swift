import ErrandKit
import SwiftUI

struct ActivityView: View {
    @EnvironmentObject private var model: AppModel
    @State private var filter = Filter.all

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", active = "Active", done = "Done", stopped = "Stopped"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Picker("Filter", selection: $filter) {
                        ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if groups.isEmpty {
                        Text("Nothing here yet.").foregroundStyle(Palette.ink2).frame(maxWidth: .infinity).padding(.vertical, 24)
                    }
                    ForEach(groups, id: \.0) { label, tasks in
                        Text(label).font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink2).padding(.top, 6)
                        TaskList(tasks: tasks)
                    }
                }
                .padding(20)
            }
            .background(Palette.bg)
            .navigationTitle("Activity")
            .navigationDestination(for: String.self) { TaskDetailView(taskId: $0) }
        }
    }

    private var groups: [(String, [ErrandTask])] {
        let filtered = model.tasks.filter { task in
            switch filter {
            case .all: true
            case .active: task.status.isActive
            case .done: task.status == .done
            case .stopped: task.status == .stopped || task.status == .failed
            }
        }
        let calendar = Calendar.current
        var result: [(String, [ErrandTask])] = []
        for task in filtered {
            let label = calendar.isDateInToday(task.created) ? "Today" : calendar.isDateInYesterday(task.created) ? "Yesterday" : "Earlier"
            if let index = result.firstIndex(where: { $0.0 == label }) {
                result[index].1.append(task)
            } else {
                result.append((label, [task]))
            }
        }
        return result
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("errand.requireFaceID") private var requireFaceID = true
    @State private var confirmUnpair = false

    var body: some View {
        NavigationStack {
            Form {
                Section("This Mac") {
                    LabeledContent("Name", value: model.mac?.name ?? model.pairing?.macName ?? "—")
                    Toggle("Pause agent", isOn: Binding(
                        get: { model.mac?.paused ?? false },
                        set: { model.send(.pause($0)) }
                    ))
                    .disabled(model.mac == nil)
                    LabeledContent("Model", value: model.mac?.model ?? "—")
                    LabeledContent("Agent version", value: model.mac?.version ?? "—")
                }
                Section {
                    ForEach(model.mac?.allowedFolders ?? [], id: \.self) { folder in
                        Label(folder.replacingOccurrences(of: #"^/Users/[^/]+"#, with: "~", options: .regularExpression), systemImage: "folder")
                            .font(.system(size: 14, design: .monospaced))
                    }
                } header: {
                    Text("Allowed folders")
                } footer: {
                    Text("Errand asks before sending email, running unknown commands, or touching files outside these folders.")
                }
                Section {
                    Toggle("Require Face ID", isOn: $requireFaceID)
                } header: {
                    Text("Security")
                } footer: {
                    Text("Ask for Face ID each time Errand opens, so someone holding your unlocked phone can't control your Mac.")
                }
                Section {
                    Button(role: .destructive) {
                        model.send(.stopAll)
                    } label: {
                        Label("Stop everything", systemImage: "stop.fill")
                    }
                    .disabled(model.mac == nil)
                    Button("Unpair this phone", role: .destructive) { confirmUnpair = true }
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Unpair this phone?", isPresented: $confirmUnpair, titleVisibility: .visible) {
                Button("Unpair", role: .destructive) { model.unpair() }
            } message: {
                Text("You'll need to scan a new code from your Mac. To remove it on the Mac too, run `bun run revoke`.")
            }
        }
    }
}
