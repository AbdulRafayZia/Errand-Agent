// Asks the person at the Mac to authenticate with Touch ID or their login password.
// Usage: mac-auth "<reason shown in the system prompt>"
// Exit codes: 0 approved, 1 cancelled or failed, 2 authentication unavailable.

import Foundation
import LocalAuthentication

let reason = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Errand needs to confirm it's you."
let context = LAContext()
var availabilityError: NSError?

guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &availabilityError) else {
    FileHandle.standardError.write((availabilityError?.localizedDescription ?? "unavailable").data(using: .utf8)!)
    exit(2)
}

let done = DispatchSemaphore(value: 0)
var approved = false
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
    approved = success
    if let error { FileHandle.standardError.write(error.localizedDescription.data(using: .utf8)!) }
    done.signal()
}
done.wait()
exit(approved ? 0 : 1)
