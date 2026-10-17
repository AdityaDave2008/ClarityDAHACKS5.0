import AVFoundation
import Foundation

/// AVFoundation-only adapter. Geometry remains in the paired camera's distorted image space.
/// The SDK guarantees LiDAR and paired RGB share perspective, field of view and aspect ratio.
enum LiDARCapture {
    struct ConfigurationFailure: LocalizedError {
        let stage: String
        var errorDescription: String? { "LiDAR unavailable: " + stage }
    }
    private static func failure(_ stage: String) -> ConfigurationFailure {
        PiPDiagnostics.log("lidar.configurationRejected", "stage=\(stage)")
        return ConfigurationFailure(stage: stage)
    }
    private static func describe(_ format: AVCaptureDevice.Format) -> String {
        let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        let rates = format.videoSupportedFrameRateRanges.map { "\($0.minFrameRate)-\($0.maxFrameRate)" }.joined(separator: ",")
        return "\(size.width)x\(size.height) subtype=\(CMFormatDescriptionGetMediaSubType(format.formatDescription)) fps=\(rates)"
    }

    static func configure(in session: AVCaptureSession) throws -> (AVCaptureVideoDataOutput, AVCaptureDepthDataOutput) {
        guard let device = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) else {
            throw failure("device missing")
        }
        for format in device.formats where !format.supportedDepthDataFormats.isEmpty {
            PiPDiagnostics.log("lidar.formats", "rgb=\(describe(format)) unitZoom=\(supportsUnitZoom(format)) depth=\(format.supportedDepthDataFormats.map { describe($0) }.joined(separator: ";"))")
        }
        let candidates = device.formats.filter { format in
            let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return size.width >= 640 && size.width <= 1920 && size.height >= 480
                && abs(Double(size.width) / Double(size.height) - 4.0 / 3) < 0.001
                && format.videoSupportedFrameRateRanges.contains { $0.minFrameRate <= 30 && $0.maxFrameRate >= 30 }
                && supportsUnitZoom(format)
                && !format.supportedDepthDataFormats.isEmpty
        }.sorted {
            CMVideoFormatDescriptionGetDimensions($0.formatDescription).width < CMVideoFormatDescriptionGetDimensions($1.formatDescription).width
        }
        let pairs = candidates.compactMap { format -> (AVCaptureDevice.Format, AVCaptureDevice.Format)? in
            guard let depthFormat = format.supportedDepthDataFormats.filter({ format in
                  let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
                  let subtype = CMFormatDescriptionGetMediaSubType(format.formatDescription)
                  return (subtype == kCVPixelFormatType_DepthFloat16 || subtype == kCVPixelFormatType_DepthFloat32)
                      && size.width <= 640 && size.height > 0
                      && abs(Double(size.width) / Double(size.height) - 4.0 / 3) < 0.001
                      && format.videoSupportedFrameRateRanges.contains { $0.minFrameRate <= 30 && $0.maxFrameRate >= 30 }
              }).max(by: {
                  CMVideoFormatDescriptionGetDimensions($0.formatDescription).width < CMVideoFormatDescriptionGetDimensions($1.formatDescription).width
              }) else { return nil }
            return (format, depthFormat)
        }
        PiPDiagnostics.log("lidar.selection", "rgbCandidates=\(candidates.count) pairs=\(pairs.count)")
        guard let (format, depthFormat) = pairs.first else { throw failure("no compatible RGB/depth format pair") }
        PiPDiagnostics.log("lidar.selected", "rgb=\(describe(format)) depth=\(describe(depthFormat))")

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else { throw failure("input rejected") }
        session.addInput(input)
        // Explicit format, not a preset that may silently disable depth or change crop.
        session.sessionPreset = .inputPriority
        try device.lockForConfiguration()
        device.activeFormat = format
        device.activeDepthDataFormat = depthFormat
        device.videoZoomFactor = 1
        device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
        device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
        device.unlockForConfiguration()

        let video = AVCaptureVideoDataOutput()
        video.alwaysDiscardsLateVideoFrames = true
        video.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        let depth = AVCaptureDepthDataOutput()
        depth.isFilteringEnabled = false // No temporal smoothing or hole filling.
        depth.alwaysDiscardsLateDepthData = true
        guard session.canAddOutput(video) else { throw failure("RGB output rejected") }
        session.addOutput(video)
        guard session.canAddOutput(depth) else { throw failure("depth output rejected") }
        session.addOutput(depth)
        guard let videoConnection = video.connection(with: .video),
              let depthConnection = depth.connection(with: .depthData) else { throw failure("connection missing") }
        for connection in [videoConnection, depthConnection] {
            // Do not guess rotation on an unsupported connection. The caller falls back to RGB.
            PiPDiagnostics.log("lidar.connection", "kind=\(connection === videoConnection ? "rgb" : "depth") orientationSupported=\(connection.isVideoOrientationSupported)")
            guard connection.isVideoOrientationSupported else { throw failure("portrait orientation unsupported") }
            connection.videoOrientation = .portrait
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = false
            }
            if connection.isVideoStabilizationSupported { connection.preferredVideoStabilizationMode = .off }
        }
        PiPDiagnostics.log("lidar.configured", "filtered=\(depth.isFilteringEnabled) zoom=\(device.videoZoomFactor)")
        return (video, depth)
    }

    private static func supportsUnitZoom(_ format: AVCaptureDevice.Format) -> Bool {
        if #available(iOS 17.2, *) {
            return format.supportedVideoZoomRangesForDepthDataDelivery.contains { $0.contains(1) }
        }
        return format.supportedVideoZoomFactorsForDepthDataDelivery.contains(1)
    }

    static func snapshot(_ data: AVDepthData, rgb: CVPixelBuffer, capturedAt: TimeInterval, onRejection: (String) -> Void = { _ in }) -> DepthSnapshot? {
        func reject(_ reason: String) -> DepthSnapshot? { onRejection(reason); return nil }
        guard data.depthDataAccuracy == .absolute else { return reject("accuracy relative") }
        guard data.depthDataQuality == .high else { return reject("quality low") }
        guard !data.isDepthDataFiltered else { return reject("filtered depth") }
        guard capturedAt.isFinite else { return reject("invalid capture time") }
        guard let calibration = data.cameraCalibrationData else { return reject("calibration missing") }
        let intrinsics = calibration.intrinsicMatrix
        let reference = calibration.intrinsicMatrixReferenceDimensions
        guard reference.width.isFinite, reference.height.isFinite,
              reference.width > 0, reference.height > 0,
              intrinsics.columns.0.x.isFinite, intrinsics.columns.1.y.isFinite,
              intrinsics.columns.0.x > 0, intrinsics.columns.1.y > 0,
              intrinsics.columns.2.x.isFinite, intrinsics.columns.2.y.isFinite else { return reject("invalid intrinsics") }
        let map = data.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32).depthDataMap
        let width = CVPixelBufferGetWidth(map), height = CVPixelBufferGetHeight(map)
        let rgbWidth = CVPixelBufferGetWidth(rgb), rgbHeight = CVPixelBufferGetHeight(rgb)
        guard width > 0, height > 0, width <= 640, height <= 640,
              rgbWidth > 0, rgbHeight > 0, height > width, rgbHeight > rgbWidth,
              abs(Double(width) / Double(height) - Double(rgbWidth) / Double(rgbHeight)) < 0.001 else { return reject("geometry depth=\(width)x\(height) rgb=\(rgbWidth)x\(rgbHeight)") }
        // No rectification: values are already warped to the RGB image. Intrinsics are
        // required as a calibration-quality gate, not used to invent a radial range.
        guard CVPixelBufferLockBaseAddress(map, .readOnly) == kCVReturnSuccess else { return reject("map lock failed") }
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return reject("map address missing") }
        let stride = CVPixelBufferGetBytesPerRow(map)
        guard stride >= width * MemoryLayout<Float>.stride else { return reject("map stride invalid") }
        var meters = [Float]()
        meters.reserveCapacity(width * height)
        for y in 0..<height {
            let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float.self)
            meters.append(contentsOf: UnsafeBufferPointer(start: row, count: width))
        }
        return DepthSnapshot(width: width, height: height, meters: meters, capturedAt: capturedAt)
    }
}
