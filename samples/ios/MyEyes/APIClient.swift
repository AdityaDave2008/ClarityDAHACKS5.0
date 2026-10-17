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

/// Ordered absolute-meter thresholds. Invalid configurations fall back as a unit.
struct ProximitySettings: Codable, Equatable {
    var nearMeters: Double
    var intermediateMeters: Double
    var farMeters: Double

    init(nearMeters: Double = 1, intermediateMeters: Double = 2, farMeters: Double = 3) {
        if Self.isValid(nearMeters, intermediateMeters, farMeters) {
            self.nearMeters = nearMeters
            self.intermediateMeters = intermediateMeters
            self.farMeters = farMeters
        } else {
            self.nearMeters = 1
            self.intermediateMeters = 2
            self.farMeters = 3
        }
    }

    var validated: ProximitySettings {
        Self(nearMeters: nearMeters, intermediateMeters: intermediateMeters, farMeters: farMeters)
    }

    private static func isValid(_ near: Double, _ intermediate: Double, _ far: Double) -> Bool {
        [near, intermediate, far].allSatisfy { $0.isFinite }
            && near >= 0.2 && near < intermediate && intermediate < far && far <= 5
    }

    private enum CodingKeys: String, CodingKey { case nearMeters, intermediateMeters, farMeters }
    init(from decoder: Decoder) throws {
        guard let values = try? decoder.container(keyedBy: CodingKeys.self),
              let near = try? values.decode(Double.self, forKey: .nearMeters),
              let intermediate = try? values.decode(Double.self, forKey: .intermediateMeters),
              let far = try? values.decode(Double.self, forKey: .farMeters) else {
            self.init()
            return
        }
        self.init(nearMeters: near, intermediateMeters: intermediate, farMeters: far)
    }
}

enum ProximityBand: String, Codable {
    case unknown, near, intermediate, far, outOfRange

    var title: String {
        switch self {
        case .unknown: return "Unknown"
        case .near: return "Near"
        case .intermediate: return "Intermediate"
        case .far: return "Far"
        case .outOfRange: return "Out of range"
        }
    }

    var pulseInterval: TimeInterval? {
        switch self {
        case .near: return 0.5
        case .intermediate: return 1
        case .far: return 2
        case .unknown, .outOfRange: return nil
        }
    }
}

struct ScanPreferences: Codable, Equatable {
    // Measured on the shipped candidate over 300 COCO val2017 images: the previous
    // precision-tuned 0.7875 default returned 0.204 recall and left whole scenes
    // empty. 0.45 raises recall to 0.394 at 0.714 precision and matches the
    // browser app's long-standing default. Users can still raise it in settings.
    static let candidateConfidenceDefault = 0.45
    var alertModes: [AlertMode] = [.sound]
    var confidenceThreshold: Double = ScanPreferences.candidateConfidenceDefault
    var cooldownMs: Int = 3000
    var proximitySettings: ProximitySettings? = nil
    var effectiveProximitySettings: ProximitySettings { (proximitySettings ?? ProximitySettings()).validated }
    // Missing storage enables automatic hardware depth; explicit saved choices are preserved.
    private var lidarEnabled: Bool? = nil
    var isLidarEnabled: Bool {
        get { lidarEnabled ?? true }
        set { lidarEnabled = newValue }
    }

    // A private stored property makes Swift's generated memberwise initializer private.
    // Keep configurable construction available without changing persisted LiDAR choices.
    init(alertModes: [AlertMode] = [.sound], confidenceThreshold: Double = ScanPreferences.candidateConfidenceDefault, cooldownMs: Int = 3000) {
        self.alertModes = alertModes
        self.confidenceThreshold = confidenceThreshold
        self.cooldownMs = cooldownMs
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

enum ProximitySource: String, Equatable {
    case lidar, visual
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
    // Local policy output only, never accepted from detector JSON.
    var proximityBand: ProximityBand? = nil
    var proximityTrackID: Int? = nil
    // Two distinct fresh matched frames are required before the first proximity output.
    var proximityConfirmed: Bool? = nil
    var proximitySource: ProximitySource? = nil
    var visualProximityArea: Double? = nil
    var proximityExpiresAt: TimeInterval? = nil
    private enum CodingKeys: String, CodingKey {
        case label, confidence, bbox, anchor, inZone
    }

    /// Native capture metadata only. Visual area is a heuristic, never a distance in meters.
    mutating func enrichProximity(lidarCapable: Bool, capturedAt: TimeInterval) {
        proximitySource = lidarCapable ? .lidar : .visual
        proximityExpiresAt = capturedAt + proximityMaximumAge
        visualProximityArea = nil
        proximityBand = nil
        proximityTrackID = nil
        proximityConfirmed = nil
        if !lidarCapable {
            depthMeters = nil
            depthRequested = false
            depthExpiresAt = nil
            if Self.validVisualBox(bbox) { visualProximityArea = bbox.width * bbox.height }
        }
    }

    private static func validVisualBox(_ box: NormalizedBox) -> Bool {
        [box.x, box.y, box.width, box.height].allSatisfy { $0.isFinite }
            && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
            && box.x + box.width <= 1 && box.y + box.height <= 1
    }

    func freshProximitySource(at now: TimeInterval) -> ProximitySource? {
        // Legacy native depth remains supported. Explicit LiDAR never falls back to visual.
        if proximitySource != .visual { return freshProximityDepth(at: now) == nil ? nil : .lidar }
        guard Self.validVisualBox(bbox), let area = visualProximityArea,
              area.isFinite, area > 0, area <= 1, area == bbox.width * bbox.height,
              let expiry = proximityExpiresAt, expiry.isFinite, now.isFinite,
              now < expiry, expiry - now <= proximityMaximumAge else { return nil }
        return .visual
    }

    /// Unitless strength, larger means closer. Visual strength is normalized box area.
    /// The two sources are not physically comparable; selection always prefers measured LiDAR.
    func freshProximityStrength(at now: TimeInterval) -> Double? {
        switch freshProximitySource(at: now) {
        case .lidar: return (5 - freshProximityDepth(at: now)!) / 4.8
        case .visual: return visualProximityArea
        case nil: return nil
        }
    }

    func freshProximityExpiry(at now: TimeInterval) -> TimeInterval? {
        switch freshProximitySource(at: now) {
        case .lidar: return depthExpiresAt
        case .visual: return proximityExpiresAt
        case nil: return nil
        }
    }

    /// Expiry is capture uptime + 0.75s. Reject future captures as well as expired ones.
    var proximityMaximumAge: TimeInterval { 0.75 }
    func freshProximityDepth(at now: TimeInterval) -> Double? {
        guard proximitySource != .visual, depthRequested == true,
              let depthMeters, depthMeters.isFinite, (0.2...5).contains(depthMeters),
              let depthExpiresAt, depthExpiresAt.isFinite, now.isFinite,
              now < depthExpiresAt, depthExpiresAt - now <= proximityMaximumAge else { return nil }
        return depthMeters
    }

    func freshProximityBand(at now: TimeInterval) -> ProximityBand {
        guard freshProximitySource(at: now) != nil else { return .unknown }
        return proximityBand ?? .unknown
    }

    func proximityDescription(at now: TimeInterval) -> String? {
        switch freshProximitySource(at: now) {
        case .lidar: return depthLabel(at: now)
        case .visual: return "visual proximity estimate"
        case nil: return nil
        }
    }

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
