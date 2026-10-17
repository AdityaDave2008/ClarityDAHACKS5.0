import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
const ui = readFileSync(new URL('../MyEyes/ScannerView.swift', import.meta.url), 'utf8');

test('production presentation bounds preview to viewport and reports actual PiP capability', { skip: process.platform !== 'darwin' }, () => {
  const helper = ui.match(/enum ScannerPresentation \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'production viewport sizing and capability policy exists');
  const scratch = process.env.JCODE_SCRATCH_DIR || join(homedir(), '.jcode', 'scratch');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'scanner-presentation-'));
  const harness = join(dir, 'main.swift');
  writeFileSync(harness, `import Foundation\n${helper}\n` + String.raw`
func height(_ width: CGFloat, _ viewport: CGFloat) -> CGFloat {
    ScannerPresentation.previewHeight(width: width, availableHeight: viewport)
}
// 402pt phone, 22pt horizontal padding each side, safe viewport after navigation.
precondition(height(358, 700) == 336)
// Header 76 + status 16 + three gaps 60 + padding 44 + controls 68.
precondition(height(358, 700) + 76 + 16 + 60 + 44 + 68 < 700)
precondition(abs(height(276, 480) - 230.4) < 0.0001)
precondition(abs(height(736, 260) - 124.8) < 0.0001)
precondition(height(1000, 1200) == 420)
precondition(height(150, 900) == 200)
precondition(height(0, 700) == 0)
precondition(height(358, 0) == 0)
precondition(height(-1, 700) == 0)
precondition(height(358, -1) == 0)
precondition(height(.infinity, 700) == 0)
precondition(height(358, .nan) == 0)
for width in stride(from: 100.0, through: 1000, by: 100) {
    for viewport in stride(from: 100.0, through: 1200, by: 100) {
        let result = height(CGFloat(width), CGFloat(viewport))
        precondition(result >= 0 && result <= 420)
        precondition(result <= width * 4 / 3 && result <= viewport * 0.48)
    }
}
precondition(ScannerPresentation.cameraHint(pipSupported: true) == "Rear camera · floating window supported")
precondition(ScannerPresentation.cameraHint(pipSupported: false) == "Rear camera · floating window unavailable on this device")
print("presentation sizing and capability checks passed")
`);
  const binary = join(dir, 'presentation-tests');
  const build = spawnSync('swiftc', [harness, '-o', binary], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /presentation sizing and capability checks passed/);
});

test('preview and overlay share bounded native aspect-fit container and truthful capability input', () => {
  assert.match(ui, /GeometryReader \{ viewport in/);
  assert.match(ui, /cameraCard\(height: ScannerPresentation.previewHeight\(/);
  assert.match(ui, /availableHeight: viewport.size.height/);
  assert.match(ui, /private func cameraCard\(height: CGFloat\)/);
  assert.match(ui, /\.frame\(height: height\)/);
  assert.match(ui, /ScannerPresentation.cameraHint\(pipSupported: model.pip.isSupported\)/);
  const capture = readFileSync(new URL('../MyEyes/CameraCapture.swift', import.meta.url), 'utf8');
  assert.match(capture, /previewLayer.videoGravity = .resizeAspect\b/);
  assert.match(ui, /let scale = min\(size.width \/ imageSize.width, size.height \/ imageSize.height\)/);
});
