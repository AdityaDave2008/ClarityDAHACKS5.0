import Foundation

/// Immutable copy of one aligned, absolute, unfiltered depth map in meters.
/// Axial Z along the optical axis, NOT Euclidean camera range or closest-object distance.
struct DepthSnapshot: Sendable {
    static let maximumAge: TimeInterval = 0.75
    let width: Int
    let height: Int
    let meters: [Float]
    let capturedAt: TimeInterval

    /// Aggregate sensor metadata only. No depth map or camera image is persisted.
    var distributionSummary: String {
        guard width > 0, height > 0, width <= 4096, height <= 4096,
              meters.count == width * height else { return "malformed map" }
        func summary(_ values: [Float]) -> String {
            var valid = 0, missing = 0, nonfinite = 0, below = 0, beyond = 0
            var minimum = Float.infinity, maximum = -Float.infinity
            for value in values {
                if value.isNaN { missing += 1 }
                else if !value.isFinite { nonfinite += 1 }
                else {
                    minimum = min(minimum, value); maximum = max(maximum, value)
                    if value < 0.2 { below += 1 }
                    else if value > 5 { beyond += 1 }
                    else { valid += 1 }
                }
            }
            return "n=\(values.count) valid=\(valid) nan=\(missing) nonfinite=\(nonfinite) below=\(below) beyond=\(beyond) min=\(minimum) max=\(maximum)"
        }
        var neighbors: [Float] = []
        for y in max(0, height / 2 - 2)...min(height - 1, height / 2 + 2) {
            for x in max(0, width / 2 - 2)...min(width - 1, width / 2 + 2) {
                neighbors.append(meters[y * width + x])
            }
        }
        let center = meters[(height / 2) * width + width / 2]
        return "center=\(String(format: "%.3f", center)) map{\(summary(meters))} center5x5{\(summary(neighbors))}"
    }

    /// Single center pixel for an explicitly labeled sensor test, never an object distance.
    /// The capture adapter has already enforced absolute, high-quality, unfiltered geometry.
    func centerSurface(now: TimeInterval, onRejection: (String) -> Void = { _ in }) -> Double? {
        func reject(_ reason: String) -> Double? { onRejection(reason); return nil }
        let age = now - capturedAt
        guard now.isFinite, capturedAt.isFinite, age >= 0, age < Self.maximumAge else { return reject("stale/invalid time") }
        guard width > 0, height > 0, width <= 4096, height <= 4096,
              meters.count == width * height else { return reject("malformed map") }
        let value = meters[(height / 2) * width + width / 2]
        guard !value.isNaN else { return reject("no center return") }
        guard value.isFinite else { return reject("nonfinite center") }
        guard value >= 0.2 else { return reject("center below 0.2 m") }
        guard value <= 5 else { return reject("center beyond 5 m") }
        return Double(value)
    }

    func estimate(in box: NormalizedBox, now: TimeInterval, onRejection: (String) -> Void = { _ in }) -> Double? {
        func reject(_ reason: String) -> Double? { onRejection(reason); return nil }
        let age = now - capturedAt
        guard now.isFinite, capturedAt.isFinite, age >= 0, age < Self.maximumAge else { return reject("stale/invalid time") }
        guard width > 0, height > 0, width <= 4096, height <= 4096,
              meters.count == width * height else { return reject("malformed map") }
        guard [box.x, box.y, box.width, box.height].allSatisfy({ $0.isFinite }),
              box.x >= 0, box.y >= 0, box.width > 0, box.height > 0,
              box.x + box.width <= 1, box.y + box.height <= 1 else { return reject("invalid box geometry") }

        // Central half reduces box-edge contamination. Only pixel centers inside the ROI
        // are included, so rounding never expands the sample into neighboring objects.
        let x0 = max(0, Int(ceil((box.x + box.width * 0.25) * Double(width) - 0.5)))
        let x1 = min(width, Int(ceil((box.x + box.width * 0.75) * Double(width) - 0.5)))
        let y0 = max(0, Int(ceil((box.y + box.height * 0.25) * Double(height) - 0.5)))
        let y1 = min(height, Int(ceil((box.y + box.height * 0.75) * Double(height) - 0.5)))
        guard x1 - x0 >= 3, y1 - y0 >= 3 else { return reject("ROI smaller than 3x3") }
        let count = (x1 - x0) * (y1 - y0)
        var valid: [Float] = []
        valid.reserveCapacity(count)
        for y in y0..<y1 {
            for x in x0..<x1 {
                let value = meters[y * width + x]
                // NaN is the SDK's unfiltered missing-data marker. A finite out-of-range
                // surface (or infinity) is not a hole and must not be silently discarded.
                if value.isNaN { continue }
                guard value.isFinite else { return reject("nonfinite surface") }
                guard value >= 0.2 else { return reject("surface below 0.2 m") }
                guard value <= 5 else { return reject("surface beyond 5 m") }
                valid.append(value)
            }
        }
        // Sparse holes must never leave a tiny patch of background masquerading as an object.
        guard valid.count >= 9, Double(valid.count) / Double(count) >= 0.9 else {
            if let surface = centralSurface(in: box, xRange: x0..<x1, yRange: y0..<y1) { return surface }
            return reject("insufficient valid coverage")
        }
        valid.sort()
        let median = Double(valid[valid.count / 2])
        // A person or sloped object need not form a camera-parallel plane. If the
        // broad ROI varies, measure only a coherent patch at the exact box center.
        // This is central surface depth, not segmentation or closest-object distance.
        let tolerance = max(0.08, median * 0.06)
        guard Double(valid.last! - valid.first!) <= tolerance else {
            if let surface = centralSurface(in: box, xRange: x0..<x1, yRange: y0..<y1) { return surface }
            return reject("mixed-depth spread")
        }
        return median
    }

    private func centralSurface(in box: NormalizedBox, xRange: Range<Int>, yRange: Range<Int>) -> Double? {
        let cx = Int((box.x + box.width / 2) * Double(width))
        let cy = Int((box.y + box.height / 2) * Double(height))
        guard xRange.contains(cx), yRange.contains(cy) else { return nil }
        let center = meters[cy * width + cx]
        guard center.isFinite, (0.2...5).contains(center) else { return nil }
        let xs = max(xRange.lowerBound, cx - 2)..<min(xRange.upperBound, cx + 3)
        let ys = max(yRange.lowerBound, cy - 2)..<min(yRange.upperBound, cy + 3)
        guard xs.count >= 3, ys.count >= 3 else { return nil }
        var samples: [Float] = []
        for y in ys { for x in xs {
            let value = meters[y * width + x]
            if value.isNaN { continue }
            guard value.isFinite, (0.2...5).contains(value) else { return nil }
            samples.append(value)
        } }
        guard samples.count >= 9, Double(samples.count) / Double(xs.count * ys.count) >= 0.9 else { return nil }
        samples.sort()
        let median = Double(samples[samples.count / 2])
        guard Double(samples.last! - samples.first!) <= max(0.08, median * 0.06) else { return nil }
        return median
    }
}


extension Detection {
    /// Prefer usable measured depth. Otherwise use fresh RGB box area, never invented meters.
    func addingProximity(from snapshot: DepthSnapshot?, lidarCapable: Bool?, enabled: Bool,
                         matchingFrame: Bool, capturedAt: TimeInterval, now: TimeInterval,
                         onRejection: (String) -> Void = { _ in }) -> Detection {
        var enriched = addingDepth(from: snapshot, enabled: enabled && lidarCapable == true,
                                   matchingFrame: matchingFrame, now: now, onRejection: onRejection)
        enriched.proximitySource = nil
        enriched.visualProximityArea = nil
        enriched.proximityExpiresAt = nil
        guard matchingFrame else { return enriched }
        let hasUsableDepth = enriched.freshProximityDepth(at: now) != nil
        enriched.enrichProximity(lidarCapable: hasUsableDepth, capturedAt: capturedAt)
        return enriched
    }

    /// Replaces, never merges, prior native depth. OFF and missing/mismatched frames clear it.
    func addingDepth(from snapshot: DepthSnapshot?, enabled: Bool, matchingFrame: Bool, now: TimeInterval, onRejection: (String) -> Void = { _ in }) -> Detection {
        var enriched = self
        enriched.depthRequested = enabled
        enriched.depthMeters = enabled && matchingFrame ? snapshot?.estimate(in: bbox, now: now, onRejection: onRejection) : nil
        enriched.depthExpiresAt = enriched.depthMeters == nil ? nil
            : snapshot.map { $0.capturedAt + DepthSnapshot.maximumAge }
        return enriched
    }
}

/// Selects only an RGB frame with the same capture time, never a fixed latency correction.
/// A single previous RGB buffer covers observed one-frame LiDAR delivery lag on iPhone.
enum DepthFrameMatch {
    case current, previous
    static func select(depthTime: TimeInterval, currentRGBTime: TimeInterval,
                       previousRGBTime: TimeInterval?) -> Self? {
        guard depthTime.isFinite, currentRGBTime.isFinite else { return nil }
        if abs(depthTime - currentRGBTime) <= 0.001 { return .current }
        guard let previousRGBTime, previousRGBTime.isFinite,
              currentRGBTime > previousRGBTime, currentRGBTime - previousRGBTime < 0.1,
              abs(depthTime - previousRGBTime) <= 0.001 else { return nil }
        return .previous
    }
}
