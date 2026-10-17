import Foundation

/// Opt-in metadata only. Never pass frames, detections, speech, or arbitrary error descriptions.
/// stderr is unbuffered and captured by `devicectl --console`; nothing is persisted on the phone.
enum PiPDiagnostics {
    static let enabled = ProcessInfo.processInfo.environment["STEPSENSE_PIP_DIAGNOSTICS"] == "1"

    static func log(_ event: String, _ fields: @autoclosure () -> String = "") {
        guard enabled else { return }
        let line = "[PiPDiag] t=\(String(format: "%.3f", ProcessInfo.processInfo.systemUptime)) \(event) \(fields())\n"
        FileHandle.standardError.write(Data(line.utf8))
    }

    static func error(_ event: String, _ error: Error) {
        let nsError = error as NSError
        log(event, "domain=\(nsError.domain) code=\(nsError.code)")
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            log(event + ".underlying", "domain=\(underlying.domain) code=\(underlying.code)")
        }
    }
}
