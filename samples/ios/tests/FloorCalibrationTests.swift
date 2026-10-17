import Foundation

@main
struct FloorCalibrationTests {
    static let k = [SIMD3<Double>(100, 0, 0), SIMD3<Double>(0, 100, 0), SIMD3<Double>(50, 100, 1)]
    static func mapping(w: Double = 100, h: Double = 200, dw: Int = 50, dh: Int = 100,
                        portrait: Bool = true, mirrored: Bool = false, crop: Bool = true,
                        oriented: Bool = true) -> FloorImageMapping {
        FloorImageMapping(referenceWidth: w, referenceHeight: h, deliveredWidth: dw,
                          deliveredHeight: dh, portrait: portrait, mirrored: mirrored,
                          sameAspectNoCropVerified: crop, calibrationAlreadyOriented: oriented)
    }
    static func calibration(_ columns: [SIMD3<Double>] = k, center: SIMD2<Double> = SIMD2(50, 100),
                            forward: [Float] = [0, 0], inverse: [Float] = [0, 0],
                            map: FloorImageMapping = mapping()) throws -> FloorCalibration {
        try FloorCalibration.validated(intrinsicColumns: columns, center: center,
                                       forward: forward, inverse: inverse, mapping: map)
    }
    static func near(_ a: Double, _ b: Double, _ tolerance: Double = 1e-9) {
        precondition(a.isFinite && abs(a - b) <= tolerance, "Expected \(b), got \(a)")
    }
    static func rejects(_ expected: FloorCalibrationError, _ body: () throws -> FloorCalibration) {
        do { _ = try body(); preconditionFailure("Expected \(expected)") }
        catch { precondition(error as? FloorCalibrationError == expected, "Unexpected \(error)") }
    }
    static func main() throws {
        let c = try calibration()
        let p = c.unproject(x: 24, y: 49, axialZ: 2)!
        near(p.x, -0.02); near(p.y, -0.02); near(p.z, 2)
        for q in [SIMD2<Double>(12.5, 35.5), SIMD2(0, 0), SIMD2(50, 100)] {
            let ref = c.referencePoint(delivered: q)
            near(ref.x, q.x * 2); near(ref.y, q.y * 2)
            let round = c.deliveredPoint(reference: ref)
            near(round.x, q.x); near(round.y, q.y)
        }
        let direction = try calibration(forward: [-1 / 11, -1 / 11], inverse: [0.1, 0.1])
        let u = direction.undistort(SIMD2(60, 100))
        near(u.x, 61, 1e-5); near(u.y, 100)
        let d = direction.distort(u)
        near(d.x, 60, 1e-5); near(d.y, 100)
        let ray = direction.unproject(x: 24, y: 49, axialZ: 2)!
        near(ray.x, -0.022, 1e-8); near(ray.y, -0.022, 1e-8)
        near(direction.undistort(SIMD2(50, 100)).x, 50)
        // Radius to the farthest corner is sqrt(50² + 100²). Entries are
        // relative magnifications, linearly sampled at 0, R/2 and R.
        let varying = try calibration(forward: [0, 0.2, 0.4], inverse: [0, 0.1, 0.3])
        let radius = sqrt(12500.0)
        for (fraction, magnification) in [(0.25, 0.05), (0.75, 0.2), (1.0, 0.3), (1.5, 0.3)] {
            let x = 50 + radius * fraction
            near(varying.undistort(SIMD2(x, 100)).x, x + radius * fraction * magnification, 1e-5)
        }
        near(varying.undistort(SIMD2(100, 200)).x, 115, 1e-5)
        near(varying.undistort(SIMD2(100, 200)).y, 230, 1e-5)
        near(varying.distort(SIMD2(50 + radius * 0.75, 100)).x, 50 + radius * 0.75 * 1.3, 1e-5)
        // An off-center lens must use its farthest, not nearest, image corner.
        let offCenter = try calibration(center: SIMD2(0, 0), inverse: [0, 0.2])
        near(offCenter.undistort(SIMD2(50, 100)).x, 55, 1e-5)
        for table: [Float] in [[], [0], Array(repeating: 0, count: 4097), [0, .nan], [0, .infinity], [0, -.infinity], [0, -1], [0, -2]] {
            rejects(.invalidTable) { try calibration(forward: table) }
            rejects(.invalidTable) { try calibration(inverse: table) }
        }
        _ = try calibration(forward: Array(repeating: 0, count: 4096))
        for index in 0..<3 {
            for row in 0..<3 {
                for value in [Double.nan, .infinity, -.infinity] {
                    var bad = k; bad[index][row] = value
                    rejects(.invalidIntrinsics) { try calibration(bad) }
                }
            }
        }
        for (column, row, value) in [(0,0,0.0), (1,1,-1.0), (0,1,0.01), (0,2,0.01), (1,0,0.01), (1,2,0.01), (2,2,0.99), (2,0,-1.0), (2,0,101.0), (2,1,201.0)] {
            var bad = k; bad[column][row] = value
            rejects(.invalidIntrinsics) { try calibration(bad) }
        }
        rejects(.invalidIntrinsics) { try calibration([]) }
        for center in [SIMD2<Double>(.nan, 0), SIMD2(0, .infinity), SIMD2(-1, 0), SIMD2(101, 100), SIMD2(50, 201)] {
            rejects(.invalidIntrinsics) { try calibration(center: center) }
        }
        for map in [mapping(w: 0), mapping(h: 0), mapping(w: .nan), mapping(h: .infinity), mapping(dw: 0), mapping(dh: -1), mapping(dw: 51), mapping(w: 200, h: 100), mapping(dw: 100, dh: 50), mapping(portrait: false), mapping(mirrored: true)] {
            rejects(.invalidTransform) { try calibration(map: map) }
        }
        for map in [mapping(crop: false), mapping(oriented: false)] {
            rejects(.unavailable("unproven delivered transform")) { try calibration(map: map) }
        }
        for z in [Double.nan, .infinity, -.infinity, 0, -1, 0.19999, 5.00001] {
            precondition(c.unproject(x: 24, y: 49, axialZ: z) == nil)
        }
        for z in [0.2, 5.0] { precondition(c.unproject(x: 0, y: 0, axialZ: z) != nil) }
        for (x, y) in [(-1, 0), (0, -1), (50, 0), (0, 100), (Int.max, Int.max)] {
            precondition(c.unproject(x: x, y: y, axialZ: 2) == nil)
        }
        // Explicit 90-degree coordinate fixture only, not permission to rotate runtime K.
        let width = 100.0, height = 200.0
        let original = SIMD2<Double>(12.5, 35.5)
        let rotated = SIMD2(height - original.y, original.x)
        precondition(rotated.x < height && rotated.y < width)
        let restored = SIMD2(rotated.y, height - rotated.x)
        near(restored.x, original.x); near(restored.y, original.y)
        print("Floor calibration tests passed")
    }
}
