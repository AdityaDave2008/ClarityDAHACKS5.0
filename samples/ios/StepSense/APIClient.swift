import Foundation

enum AlertMode: String, Codable, CaseIterable, Identifiable {
    case sound, vibration, speech
    var id: String { rawValue }
    var title: String {
        switch self {
        case .sound: return "Sound"
        case .vibration: return "Haptics"
        case .speech: return "Spoken alerts"
        }
    }
    var symbol: String {
        switch self {
        case .sound: return "speaker.wave.2.fill"
        case .vibration: return "iphone.radiowaves.left.and.right"
        case .speech: return "waveform"
        }
    }
}

struct ScanPreferences: Codable, Equatable {
    var alertModes: [AlertMode] = [.sound]
    var confidenceThreshold: Double = 0.6
    var cooldownMs: Int = 3000
    // Optional storage preserves decoding of preferences saved before LiDAR existed.
    private var lidarEnabled: Bool? = nil
    var isLidarEnabled: Bool {
        get { lidarEnabled ?? false }
        set { lidarEnabled = newValue }
    }
}

struct ScanSession: Decodable {
    let sessionId: String
    let preset: String
    let preferences: ScanPreferences
    let expiresAt: String
}

struct NormalizedPoint: Decodable, Equatable {
    let x: Double
    let y: Double
}

struct NormalizedBox: Decodable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct Detection: Decodable, Equatable {
    let label: String
    let confidence: Double
    let bbox: NormalizedBox
    let anchor: NormalizedPoint
    let inZone: Bool
    // Native-only enrichment. The detector does not supply or use depth for alerts.
    var depthMeters: Double? = nil
    var depthRequested: Bool? = nil
    var depthExpiresAt: TimeInterval? = nil
    var depthLabel: String? { depthLabel(at: ProcessInfo.processInfo.systemUptime) }
    func depthLabel(at now: TimeInterval) -> String? {
        guard depthRequested == true else { return nil }
        guard let depthMeters, depthMeters.isFinite, depthMeters > 0,
              let depthExpiresAt, now.isFinite, depthExpiresAt.isFinite, now < depthExpiresAt else { return "depth unavailable" }
        return String(format: "depth ≈%.1f m", depthMeters)
    }
}

struct ModelMetadata: Decodable {
    let name: String
    let runtime: String
    let state: String
    let supportedLabels: [String]
    let zone: [NormalizedPoint]
}

struct Readiness: Decodable {
    let ready: Bool
    let modelState: String
}

struct FrameAnalysis: Decodable {
    struct Frame: Decodable {
        let sequence: Int
        let width: Int
        let height: Int
    }
    struct Alert: Decodable {
        let triggered: Bool
        let reason: String
        let modalities: [AlertMode]
        let message: String?
        let cooldownRemainingMs: Int
    }
    let frame: Frame
    let detections: [Detection]
    let alert: Alert
    let processingMs: Int
}

struct BackendError: LocalizedError {
    let status: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
}

private struct BackendFailure: Decodable {
    struct Detail: Decodable { let code: String; let message: String }
    let error: Detail
}

struct BackendClient: Sendable {
    let baseURL: URL

    init(address: String) throws {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/",
              let url = components.url else {
            throw BackendError(status: 0, code: "INVALID_URL", message: "Enter a backend origin such as http://192.168.1.20:3001, without an API path.")
        }
        baseURL = url
    }

    func metadata() async throws -> ModelMetadata {
        try await json(path: "api/v1/model")
    }

    func checkReady() async throws {
        let request = makeRequest(path: "ready")
        let (data, response) = try await URLSession.shared.data(for: request)
        let readiness = try? JSONDecoder().decode(Readiness.self, from: data)
        guard let http = response as? HTTPURLResponse else { throw transportError() }
        guard http.statusCode == 200, readiness?.ready == true else {
            throw BackendError(status: http.statusCode, code: "MODEL_NOT_READY", message: readiness?.modelState == "loading" ? "The detection model is loading. Wait a moment and try again." : "The model is unavailable. Check the backend and restart it if needed.")
        }
    }

    func createSession(preferences: ScanPreferences) async throws -> ScanSession {
        struct Create: Encodable { let preset = "standard"; let preferences: ScanPreferences }
        return try await json(path: "api/v1/sessions", method: "POST", body: JSONEncoder().encode(Create(preferences: preferences)))
    }

    func updatePreferences(_ preferences: ScanPreferences, sessionID: String) async throws -> ScanSession {
        try await json(path: "api/v1/sessions/\(sessionID)/preferences", method: "PATCH", body: JSONEncoder().encode(preferences))
    }

    func analyze(jpeg: Data, sessionID: String, sequence: Int) async throws -> FrameAnalysis {
        var request = makeRequest(path: "api/v1/sessions/\(sessionID)/frames", method: "POST")
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue(String(sequence), forHTTPHeaderField: "X-Frame-Sequence")
        request.httpBody = jpeg
        return try await send(request)
    }

    func deleteSession(_ sessionID: String) async {
        let request = makeRequest(path: "api/v1/sessions/\(sessionID)", method: "DELETE")
        _ = try? await URLSession.shared.data(for: request)
    }

    private func json<T: Decodable>(path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        var request = makeRequest(path: path, method: method)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return try await send(request)
    }

    private func makeRequest(path: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw transportError() }
        guard (200..<300).contains(http.statusCode) else {
            let detail = try? JSONDecoder().decode(BackendFailure.self, from: data).error
            throw BackendError(status: http.statusCode, code: detail?.code ?? "HTTP_ERROR", message: detail?.message ?? "The backend returned HTTP \(http.statusCode).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func transportError() -> BackendError {
        BackendError(status: 0, code: "INVALID_RESPONSE", message: "The backend returned an unreadable response.")
    }
}
