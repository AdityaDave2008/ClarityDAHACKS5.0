import Foundation
import WebKit

/// Serves only packaged assets. No HTTP server, remote URL, or runtime download is involved.
final class OfflineAssetHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.scheme == "stepsense", url.host == "offline",
              !url.pathComponents.contains("..") else {
            task.didFailWithError(URLError(.noPermissionsToReadFile)); return
        }
        let file = root.appendingPathComponent(url.path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else {
            task.didFailWithError(URLError(.noPermissionsToReadFile)); return
        }
        do {
            let data = try Data(contentsOf: file)
            let mime: String
            switch file.pathExtension {
            case "html": mime = "text/html"
            case "js": mime = "application/javascript"
            case "json": mime = "application/json"
            case "wasm": mime = "application/wasm"
            default: mime = "application/octet-stream"
            }
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mime, "Content-Length": String(data.count), "Access-Control-Allow-Origin": "*"])!
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        } catch { task.didFailWithError(error) }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

enum OfflineDetectorError: LocalizedError {
    case unavailable(String)
    var errorDescription: String? {
        switch self { case .unavailable(let message): return "Offline detection: \(message)" }
    }
}

/// MainActor owns WebKit only. Inference executes in WebKit's process, not the camera/UI thread.
/// Exactly one operation is pending. A timeout destroys the view so late messages cannot cross runs.
@MainActor
final class OfflineDetector: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private(set) var webView: WKWebView?
    private let resourceRoot: URL?
    private var pending: (id: String, token: UUID, continuation: CheckedContinuation<Data, Error>)?
    private var timeout: Task<Void, Never>?
    private(set) var backend = "not loaded"

    init(resourceRoot: URL? = Bundle.main.url(forResource: "OfflineDetector", withExtension: nil)) {
        self.resourceRoot = resourceRoot
    }

    func start() async throws -> [NormalizedPoint] {
        stop()
        guard let root = resourceRoot else { throw OfflineDetectorError.unavailable("Bundled model is missing.") }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(OfflineAssetHandler(root: root), forURLScheme: "stepsense")
        configuration.userContentController.add(self, name: "detector")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        webView = view
        let data = try await waitForReply(id: "ready", seconds: 60) {
            view.load(URLRequest(url: URL(string: "stepsense://offline/index.html")!))
        }
        struct Ready: Decodable { let backend: String; let zone: [NormalizedPoint] }
        let ready = try JSONDecoder().decode(Ready.self, from: data)
        backend = ready.backend
        return ready.zone
    }

    func analyze(jpeg: Data, sequence: Int, preferences: ScanPreferences, capturedAt: TimeInterval) async throws -> FrameAnalysis {
        guard let view = webView else { throw OfflineDetectorError.unavailable("Model not loaded. Stop and Start to retry.") }
        let id = UUID().uuidString
        let settings = try JSONSerialization.jsonObject(with: JSONEncoder().encode(preferences))
        let data = try await waitForReply(id: id, seconds: 15) {
            view.callAsyncJavaScript("window.analyzeOffline(id, jpeg, sequence, preferences, ageMs)",
                arguments: ["id": id, "jpeg": jpeg.base64EncodedString(), "sequence": sequence,
                            "preferences": settings, "ageMs": max(0, (ProcessInfo.processInfo.systemUptime - capturedAt) * 1000)],
                in: nil, in: .page) { [weak self] result in
                    if case .failure(let error) = result { self?.finish(id: id, result: .failure(error)) }
                }
        }
        return try JSONDecoder().decode(FrameAnalysis.self, from: data)
    }

    private func waitForReply(id: String, seconds: UInt64, send: () -> Void) async throws -> Data {
        try Task.checkCancellation()
        guard pending == nil else { throw OfflineDetectorError.unavailable("A frame is already being processed.") }
        let token = UUID()
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                pending = (id, token, continuation)
                timeout = Task { [weak self] in
                    do { try await Task.sleep(nanoseconds: seconds * 1_000_000_000) } catch { return }
                    guard let self, self.pending?.token == token else { return }
                    self.finish(id: id, result: .failure(OfflineDetectorError.unavailable("Inference timed out. Stop and Start to retry.")))
                    self.stop()
                }
                send()
            }
        }, onCancel: { [weak self] in
            Task { @MainActor in
                guard self?.pending?.token == token else { return }
                self?.stop()
            }
        })
    }

    private func finish(id: String, result: Result<Data, Error>) {
        guard let operation = pending, operation.id == id else { return }
        pending = nil
        timeout?.cancel()
        timeout = nil
        operation.continuation.resume(with: result)
    }

    func stop() {
        if let id = pending?.id { finish(id: id, result: .failure(CancellationError())) }
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "detector")
        webView?.navigationDelegate = nil
        webView = nil
        backend = "not loaded"
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === webView, let body = message.body as? [String: Any], let id = body["id"] as? String else { return }
        if let error = body["error"] as? String {
            finish(id: id, result: .failure(OfflineDetectorError.unavailable(error)))
        } else if let value = body["value"] {
            do { finish(id: id, result: .success(try JSONSerialization.data(withJSONObject: value))) }
            catch { finish(id: id, result: .failure(error)) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.scheme == "stepsense" && action.request.url?.host == "offline" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView else { return }
        if let id = pending?.id { finish(id: id, result: .failure(error)) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        if let id = pending?.id { finish(id: id, result: .failure(OfflineDetectorError.unavailable("WebKit stopped. Stop and Start to retry."))) }
        stop()
    }
}
