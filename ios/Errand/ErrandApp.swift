import ErrandKit
import ErrandUI
import SwiftUI
import UIKit

@main
struct ErrandApp: App {
    @StateObject private var model = AppModel(deviceName: UIDevice.current.name)

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
        }
    }
}
