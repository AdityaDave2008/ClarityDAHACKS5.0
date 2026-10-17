import Foundation

@main
struct ProximityPolicyTests {
    static let defaults = ProximitySettings()
    static func detection(_ depth: Double? = 1, _ time: Double = 10, label: String = "chair", x: Double = 0.1, inZone: Bool = true) -> Detection {
        Detection(label: label, confidence: 0.9, bbox: NormalizedBox(x: x, y: 0.2, width: 0.2, height: 0.2), anchor: NormalizedPoint(x: x + 0.1, y: 0.4), inZone: inZone, depthMeters: depth, depthRequested: true, depthExpiresAt: time + 0.75)
    }
    static func band(_ depth: Double, settings: ProximitySettings = defaults) -> ProximityBand {
        var policy = ProximityPolicy()
        return policy.update([detection(depth)], settings: settings, now: 10)[0].freshProximityBand(at: 10)
    }
    static func main() throws {
        precondition(defaults.nearMeters == 1 && defaults.intermediateMeters == 2 && defaults.farMeters == 3)
        for settings in [ProximitySettings(nearMeters: 0.19), ProximitySettings(nearMeters: 2), ProximitySettings(intermediateMeters: 3), ProximitySettings(farMeters: 5.1), ProximitySettings(nearMeters: .nan), ProximitySettings(farMeters: .infinity)] {
            precondition(settings == defaults, "invalid initializer falls back as a unit")
        }
        var malformed = defaults
        malformed.farMeters = 0
        precondition(malformed.validated == defaults)
        let custom = ProximitySettings(nearMeters: 0.2, intermediateMeters: 0.3, farMeters: 5)
        precondition(custom != defaults)
        precondition(try! JSONDecoder().decode(ProximitySettings.self, from: try! JSONEncoder().encode(custom)) == custom)
        let invalidJSON = Data(#"{"nearMeters":2,"intermediateMeters":1,"farMeters":3}"#.utf8)
        precondition(try! JSONDecoder().decode(ProximitySettings.self, from: invalidJSON) == defaults)
        let old = Data(#"{"alertModes":["sound"],"confidenceThreshold":0.7874982953071594,"cooldownMs":3000,"lidarEnabled":false}"#.utf8)
        var preferences = try JSONDecoder().decode(ScanPreferences.self, from: old)
        precondition(preferences.proximitySettings == nil && preferences.effectiveProximitySettings == defaults && !preferences.isLidarEnabled)
        preferences.proximitySettings = malformed
        precondition(preferences.effectiveProximitySettings == defaults)
        preferences.proximitySettings = custom
        precondition(try! JSONDecoder().decode(ScanPreferences.self, from: try! JSONEncoder().encode(preferences)) == preferences)
        precondition(ScanPreferences().confidenceThreshold == 0.45)
        for (depth, expected): (Double, ProximityBand) in [(0.2, .near), (1, .near), (1.00001, .intermediate), (2, .intermediate), (2.00001, .far), (3, .far), (3.00001, .outOfRange), (5, .outOfRange)] {
            precondition(band(depth) == expected, "inclusive band boundary \(depth)")
        }
        precondition(band(0.3, settings: custom) == .intermediate)
        precondition(band(1, settings: malformed) == .near)
        precondition(ProximityBand.near.pulseInterval == 0.5 && ProximityBand.intermediate.pulseInterval == 1 && ProximityBand.far.pulseInterval == 2)
        precondition(ProximityBand.unknown.pulseInterval == nil && ProximityBand.outOfRange.pulseInterval == nil)
        for value in [ProximityBand.unknown, .near, .intermediate, .far, .outOfRange] {
            precondition(!value.title.isEmpty)
            precondition(try! JSONDecoder().decode(ProximityBand.self, from: try! JSONEncoder().encode(value)) == value)
        }
        for depth in [nil, Double.nan, .infinity, -.infinity, 0.1999, 5.001] as [Double?] {
            var policy = ProximityPolicy()
            let result = policy.update([detection(depth)], settings: defaults, now: 10)[0]
            precondition(result.proximityBand == .unknown && result.freshProximityBand(at: 10) == .unknown)
        }
        for expiry in [nil, Double.nan, .infinity, 10, 9, 10.75001] as [Double?] {
            var item = detection()
            item.proximityBand = .near
            item.depthExpiresAt = expiry
            precondition(item.freshProximityBand(at: 10) == .unknown)
        }
        var item = detection()
        item.proximityBand = .near
        precondition(item.freshProximityBand(at: 10) == .near)
        precondition(item.freshProximityBand(at: 10.749) == .near)
        for now in [10.75, 11, 9.999, .nan, .infinity, -.infinity] {
            precondition(item.freshProximityBand(at: now) == .unknown)
        }
        item.depthRequested = false
        precondition(item.freshProximityBand(at: 10) == .unknown)
        item.depthRequested = nil
        precondition(item.freshProximityBand(at: 10) == .unknown)
        precondition(detection().freshProximityBand(at: 10) == .unknown, "unclassified depth isn't a band")
        let wire = Data(#"{"label":"chair","confidence":0.9,"bbox":{"x":0.1,"y":0.2,"width":0.2,"height":0.2},"anchor":{"x":0.2,"y":0.4},"inZone":true,"proximityBand":"near","proximityTrackID":42,"proximityConfirmed":true}"#.utf8)
        let decoded = try JSONDecoder().decode(Detection.self, from: wire)
        precondition(decoded.proximityBand == nil && decoded.proximityTrackID == nil && decoded.proximityConfirmed == nil, "native policy output cannot be supplied by backend")
        let missingLidar = Data(#"{"alertModes":["sound"],"confidenceThreshold":0.7874982953071594,"cooldownMs":3000}"#.utf8)
        let legacy = try JSONDecoder().decode(ScanPreferences.self, from: missingLidar)
        precondition(legacy.isLidarEnabled && legacy.effectiveProximitySettings == defaults)
        for json in ["{}", #"{"nearMeters":"bad","intermediateMeters":2,"farMeters":3}"#] {
            precondition(try! JSONDecoder().decode(ProximitySettings.self, from: Data(json.utf8)) == defaults)
        }
        try hysteresis()
        confirmation()
        replayedFrames()
        association()
        closest()
        print("proximity settings, freshness, association, hysteresis and closest passed")
    }
    static func hysteresis() throws {
        var policy = ProximityPolicy()
        func step(_ depth: Double?, _ time: Double) -> ProximityBand {
            policy.update([detection(depth, time)], settings: defaults, now: time)[0].freshProximityBand(at: time)
        }
        precondition(step(2.5, 10) == .far)
        precondition(step(0.8, 10.1) == .near, "approach is immediate")
        precondition(step(1.14, 10.2) == .near)
        precondition(step(1.16, 10.3) == .near, "first retreat frame")
        precondition(step(1.16, 10.3) == .near, "same depth frame cannot confirm retreat")
        precondition(step(1.16, 10.4) == .intermediate)
        precondition(step(2.16, 10.5) == .intermediate)
        precondition(step(2.16, 10.6) == .far)
        precondition(step(3.16, 10.7) == .far)
        precondition(step(3.16, 10.8) == .outOfRange)
        precondition(step(0.8, 10.9) == .near)
        precondition(step(1.2, 11) == .near)
        precondition(step(1.1, 11.1) == .near, "inside margin cancels retreat")
        precondition(step(1.2, 11.2) == .near)
        precondition(step(nil, 11.3) == .unknown, "missing depth never retains old escalation")
        precondition(step(2.5, 11.4) == .far, "missing frame clears association")
        precondition(step(0.8, 11.5) == .near)
        policy.reset()
        precondition(step(2.5, 11.6) == .far)
        precondition(step(0.8, 11.7) == .near)
        precondition(step(2.5, 12.5) == .far, "expired prior frame cannot hold near")
        _ = step(0.8, 12.6)
        _ = policy.update([], settings: defaults, now: 12.7)
        precondition(step(2.5, 12.8) == .far, "empty frame clears history")
        _ = step(0.8, 12.9)
        let configured = policy.update([detection(2.5, 13)], settings: ProximitySettings(nearMeters: 0.5, intermediateMeters: 1, farMeters: 2), now: 13)
        precondition(configured[0].proximityBand == .outOfRange, "settings change resets old bands")
    }
    static func confirmation() {
        var policy = ProximityPolicy()
        func frame(_ depth: Double?, _ captured: Double, now: Double? = nil, label: String = "chair", x: Double = 0.1) -> Detection {
            policy.update([detection(depth, captured, label: label, x: x)], settings: defaults, now: now ?? captured)[0]
        }
        let first = frame(2.5, 10)
        precondition(first.proximityConfirmed == false && first.proximityBand == .far)
        precondition(frame(2.5, 10, now: 10.1).proximityConfirmed == false, "duplicate is not confirmation")
        precondition(frame(2.5, 9.9, now: 10.2).proximityConfirmed == false, "older frame is not confirmation")
        precondition(frame(2.5, 10, now: 10.3).proximityConfirmed == false, "replay is not confirmation")
        precondition(frame(2.5, 10.4).proximityConfirmed == true)
        let approach = frame(0.5, 10.5)
        precondition(approach.proximityConfirmed == true && approach.proximityBand == .near, "confirmed approach remains immediate")
        precondition(frame(0.5, 10.6, label: "person").proximityConfirmed == false, "different label needs confirmation")
        precondition(frame(0.5, 10.7, label: "person").proximityConfirmed == true)
        precondition(frame(0.5, 10.8, label: "person", x: 0.7).proximityConfirmed == false, "replacement at distant box needs confirmation")
        precondition(frame(nil, 10.9).proximityConfirmed == nil)
        precondition(frame(0.5, 11).proximityConfirmed == false, "unknown clears confirmation")
        precondition(frame(0.5, 11.1).proximityConfirmed == true)
        precondition(frame(0.5, 12).proximityConfirmed == false, "stale history cannot confirm")
        precondition(frame(0.5, 12.1).proximityConfirmed == true)
        policy.reset()
        precondition(frame(0.5, 12.2).proximityConfirmed == false)
        _ = frame(0.5, 12.3)
        _ = policy.update([], settings: defaults, now: 12.4)
        precondition(frame(0.5, 12.5).proximityConfirmed == false, "empty frame clears confirmation")
        policy.reset()
        _ = policy.update([detection(0.5, 13)], settings: defaults, now: 13)
        let split = policy.update([detection(0.5, 13.1), detection(0.5, 13.1, x: 0.12)], settings: defaults, now: 13.1)
        precondition(split.map(\.proximityConfirmed) == [true, false], "only one object may inherit confirmation")
        policy.reset()
        _ = policy.update([detection(0.5, 14, inZone: false)], settings: defaults, now: 14)
        let entered = policy.update([detection(0.5, 14.1)], settings: defaults, now: 14.1)
        precondition(entered[0].proximityConfirmed == false, "out-of-zone frame cannot confirm an in-zone alert")
        let confirmed = policy.update([detection(0.5, 14.2)], settings: defaults, now: 14.2)
        precondition(confirmed[0].proximityConfirmed == true)
        _ = policy.update([detection(0.5, 14.3, inZone: false)], settings: defaults, now: 14.3)
        let reentered = policy.update([detection(0.5, 14.4)], settings: defaults, now: 14.4)
        precondition(reentered[0].proximityConfirmed == false, "leaving zone breaks the confirmation streak")
    }
    static func replayedFrames() {
        var policy = ProximityPolicy()
        _ = policy.update([detection(0.8, 10)], settings: defaults, now: 10)
        _ = policy.update([detection(1.3, 10.2)], settings: defaults, now: 10.2)
        let older = policy.update([detection(1.3, 10.1)], settings: defaults, now: 10.3)
        precondition(older[0].proximityBand == .near)
        let replay = policy.update([detection(1.3, 10.2)], settings: defaults, now: 10.4)
        precondition(replay[0].proximityBand == .near, "out-of-order replay cannot manufacture a second distinct frame")
        let newFrame = policy.update([detection(1.3, 10.5)], settings: defaults, now: 10.5)
        precondition(newFrame[0].proximityBand == .intermediate)
        policy.reset()
        let afterReset = policy.update([detection(1.3, 11)], settings: defaults, now: 11)
        precondition(afterReset[0].proximityTrackID != newFrame[0].proximityTrackID)
        _ = policy.update([detection(0.8, 11.1)], settings: defaults, now: 11.1)
        let rewind = policy.update([detection(2.5, 10)], settings: defaults, now: 10)
        precondition(rewind[0].proximityBand == .far, "clock reversal resets history")
    }
    static func association() {
        var policy = ProximityPolicy()
        _ = policy.update([detection(0.5)], settings: defaults, now: 10)
        let moved = policy.update([detection(2.5, 10.1, x: 0.7)], settings: defaults, now: 10.1)
        precondition(moved[0].proximityBand == .far, "distant replacement must not inherit near")
        policy.reset()
        _ = policy.update([detection(0.5)], settings: defaults, now: 10)
        let renamed = policy.update([detection(2.5, 10.1, label: "person")], settings: defaults, now: 10.1)
        precondition(renamed[0].proximityBand == .far)
        for reverse in [false, true] {
            policy.reset()
            _ = policy.update([detection(0.5, x: 0.1), detection(2.5, x: 0.6)], settings: defaults, now: 10)
            let next = [detection(1.3, 10.1, x: 0.11), detection(2.5, 10.1, x: 0.61)]
            let result = policy.update(reverse ? next.reversed() : next, settings: defaults, now: 10.1)
            precondition(result.first(where: { $0.bbox.x < 0.5 })?.proximityBand == .near)
            precondition(result.first(where: { $0.bbox.x > 0.5 })?.proximityBand == .far)
        }
        policy.reset()
        _ = policy.update([detection(0.5)], settings: defaults, now: 10)
        let tracked = policy.update([detection(0.6, 10.05, x: 0.11)], settings: defaults, now: 10.05)
        precondition(tracked[0].proximityTrackID != nil)
        let same = policy.update([detection(0.6, 10.06, x: 0.12)], settings: defaults, now: 10.06)
        precondition(same[0].proximityTrackID == tracked[0].proximityTrackID, "jitter preserves speech identity")
        let unknown = policy.update([detection(nil, 10.07)], settings: defaults, now: 10.07)
        precondition(unknown[0].proximityTrackID == nil)
        policy.reset()
        _ = policy.update([detection(0.5)], settings: defaults, now: 10)
        let split = policy.update([detection(1.3, 10.1, x: 0.1), detection(1.3, 10.1, x: 0.12)], settings: defaults, now: 10.1)
        precondition(split.map(\.proximityBand) == [.near, .intermediate], "one history cannot hold two objects near")
    }
    static func closest() {
        var policy = ProximityPolicy()
        let candidates = policy.update([detection(0.3, inZone: false), detection(1, label: "zebra"), detection(1, label: "apple", x: 0.4), detection(1, label: "apple", x: 0.1), detection(nil)], settings: defaults, now: 10)
        for order in [candidates, candidates.reversed()] {
            let closest = ProximityPolicy.closest(in: order, now: 10)
            precondition(closest?.label == "apple" && closest?.bbox.x == 0.1)
        }
        precondition(ProximityPolicy.closest(in: candidates, now: 11) == nil)
        precondition(ProximityPolicy.closest(in: [], now: 10) == nil)
        let beyond = policy.update([detection(4, 11)], settings: defaults, now: 11)
        precondition(ProximityPolicy.closest(in: beyond, now: 11)?.proximityBand == .outOfRange, "beyond-range target explicitly suppresses pulses")
    }
}
