import Foundation

@main struct VisualProximityTests {
    static func item(_ area: Double, _ time: Double = 10, lidar: Bool = false) -> Detection {
        let side = sqrt(area)
        var d = Detection(label: "chair", confidence: 0.9, bbox: NormalizedBox(x: (1-side)/2, y: (1-side)/2, width: side, height: side), anchor: NormalizedPoint(x: 0.5, y: 0.5), inZone: true)
        d.enrichProximity(lidarCapable: lidar, capturedAt: time)
        return d
    }
    static func main() throws {
        for (area, expected): (Double, ProximityBand) in [(0.36,.near),(0.35,.near),(0.349,.intermediate),(0.12,.intermediate),(0.119,.far),(0.03,.far),(0.029,.outOfRange)] {
            var policy = ProximityPolicy()
            let d = policy.update([item(area)], settings: ProximitySettings(), now: 10)[0]
            precondition(d.freshProximityBand(at: 10) == expected, "area boundary \(area)")
            precondition(d.proximityDescription(at: 10) == "visual proximity estimate")
            precondition(d.depthMeters == nil && d.freshProximityDepth(at: 10) == nil)
            precondition(d.freshProximitySource(at: 10) == .visual)
            // View size is deliberately not an input to the normalized-area contract.
            for size in [320.0, 768, 1920] {
                let pixels = d.bbox.width * size * d.bbox.height * size
                precondition(abs(pixels / (size * size) - d.visualProximityArea!) < 1e-12)
                precondition(d.freshProximityStrength(at: 10) == d.visualProximityArea)
            }
        }
        for area in [0.0, -1, 1.1, Double.nan, .infinity] {
            precondition(item(area).freshProximitySource(at: 10) == nil)
        }
        for now in [9.999, 10.75, 11, Double.nan, .infinity] {
            precondition(item(0.4).freshProximityStrength(at: now) == nil)
        }
        var lidar = item(0.4, lidar: true)
        precondition(lidar.freshProximitySource(at: 10) == nil, "invalid LiDAR never falls back")
        lidar.depthMeters = 2; lidar.depthRequested = true; lidar.depthExpiresAt = 10.75
        precondition(lidar.freshProximitySource(at: 10) == .lidar)
        precondition(lidar.proximityDescription(at: 10) == "depth ≈2.0 m")
        precondition(lidar.proximityExpiresAt == 10.75 && lidar.visualProximityArea == nil)
        precondition(item(0.4).proximityDescription(at: 11) == nil)
        var selection = ProximityPolicy()
        let candidates = selection.update([item(0.4), lidar], settings: ProximitySettings(), now: 10)
        precondition(ProximityPolicy.closest(in: candidates, now: 10)?.freshProximitySource(at: 10) == .lidar)
        let visuals = selection.update([item(0.03), item(0.36)], settings: ProximitySettings(), now: 10)
        precondition(ProximityPolicy.closest(in: visuals, now: 10)?.visualProximityArea == item(0.36).visualProximityArea)
        var policy = ProximityPolicy()
        func step(_ area: Double, _ time: Double) -> Detection {
            policy.update([item(area, time)], settings: ProximitySettings(), now: time)[0]
        }
        precondition(step(0.36, 10).proximityConfirmed == false)
        precondition(step(0.36, 10).proximityConfirmed == false)
        precondition(step(0.36, 10.1).proximityConfirmed == true)
        precondition(step(0.34, 10.2).proximityBand == .near)
        precondition(step(0.30, 10.3).proximityBand == .near)
        precondition(step(0.30, 10.3).proximityBand == .near)
        precondition(step(0.30, 10.4).proximityBand == .intermediate)
        precondition(step(0.36, 10.5).proximityBand == .near)
        lidar.depthExpiresAt = 11.35
        let switched = policy.update([lidar], settings: ProximitySettings(), now: 10.6)[0]
        precondition(switched.proximityConfirmed == false && switched.proximityBand == .intermediate)
        let wire = Data(#"{"label":"chair","confidence":0.9,"bbox":{"x":0,"y":0,"width":0.6,"height":0.6},"anchor":{"x":0.3,"y":0.3},"inZone":true,"depthMeters":1,"depthRequested":true,"depthExpiresAt":10.75,"proximitySource":"visual","visualProximityArea":0.9,"proximityExpiresAt":10.75,"proximityBand":"near","proximityConfirmed":true}"#.utf8)
        let decoded = try JSONDecoder().decode(Detection.self, from: wire)
        precondition(decoded.proximitySource == nil && decoded.visualProximityArea == nil && decoded.depthMeters == nil && decoded.depthRequested == nil && decoded.depthExpiresAt == nil && decoded.proximityExpiresAt == nil)
        precondition(decoded.freshProximitySource(at: 10) == nil)
        print("visual proximity matrix passed")
    }
}
