import Foundation

/// Pure per-frame proximity classification. History influences bands, never current depth.
/// Only overlapping, nearby same-label boxes can inherit retreat hysteresis.
struct ProximityPolicy {
    private struct Track {
        var detection: Detection
        var retreatFrames: Int = 0
        let id: Int
        let latestExpiry: TimeInterval
    }
    private struct Match {
        let current: Int
        let previous: Int
        let overlap: Double
    }
    private var tracks: [Track] = []
    private var settings: ProximitySettings?
    private var lastUpdate: TimeInterval?
    private var nextID = 0

    mutating func reset() {
        tracks = []
        settings = nil
        lastUpdate = nil
        // Do not recycle identities: an alert consumer may still remember the prior ID.
    }

    mutating func update(_ detections: [Detection], settings requested: ProximitySettings, now: TimeInterval) -> [Detection] {
        let currentSettings = requested.validated
        if settings != currentSettings || !now.isFinite || (lastUpdate.map { now < $0 } ?? false) { reset() }
        settings = currentSettings
        lastUpdate = now.isFinite ? now : nil
        let previous = tracks.filter { $0.detection.freshProximityDepth(at: now) != nil }
        var output = detections
        let valid = detections.indices.filter { detections[$0].freshProximityDepth(at: now) != nil }
        var matches: [Match] = []
        for current in valid {
            for prior in previous.indices {
                if let overlap = Self.overlap(detections[current], previous[prior].detection) {
                    matches.append(Match(current: current, previous: prior, overlap: overlap))
                }
            }
        }
        // Best spatial fit first. Canonical ordering makes equal fits input-order independent.
        matches.sort {
            if $0.overlap != $1.overlap { return $0.overlap > $1.overlap }
            let a = detections[$0.current], b = detections[$1.current]
            if Self.ordered(a, b) { return true }
            if Self.ordered(b, a) { return false }
            return previous[$0.previous].id < previous[$1.previous].id
        }
        var associations: [Int: Int] = [:]
        var usedPrevious = Set<Int>()
        for match in matches where associations[match.current] == nil && !usedPrevious.contains(match.previous) {
            associations[match.current] = match.previous
            usedPrevious.insert(match.previous)
        }
        tracks = []
        // Allocate new IDs canonically too, not according to detector array order.
        for index in detections.indices.sorted(by: { Self.ordered(detections[$0], detections[$1]) }) {
            output[index].proximityBand = .unknown
            output[index].proximityTrackID = nil
            guard let depth = detections[index].freshProximityDepth(at: now) else { continue }
            let raw = Self.band(depth, settings: currentSettings)
            var band = raw
            var retreatFrames = 0
            let id: Int
            var latestExpiry = detections[index].depthExpiresAt!
            if let match = associations[index] {
                let prior = previous[match]
                id = prior.id
                latestExpiry = max(latestExpiry, prior.latestExpiry)
                let oldBand = prior.detection.proximityBand ?? .unknown
                if Self.rank(raw) > Self.rank(oldBand), let boundary = Self.upperBound(oldBand, settings: currentSettings) {
                    band = oldBand
                    // A timestamp identifies a depth frame. Re-processing it cannot count twice.
                    let isNewFrame = detections[index].depthExpiresAt! > prior.latestExpiry
                    if depth >= boundary + 0.15 {
                        retreatFrames = prior.retreatFrames + (isNewFrame ? 1 : 0)
                        if retreatFrames >= 2 { band = raw; retreatFrames = 0 }
                    }
                }
            } else {
                id = nextID
                nextID += 1
            }
            output[index].proximityBand = band
            output[index].proximityTrackID = id
            tracks.append(Track(detection: output[index], retreatFrames: retreatFrames, id: id, latestExpiry: latestExpiry))
        }
        return output
    }

    /// Includes out-of-range targets so consumers can explicitly stop proximity pulses.
    static func closest(in detections: [Detection], now: TimeInterval) -> Detection? {
        detections.filter { $0.inZone && $0.freshProximityBand(at: now) != .unknown }
            .min {
                let a = $0.freshProximityDepth(at: now)!, b = $1.freshProximityDepth(at: now)!
                return a == b ? ordered($0, $1) : a < b
            }
    }

    private static func band(_ depth: Double, settings: ProximitySettings) -> ProximityBand {
        if depth <= settings.nearMeters { return .near }
        if depth <= settings.intermediateMeters { return .intermediate }
        if depth <= settings.farMeters { return .far }
        return .outOfRange
    }

    private static func rank(_ band: ProximityBand) -> Int {
        switch band {
        case .near: return 0
        case .intermediate: return 1
        case .far: return 2
        case .outOfRange: return 3
        case .unknown: return 4
        }
    }

    private static func upperBound(_ band: ProximityBand, settings: ProximitySettings) -> Double? {
        switch band {
        case .near: return settings.nearMeters
        case .intermediate: return settings.intermediateMeters
        case .far: return settings.farMeters
        case .unknown, .outOfRange: return nil
        }
    }

    private static func ordered(_ a: Detection, _ b: Detection) -> Bool {
        if a.label != b.label { return a.label < b.label }
        let left = [a.bbox.x, a.bbox.y, a.bbox.width, a.bbox.height, a.depthMeters ?? .infinity, a.confidence]
        let right = [b.bbox.x, b.bbox.y, b.bbox.width, b.bbox.height, b.depthMeters ?? .infinity, b.confidence]
        // Nonfinite geometry is never associated, but ordering must still be total.
        return zip(left, right).map { ($0.isFinite ? $0 : .infinity, $1.isFinite ? $1 : .infinity) }
            .first(where: { $0 != $1 }).map { $0 < $1 } ?? false
    }

    private static func validBox(_ box: NormalizedBox) -> Bool {
        [box.x, box.y, box.width, box.height].allSatisfy { $0.isFinite }
            && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
            && box.x + box.width <= 1 && box.y + box.height <= 1
    }

    private static func overlap(_ current: Detection, _ previous: Detection) -> Double? {
        guard current.label == previous.label, validBox(current.bbox), validBox(previous.bbox) else { return nil }
        let a = current.bbox, b = previous.bbox
        let dx = a.x + a.width / 2 - b.x - b.width / 2
        let dy = a.y + a.height / 2 - b.y - b.height / 2
        guard dx * dx + dy * dy <= 0.15 * 0.15 else { return nil }
        let intersection = max(0, min(a.x + a.width, b.x + b.width) - max(a.x, b.x))
            * max(0, min(a.y + a.height, b.y + b.height) - max(a.y, b.y))
        let iou = intersection / (a.width * a.height + b.width * b.height - intersection)
        return iou >= 0.2 ? iou : nil
    }
}
