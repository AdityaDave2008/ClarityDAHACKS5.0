import AVFoundation
import Foundation

/// AVFoundation-only adapter. Geometry remains in the paired camera's distorted image space.
/// The SDK guarantees LiDAR and paired RGB share perspective, field of view and aspect ratio.
enum LiDARCapture {
    static func configure(in session: AVCaptureSession) throws -> (AVCaptureVideoDataOutput, AVCaptureDepthDataOutput) {
        guard let device = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) else {
            throw CameraFailure.unavailable
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
        guard let (format, depthFormat) = pairs.first else { throw CameraFailure.configuration }

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else { throw CameraFailure.configuration }
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
        guard session.canAddOutput(video) else { throw CameraFailure.configuration }
        session.addOutput(video)
        guard session.canAddOutput(depth) else { throw CameraFailure.configuration }
        session.addOutput(depth)
        guard let videoConnection = video.connection(with: .video),
              let depthConnection = depth.connection(with: .depthData) else { throw CameraFailure.configuration }
        for connection in [videoConnection, depthConnection] {
            // Do not guess rotation on an unsupported connection. The caller falls back to RGB.
            guard connection.isVideoOrientationSupported else { throw CameraFailure.configuration }
            connection.videoOrientation = .portrait
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = false
            }
            if connection.isVideoStabilizationSupported { connection.preferredVideoStabilizationMode = .off }
        }
        return (video, depth)
    }

    private static func supportsUnitZoom(_ format: AVCaptureDevice.Format) -> Bool {
        if #available(iOS 17.2, *) {
            return format.supportedVideoZoomRangesForDepthDataDelivery.contains { $0.contains(1) }
        }
        return format.supportedVideoZoomFactorsForDepthDataDelivery.contains(1)
    }

    static func snapshot(_ data: AVDepthData, rgb: CVPixelBuffer, capturedAt: TimeInterval) -> DepthSnapshot? {
        guard data.depthDataAccuracy == .absolute, data.depthDataQuality == .high,
              !data.isDepthDataFiltered, capturedAt.isFinite,
              let calibration = data.cameraCalibrationData else { return nil }
        let intrinsics = calibration.intrinsicMatrix
        let reference = calibration.intrinsicMatrixReferenceDimensions
        guard reference.width.isFinite, reference.height.isFinite,
              reference.width > 0, reference.height > 0,
              intrinsics.columns.0.x.isFinite, intrinsics.columns.1.y.isFinite,
              intrinsics.columns.0.x > 0, intrinsics.columns.1.y > 0,
              intrinsics.columns.2.x.isFinite, intrinsics.columns.2.y.isFinite else { return nil }
        let map = data.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32).depthDataMap
        let width = CVPixelBufferGetWidth(map), height = CVPixelBufferGetHeight(map)
        let rgbWidth = CVPixelBufferGetWidth(rgb), rgbHeight = CVPixelBufferGetHeight(rgb)
        guard width > 0, height > 0, width <= 640, height <= 640,
              rgbWidth > 0, rgbHeight > 0, height > width, rgbHeight > rgbWidth,
              abs(Double(width) / Double(height) - Double(rgbWidth) / Double(rgbHeight)) < 0.001 else { return nil }
        // No rectification: values are already warped to the RGB image. Intrinsics are
        // required as a calibration-quality gate, not used to invent a radial range.
        guard CVPixelBufferLockBaseAddress(map, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }
        let stride = CVPixelBufferGetBytesPerRow(map)
        guard stride >= width * MemoryLayout<Float>.stride else { return nil }
        var meters = [Float]()
        meters.reserveCapacity(width * height)
        for y in 0..<height {
            let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float.self)
            meters.append(contentsOf: UnsafeBufferPointer(start: row, count: width))
        }
        return DepthSnapshot(width: width, height: height, meters: meters, capturedAt: capturedAt)
    }
}
