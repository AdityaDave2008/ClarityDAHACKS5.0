import AVFoundation
import UIKit

/// Retain completed framework objects until their identity check reaches the main actor.
/// Only object identity is inspected; playback remains on the main actor.
private struct CompletedAudioObject: @unchecked Sendable {
    let object: AnyObject
}

@MainActor
final class AlertPlayer: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    private let speech = AVSpeechSynthesizer()
    private let haptics = UINotificationFeedbackGenerator()
    private var player: AVAudioPlayer?
    private var activePlayer: ObjectIdentifier?
    private var activeUtterance: ObjectIdentifier?

    override init() {
        super.init()
        speech.delegate = self
    }

    func deliver(_ modes: [AlertMode], message: String) {
        // Invalidate old completion callbacks before interrupting an earlier alert.
        activePlayer = nil
        activeUtterance = nil
        player?.stop()
        speech.stopSpeaking(at: .immediate)
        if modes.contains(.sound) || modes.contains(.speech) {
            do {
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
                PiPDiagnostics.log("audio.category.success")
            } catch { PiPDiagnostics.error("audio.category.failure", error) }
            do {
                try AVAudioSession.sharedInstance().setActive(true)
                PiPDiagnostics.log("audio.activate.success")
            } catch { PiPDiagnostics.error("audio.activate.failure", error) }
        }
        if modes.contains(.vibration) {
            haptics.prepare()
            haptics.notificationOccurred(.warning)
        }
        if modes.contains(.sound) {
            player = try? AVAudioPlayer(data: Self.beep())
            player?.volume = 0.65
            player?.delegate = self
            if let player, player.play() { activePlayer = ObjectIdentifier(player) }
        }
        if modes.contains(.speech) {
            let utterance = AVSpeechUtterance(string: message)
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
            // Track queued speech too: a short beep can finish before speech starts.
            activeUtterance = ObjectIdentifier(utterance)
            speech.speak(utterance)
        }
        deactivateWhenFinished()
    }

    func stop() {
        activePlayer = nil
        activeUtterance = nil
        speech.stopSpeaking(at: .immediate)
        player?.stop()
        deactivateWhenFinished()
    }

    private func deactivateWhenFinished() {
        guard activePlayer == nil, activeUtterance == nil else { return }
        // The audio session stays active: deactivating it would end background audio while a
        // video-call Picture in Picture window is scanning. Ducking already yields to other audio.
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        audioEnded(CompletedAudioObject(object: player))
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        audioEnded(CompletedAudioObject(object: player))
    }

    private nonisolated func audioEnded(_ completed: CompletedAudioObject) {
        Task { @MainActor [weak self] in
            guard let self, activePlayer == ObjectIdentifier(completed.object) else { return }
            activePlayer = nil
            deactivateWhenFinished()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        speechEnded(CompletedAudioObject(object: utterance))
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speechEnded(CompletedAudioObject(object: utterance))
    }

    private nonisolated func speechEnded(_ completed: CompletedAudioObject) {
        Task { @MainActor [weak self] in
            guard let self, activeUtterance == ObjectIdentifier(completed.object) else { return }
            activeUtterance = nil
            deactivateWhenFinished()
        }
    }

    /// A short PCM WAV avoids bundled audio files or third-party dependencies.
    private static func beep() -> Data {
        let sampleRate = 22_050
        let count = Int(Double(sampleRate) * 0.16)
        var audio = Data()
        for index in 0..<count {
            let time = Double(index) / Double(sampleRate)
            let fade = min(1, min(Double(index) / 200, Double(count - index) / 200))
            let value = Int16(sin(2 * .pi * 880 * time) * 11_000 * fade)
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { audio.append(contentsOf: $0) }
        }
        var data = Data("RIFF".utf8)
        data.appendLE(UInt32(36 + audio.count))
        data.append(contentsOf: "WAVEfmt ".utf8)
        data.appendLE(UInt32(16))
        data.appendLE(UInt16(1))
        data.appendLE(UInt16(1))
        data.appendLE(UInt32(sampleRate))
        data.appendLE(UInt32(sampleRate * 2))
        data.appendLE(UInt16(2))
        data.appendLE(UInt16(16))
        data.append(contentsOf: "data".utf8)
        data.appendLE(UInt32(audio.count))
        data.append(audio)
        return data
    }
}

private extension Data {
    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
    }
}
