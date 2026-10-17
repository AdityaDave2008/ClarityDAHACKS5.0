import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const catalog = new URL('MyEyes/Assets.xcassets/', root);
const project = readFileSync(new URL('MyEyes.xcodeproj/project.pbxproj', root), 'utf8');

// Source/resource guards. Set CLARITY_BUILT_APP to additionally inspect a real Xcode output.
test('native AppIcon supplies a single opaque 1024px iOS image', () => {
  const manifest = new URL('AppIcon.appiconset/Contents.json', catalog);
  assert.ok(existsSync(manifest), 'Native AppIcon manifest must exist');
  const { images } = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(images.length, 1);
  assert.deepEqual(images[0], { filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' });
  const png = readFileSync(new URL('AppIcon.appiconset/AppIcon.png', catalog));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[25], 2, 'RGB PNG must not carry an alpha channel');
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    assert.notEqual(png.toString('ascii', offset + 4, offset + 8), 'tRNS', 'No transparency chunk');
    offset += length + 12;
  }
});

test('catalog is connected through project file, group and resource build phase', () => {
  const file = project.match(/(\w+) \/\* Assets.xcassets \*\/ = \{isa = PBXFileReference;[^\n]*path = Assets.xcassets;/);
  assert.ok(file, 'Catalog requires a PBXFileReference');
  const build = project.match(new RegExp('(\\w+) /\\* Assets.xcassets in Resources \\*/ = \\{isa = PBXBuildFile; fileRef = ' + file[1]));
  assert.ok(build, 'Catalog requires a PBXBuildFile');
  const resources = project.split('/* Begin PBXResourcesBuildPhase section */')[1].split('/* End PBXResourcesBuildPhase section */')[0];
  assert.ok(resources.includes(build[1]), 'Catalog build file must be in Resources');
  const groups = project.split('/* Begin PBXGroup section */')[1].split('/* End PBXGroup section */')[0];
  assert.ok(groups.includes(file[1]), 'Catalog must belong to native source group');
  const configurations = [...project.matchAll(/buildSettings = \{([\s\S]*?)\n\t\t\t\};\n\t\t\tname = (Debug|Release);/g)]
    .filter(([, settings]) => settings.includes('PRODUCT_BUNDLE_IDENTIFIER'));
  assert.equal(configurations.length, 2);
  for (const [, settings, name] of configurations) {
    assert.match(settings, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/, `${name} selects AppIcon`);
  }
});

test('built app contains compiled assets and generated primary icon metadata', { skip: !process.env.CLARITY_BUILT_APP }, () => {
  assert.equal(process.platform, 'darwin', 'Built bundle verification uses macOS plutil');
  const app = process.env.CLARITY_BUILT_APP;
  assert.ok(existsSync(`${app}/Assets.car`), 'actool must compile the asset catalog');
  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', `${app}/Info.plist`], { encoding: 'utf8' }));
  const primary = plist.CFBundleIcons?.CFBundlePrimaryIcon;
  assert.equal(primary?.CFBundleIconName, 'AppIcon');
  assert.ok(primary.CFBundleIconFiles?.length > 0, 'Generated icon files must be declared');
  for (const name of primary.CFBundleIconFiles) {
    assert.ok(['.png', '@2x.png', '@3x.png'].some(suffix => existsSync(`${app}/${name}${suffix}`)), `Missing compiled icon ${name}`);
  }
});
