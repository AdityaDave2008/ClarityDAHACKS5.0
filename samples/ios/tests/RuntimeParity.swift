import AppKit
import Foundation
import WebKit

// Actual production bundle + bridge. Export boundaries for independent Python comparison.
// Usage: parity /bundle/OfflineDetector image.jpg output.json
@main struct RuntimeParity {
    @MainActor static func main() {
        NSApplication.shared.setActivationPolicy(.prohibited)
        Task { @MainActor in
            let detector = OfflineDetector(resourceRoot: URL(fileURLWithPath: CommandLine.arguments[1]))
            do {
                _ = try await detector.start()
                let image = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
                let boundaries = try await detector.webView!.callAsyncJavaScript("""
                    const image = new Image(); image.src = 'data:image/jpeg;base64,' + encoded; await image.decode();
                    const canvas = document.createElement('canvas'); canvas.width=image.naturalWidth; canvas.height=image.naturalHeight;
                    const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0);
                    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
                    const input=preprocessRGBA(rgba,canvas.width,canvas.height);
                    const result=await detector.run({images:new ort.Tensor('float32',input.data,[1,3,416,416])});
                    const output=Array.from(result.predictions.data); result.predictions.dispose();
                    return {width:canvas.width,height:canvas.height,rgba:Array.from(rgba),input:Array.from(input.data),output};
                    """, arguments: ["encoded": image.base64EncodedString()], in: nil, contentWorld: .page)
                try JSONSerialization.data(withJSONObject: boundaries!).write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
                detector.stop(); print("PASS exported real WKWebView tensor/output boundaries"); exit(0)
            } catch { detector.stop(); fputs("FAIL \(error)\n",stderr); exit(1) }
        }
        NSApplication.shared.run()
    }
}
