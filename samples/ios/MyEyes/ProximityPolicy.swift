import Foundation

/// Pure per-frame proximity classification. History influences bands, never current evidence.
/// Only overlapping, nearby same-label boxes can inherit retreat hysteresis.
struct ProximityPolicy {
    private struct Track {
        var detection: Detection
        var retreatFrames: Int = 0
        let id: Int
        let latestExpiry: TimeInterval
        let confirmedFrames: Int
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
        let previous = tracks.filter { $0.detection.freshProximitySource(at: now) != nil }
        var output = detections
        let valid = detections.indices.filter { detections[$0].freshProximitySource(at: now) != nil }
        var matches: [Match] = []
        for current in valid {
            for prior in previous.indices {
                if detections[current].freshProximitySource(at: now) == previous[prior].detection.freshProximitySource(at: now),
                   let overlap = Self.overlap(detections[current], previous[prior].detection) {
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
            output[index].proximityConfirmed = nil
            guard let source = detections[index].freshProximitySource(at: now) else { continue }
            let value = source == .lidar ? detections[index].freshProximityDepth(at: now)! : detections[index].visualProximityArea!
            let raw = source == .lidar ? Self.band(value, settings: currentSettings) : Self.visualBand(value)
            var band = raw
            var retreatFrames = 0
            var confirmedFrames = detections[index].inZone ? 1 : 0
            let id: Int
            var latestExpiry = detections[index].freshProximityExpiry(at: now)!
            if let match = associations[index] {
                let prior = previous[match]
                id = prior.id
                let isNewFrame = detections[index].freshProximityExpiry(at: now)! > prior.latestExpiry
                confirmedFrames = detections[index].inZone
                    ? min(2, prior.confirmedFrames + (isNewFrame ? 1 : 0)) : 0
                latestExpiry = max(latestExpiry, prior.latestExpiry)
                let oldBand = prior.detection.proximityBand ?? .unknown
                if Self.rank(raw) > Self.rank(oldBand), let boundary = source == .lidar ? Self.upperBound(oldBand, settings: currentSettings) : Self.visualLowerBound(oldBand) {
                    band = oldBand
                    // A timestamp identifies a source frame. Re-processing it cannot count twice.
                    if source == .lidar ? value >= boundary + 0.15 : value <= boundary * 0.9 {
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
            output[index].proximityConfirmed = confirmedFrames >= 2
            tracks.append(Track(detection: output[index], retreatFrames: retreatFrames, id: id, latestExpiry: latestExpiry, confirmedFrames: confirmedFrames))
        }
        return output
    }

    /// Includes out-of-range targets so consumers can explicitly stop proximity pulses.
    static func closest(in detections: [Detection], now: TimeInterval) -> Detection? {
        detections.filter { $0.inZone && $0.freshProximityBand(at: now) != .unknown }
            .min {
                let sourceA = $0.freshProximitySource(at: now)!, sourceB = $1.freshProximitySource(at: now)!
                if sourceA != sourceB { return sourceA == .lidar }
                if sourceA == .lidar {
                    let a = $0.freshProximityDepth(at: now)!, b = $1.freshProximityDepth(at: now)!
                    return a == b ? ordered($0, $1) : a < b
                }
                let a = $0.freshProximityStrength(at: now)!, b = $1.freshProximityStrength(at: now)!
                return a == b ? ordered($0, $1) : a > b
            }
    }

    // Engineering heuristics for normalized box area, not physical accuracy claims.
    // Retreat requires two distinct frames at least 10% below the old area boundary.
    private static func visualBand(_ area: Double) -> ProximityBand {
        if area >= 0.35 { return .near }
        if area >= 0.12 { return .intermediate }
        if area >= 0.03 { return .far }
        return .outOfRange
    }

    private static func visualLowerBound(_ band: ProximityBand) -> Double? {
        switch band {
        case .near: return 0.35
        case .intermediate: return 0.12
        case .far: return 0.03
        case .unknown, .outOfRange: return nil
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
