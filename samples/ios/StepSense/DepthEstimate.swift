import Foundation

/// Immutable copy of one aligned, absolute, unfiltered depth map in meters.
/// Axial Z along the optical axis, NOT Euclidean camera range or closest-object distance.
struct DepthSnapshot: Sendable {
    static let maximumAge: TimeInterval = 0.75
    let width: Int
    let height: Int
    let meters: [Float]
    let capturedAt: TimeInterval

    func estimate(in box: NormalizedBox, now: TimeInterval) -> Double? {
        let age = now - capturedAt
        guard now.isFinite, capturedAt.isFinite, age >= 0, age < Self.maximumAge,
              width > 0, height > 0, width <= 4096, height <= 4096,
              meters.count == width * height,
              [box.x, box.y, box.width, box.height].allSatisfy({ $0.isFinite }),
              box.x >= 0, box.y >= 0, box.width > 0, box.height > 0,
              box.x + box.width <= 1, box.y + box.height <= 1 else { return nil }

        // Central half reduces box-edge contamination. Only pixel centers inside the ROI
        // are included, so rounding never expands the sample into neighboring objects.
        let x0 = max(0, Int(ceil((box.x + box.width * 0.25) * Double(width) - 0.5)))
        let x1 = min(width, Int(ceil((box.x + box.width * 0.75) * Double(width) - 0.5)))
        let y0 = max(0, Int(ceil((box.y + box.height * 0.25) * Double(height) - 0.5)))
        let y1 = min(height, Int(ceil((box.y + box.height * 0.75) * Double(height) - 0.5)))
        guard x1 - x0 >= 3, y1 - y0 >= 3 else { return nil }
        let count = (x1 - x0) * (y1 - y0)
        var valid: [Float] = []
        valid.reserveCapacity(count)
        for y in y0..<y1 {
            for x in x0..<x1 {
                let value = meters[y * width + x]
                if value.isFinite, value >= 0.2, value <= 5 { valid.append(value) }
            }
        }
        // Sparse holes must never leave a tiny patch of background masquerading as an object.
        guard valid.count >= 9, Double(valid.count) / Double(count) >= 0.9 else { return nil }
        valid.sort()
        let median = Double(valid[valid.count / 2])
        // Reject, rather than silently trim, an outlier surface or mixed-depth ROI.
        let tolerance = max(0.08, median * 0.06)
        guard Double(valid.last! - valid.first!) <= tolerance else { return nil }
        return median
    }
}
