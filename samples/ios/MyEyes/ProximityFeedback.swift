import Foundation

/// All times are monotonic uptime seconds. Expiry is capture time + 0.75 seconds.
struct ProximityFeedbackInput: Sendable {
    let interval: TimeInterval?
    let expiry: TimeInterval
    let speechKey: String
    let message: String
    let sound: Bool
    let haptic: Bool
    let speech: Bool

    func isFresh(at now: TimeInterval) -> Bool {
        now.isFinite && expiry.isFinite && now < expiry && expiry - now <= 0.75
    }
}

struct ProximityFeedbackEvent: Equatable, Sendable {
    var sound = false
    var haptic = false
    var message: String?
    var isEmpty: Bool { !sound && !haptic && message == nil }
}

/// Pure scheduling state. Target loss clears identity, never global emission timestamps.
struct ProximityCadence {
    private var lastPulse: TimeInterval?
    private var lastSpeech: TimeInterval?
    private var speechKey: String?

    mutating func clearTarget() { speechKey = nil }

    mutating func tick(_ input: ProximityFeedbackInput, at now: TimeInterval) -> ProximityFeedbackEvent {
        guard input.isFresh(at: now) else {
            clearTarget()
            return ProximityFeedbackEvent()
        }
        var event = ProximityFeedbackEvent()
        if let interval = input.interval, interval.isFinite, interval > 0,
           input.sound || input.haptic,
           lastPulse.map({ now - $0 >= max(0.5, interval) }) ?? true {
            event.sound = input.sound
            event.haptic = input.haptic
            lastPulse = now
        }
        let speechInterval = speechKey == input.speechKey ? 3.0 : 1.0
        if input.speech, lastSpeech.map({ now - $0 >= speechInterval }) ?? true {
            event.message = input.message
            lastSpeech = now
            speechKey = input.speechKey
        }
        return event
    }
}

/// One main-actor task checks freshness before every output. Updates never restart its cadence.
@MainActor final class ProximityFeedback {
    typealias Sleep = @MainActor (TimeInterval) async throws -> Void
    private let now: @MainActor () -> TimeInterval
    private let sleep: Sleep
    private let emit: @MainActor (ProximityFeedbackEvent) -> Void
    private let stopOutputs: @MainActor () -> Void
    private var input: ProximityFeedbackInput?
    private var cadence = ProximityCadence()
    private var task: Task<Void, Never>?
    var isRunning: Bool { task != nil }

    init(now: @escaping @MainActor () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         sleep: @escaping Sleep = { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) },
         emit: @escaping @MainActor (ProximityFeedbackEvent) -> Void,
         stopOutputs: @escaping @MainActor () -> Void) {
        self.now = now
        self.sleep = sleep
        self.emit = emit
        self.stopOutputs = stopOutputs
    }

    func update(_ input: ProximityFeedbackInput?) {
        guard let input, input.isFresh(at: now()), input.sound || input.haptic || input.speech else {
            stop()
            return
        }
        if let previous = self.input,
           (previous.sound && !input.sound) || (previous.speech && !input.speech) {
            stopOutputs()
        }
        self.input = input
        tick()
        guard task == nil else { return }
        let sleep = self.sleep
        task = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do { try await sleep(0.025) } catch { return }
                guard !Task.isCancelled, let self else { return }
                self.tick()
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        input = nil
        cadence.clearTarget()
        stopOutputs()
    }

    private func tick() {
        let time = now()
        guard let input, input.isFresh(at: time) else { stop(); return }
        let event = cadence.tick(input, at: time)
        if !event.isEmpty { emit(event) }
    }

    deinit { task?.cancel() }
}
