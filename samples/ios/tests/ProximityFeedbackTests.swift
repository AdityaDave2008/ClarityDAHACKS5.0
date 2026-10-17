import Foundation

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}
func input(_ now: Double, interval: Double? = 0.5, key: String = "chair:near", sound: Bool = true, haptic: Bool = true, speech: Bool = true) -> ProximityFeedbackInput {
    .init(interval: interval, expiry: now + 0.75, speechKey: key, message: "chair approximately 0.8 meters axial depth, Near", sound: sound, haptic: haptic, speech: speech)
}

@MainActor final class ManualClock {
    var now = 0.0
    var waiter: CheckedContinuation<Void, Error>?
    func sleep(_ duration: Double) async throws {
        try await withCheckedThrowingContinuation { waiter = $0 }
    }
    func advance(_ value: Double) async {
        now = value
        let pending = waiter
        waiter = nil
        pending?.resume()
        for _ in 0..<20 { await Task.yield() }
    }
}

@main struct ProximityFeedbackTests {
    @MainActor static func main() async {
        for interval in [0.5, 1.0, 2.0] {
            var cadence = ProximityCadence()
            var pulses: [Double] = []
            for step in 0...80 {
                let now = Double(step) / 10
                let event = cadence.tick(input(now, interval: interval), at: now)
                if event.sound { pulses.append(now) }
            }
            check(pulses.count == Int(8 / interval) + 1, "exact cadence \(interval): \(pulses)")
            check(zip(pulses, pulses.dropFirst()).allSatisfy { $1 - $0 >= interval - 0.00001 }, "cadence spacing")
        }
        var cadence = ProximityCadence()
        check(cadence.tick(input(0), at: 0).sound, "first pulse")
        for step in 1...4 {
            check(!cadence.tick(input(Double(step) / 10, key: "target\(step)"), at: Double(step) / 10).sound, "target changes cannot burst")
        }
        check(cadence.tick(input(0.5, key: "closer"), at: 0.5).sound, "new closer bypasses generic cooldown")
        cadence.clearTarget()
        check(!cadence.tick(input(0.6), at: 0.6).sound, "stop/restart preserves emission timestamp")
        var modes = ProximityCadence()
        let onlySpeech = modes.tick(input(0, sound: false, haptic: false), at: 0)
        check(!onlySpeech.sound && !onlySpeech.haptic && onlySpeech.message != nil, "speech only")
        let haptic = modes.tick(input(0.5, sound: false, speech: false), at: 0.5)
        check(!haptic.sound && haptic.haptic && haptic.message == nil, "haptic only")
        for sound in [false, true] {
            for haptic in [false, true] {
                for speech in [false, true] {
                    var combination = ProximityCadence()
                    let event = combination.tick(input(0, sound: sound, haptic: haptic, speech: speech), at: 0)
                    check(event.sound == sound && event.haptic == haptic && (event.message != nil) == speech, "all mode combinations")
                }
            }
        }
        var clamped = ProximityCadence()
        check(clamped.tick(input(0, interval: 0.01), at: 0).sound, "first clamped pulse")
        check(!clamped.tick(input(0.1, interval: 0.01), at: 0.1).sound, "interval clamped to 2 Hz")
        var outside = ProximityCadence()
        let out = outside.tick(input(0, interval: nil), at: 0)
        check(!out.sound && !out.haptic, "outside has no pulses")
        for now in [-0.01, 0.75, 1, Double.nan] {
            var fresh = ProximityCadence()
            check(fresh.tick(input(0), at: now).isEmpty, "future/expired/nonfinite rejected")
        }
        for expiry in [Double.infinity, Double.nan, -1, 2] {
            var invalid = ProximityCadence()
            let value = ProximityFeedbackInput(interval: 0.5, expiry: expiry, speechKey: "invalid", message: "must not speak", sound: true, haptic: true, speech: true)
            check(invalid.tick(value, at: 0).isEmpty, "invalid/future expiry rejected")
        }
        var talk = ProximityCadence()
        check(talk.tick(input(0), at: 0).message != nil, "initial speech")
        check(talk.tick(input(0.9, key: "other"), at: 0.9).message == nil, "speech change bounded")
        check(talk.tick(input(1, key: "other"), at: 1).message != nil, "speech change after second")
        check(talk.tick(input(3.5, key: "other"), at: 3.5).message == nil, "repeat bounded")
        let repeated = talk.tick(input(4, key: "other"), at: 4)
        check(repeated.message != nil && !repeated.replaceSpeech, "repeat never interrupts unfinished speech")
        let changed = talk.tick(input(5, key: "new target"), at: 5)
        check(changed.message != nil && changed.replaceSpeech, "changed target replaces bounded speech")

        let clock = ManualClock()
        var events: [ProximityFeedbackEvent] = []
        var stops = 0
        let loop = ProximityFeedback(now: { clock.now }, sleep: { try await clock.sleep($0) }, emit: { events.append($0) }, stopOutputs: { stops += 1 })
        loop.update(input(0))
        for _ in 0..<20 { await Task.yield() }
        check(events.count == 1, "loop initial output")
        for step in 1...4 {
            await clock.advance(Double(step) / 10)
            loop.update(input(clock.now, key: "changed-\(step)"))
        }
        check(events.count == 1, "actual loop target churn cannot burst or restart cadence")
        // Keep capture expiry fixed to exercise expiry independently of fresh frame updates.
        loop.update(input(0, key: "final"))
        await clock.advance(0.5)
        check(events.count == 2, "actual loop emits second pulse")
        await clock.advance(0.75)
        check(stops == 1 && !loop.isRunning, "expiry cancels loop and outputs")
        await clock.advance(2)
        check(events.count == 2, "no post-expiry output")
        loop.update(input(2))
        for _ in 0..<20 { await Task.yield() }
        loop.stop()
        let count = events.count
        await clock.advance(2.5)
        check(events.count == count && !loop.isRunning, "no output after cancellation even if sleeper resumes")
        loop.update(input(2.5))
        for _ in 0..<20 { await Task.yield() }
        loop.update(nil)
        let nilCount = events.count
        await clock.advance(3)
        check(events.count == nilCount, "nil depth stops loop")
        var reentrant: ProximityFeedback!
        reentrant = ProximityFeedback(now: { 0 }, sleep: { _ in try await Task.sleep(nanoseconds: 1_000_000) }, emit: { _ in reentrant.stop() }, stopOutputs: {})
        reentrant.update(input(0))
        check(!reentrant.isRunning, "reentrant stop during output must not start a new task")
        var clockReads = 0
        let crossesExpiry = ProximityFeedback(now: { clockReads += 1; return clockReads == 1 ? 0 : 0.75 }, emit: { _ in fatalError("expired output") }, stopOutputs: {})
        crossesExpiry.update(input(0))
        check(!crossesExpiry.isRunning, "expiry crossing during update must not start a task")
        let beforeModeChange = stops
        loop.update(input(3))
        loop.update(input(3, sound: false, haptic: true, speech: false))
        check(stops > beforeModeChange, "deselected audio is cancelled immediately")
        loop.stop()
        await clock.advance(3.5)
        print("proximity cadence, modes, freshness, speech and async cancellation passed")
    }
}
