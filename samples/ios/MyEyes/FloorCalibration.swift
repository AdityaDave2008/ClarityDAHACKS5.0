import Foundation

enum FloorCalibrationError: Error, Equatable, Sendable {
    case unavailable(String), invalidIntrinsics, invalidTable, invalidTransform
}

/// Explicit provenance supplied by the capture adapter, never inferred from aspect alone.
/// A physical delivered-coordinate check is required before either verification flag is true.
struct FloorImageMapping: Sendable {
    let referenceWidth: Double
    let referenceHeight: Double
    let deliveredWidth: Int
    let deliveredHeight: Int
    let portrait: Bool
    let mirrored: Bool
    let sameAspectNoCropVerified: Bool
    let calibrationAlreadyOriented: Bool
}

/// Pure, immutable calibration. Construction is restricted to validation.
/// No camera API, image resampling, or production provenance assertion lives here.
struct FloorCalibration: Sendable {
    let fx: Double
    let fy: Double
    let cx: Double
    let cy: Double
    let center: SIMD2<Double>
    let forward: [Float]
    let inverse: [Float]
    let mapping: FloorImageMapping
    private let maximumRadius: Double

    private init(fx: Double, fy: Double, cx: Double, cy: Double,
                 center: SIMD2<Double>, forward: [Float], inverse: [Float],
                 mapping: FloorImageMapping, maximumRadius: Double) {
        self.fx = fx
        self.fy = fy
        self.cx = cx
        self.cy = cy
        self.center = center
        self.forward = forward
        self.inverse = inverse
        self.mapping = mapping
        self.maximumRadius = maximumRadius
    }

    static func validated(intrinsicColumns: [SIMD3<Double>], center: SIMD2<Double>,
                          forward: [Float], inverse: [Float],
                          mapping: FloorImageMapping) throws -> FloorCalibration {
        let w = mapping.referenceWidth
        let h = mapping.referenceHeight
        guard w.isFinite, h.isFinite, w > 0, h > 0,
              mapping.deliveredWidth > 0, mapping.deliveredHeight > 0,
              h > w, mapping.deliveredHeight > mapping.deliveredWidth,
              mapping.portrait, !mapping.mirrored,
              abs(w / h - Double(mapping.deliveredWidth) / Double(mapping.deliveredHeight)) <= 0.001
        else { throw FloorCalibrationError.invalidTransform }
        guard mapping.sameAspectNoCropVerified, mapping.calibrationAlreadyOriented
        else { throw FloorCalibrationError.unavailable("unproven delivered transform") }

        guard intrinsicColumns.count == 3,
              intrinsicColumns.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.z.isFinite })
        else { throw FloorCalibrationError.invalidIntrinsics }
        let a = intrinsicColumns[0], b = intrinsicColumns[1], c = intrinsicColumns[2]
        let tolerance = 1e-6
        guard a.x > 0, b.y > 0,
              abs(a.y) <= tolerance, abs(a.z) <= tolerance,
              abs(b.x) <= tolerance, abs(b.z) <= tolerance, abs(c.z - 1) <= tolerance,
              (0...w).contains(c.x), (0...h).contains(c.y),
              center.x.isFinite, center.y.isFinite,
              (0...w).contains(center.x), (0...h).contains(center.y)
        else { throw FloorCalibrationError.invalidIntrinsics }
        for table in [forward, inverse] {
            guard (2...4096).contains(table.count),
                  table.allSatisfy({ $0.isFinite && 1 + Double($0) > 0 })
            else { throw FloorCalibrationError.invalidTable }
        }
        let radius = hypot(max(center.x, w - center.x), max(center.y, h - center.y))
        guard radius.isFinite, radius > 0 else { throw FloorCalibrationError.invalidTransform }
        return FloorCalibration(fx: a.x, fy: b.y, cx: c.x, cy: c.y, center: center,
                                forward: forward, inverse: inverse, mapping: mapping,
                                maximumRadius: radius)
    }

    /// Continuous top-left coordinates. Callers supply pixel centers, not integer corners.
    func referencePoint(delivered: SIMD2<Double>) -> SIMD2<Double> {
        SIMD2(delivered.x * (mapping.referenceWidth / Double(mapping.deliveredWidth)),
              delivered.y * (mapping.referenceHeight / Double(mapping.deliveredHeight)))
    }

    func deliveredPoint(reference: SIMD2<Double>) -> SIMD2<Double> {
        SIMD2(reference.x * (Double(mapping.deliveredWidth) / mapping.referenceWidth),
              reference.y * (Double(mapping.deliveredHeight) / mapping.referenceHeight))
    }

    /// AVCameraCalibrationData.h reference implementation: distorted -> rectilinear
    /// uses inverseLensDistortionLookupTable, despite ambiguous resampling property prose.
    func undistort(_ distortedReference: SIMD2<Double>) -> SIMD2<Double> {
        radialMap(distortedReference, table: inverse)
    }

    func distort(_ rectilinearReference: SIMD2<Double>) -> SIMD2<Double> {
        radialMap(rectilinearReference, table: forward)
    }

    private func radialMap(_ point: SIMD2<Double>, table: [Float]) -> SIMD2<Double> {
        guard point.x.isFinite, point.y.isFinite else { return SIMD2(.nan, .nan) }
        let delta = point - center
        let radius = hypot(delta.x, delta.y)
        let magnification: Double
        if radius >= maximumRadius {
            magnification = Double(table[table.count - 1])
        } else {
            let position = radius / maximumRadius * Double(table.count - 1)
            let lower = Int(position)
            let fraction = position - Double(lower)
            magnification = Double(table[lower]) * (1 - fraction) + Double(table[lower + 1]) * fraction
        }
        return point + delta * magnification
    }

    /// Uses the original axial depth without interpolation across missing returns.
    func unproject(x: Int, y: Int, axialZ: Double) -> SIMD3<Double>? {
        guard x >= 0, x < mapping.deliveredWidth, y >= 0, y < mapping.deliveredHeight,
              axialZ.isFinite, (0.2...5).contains(axialZ) else { return nil }
        let reference = referencePoint(delivered: SIMD2(Double(x) + 0.5, Double(y) + 0.5))
        let rectified = undistort(reference)
        let result = SIMD3((rectified.x - cx) / fx * axialZ,
                           (rectified.y - cy) / fy * axialZ, axialZ)
        guard result.x.isFinite, result.y.isFinite else { return nil }
        return result
    }
}
