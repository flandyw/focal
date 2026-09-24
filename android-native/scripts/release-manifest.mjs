import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

function manifest(apk, metadata, version) {
  const output = JSON.parse(readFileSync(metadata, 'utf8'));
  const release = output.elements?.[0];
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || !release || release.versionName !== version) throw new Error('Android version does not match package.json');
  const code = Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);
  if (Number(match[2]) >= 1000 || Number(match[3]) >= 1000 || code !== release.versionCode) throw new Error('Android versionCode mismatch');
  const size = statSync(apk).size;
  if (size < 1 || size > 200_000_000) throw new Error('APK size is invalid');
  return {
    version,
    versionCode: code,
    apkUrl: `https://github.com/flandolf/focal/releases/download/app-v${version}/Focal-Android.apk`,
    sha256: createHash('sha256').update(readFileSync(apk)).digest('hex'),
    size,
  };
}

if (process.argv[2] === '--self-check') {
  const dir = mkdtempSync(join(tmpdir(), 'focal-android-release-'));
  try {
    const apk = join(dir, 'sample.apk');
    const metadata = join(dir, 'output-metadata.json');
    writeFileSync(apk, 'sample');
    writeFileSync(metadata, JSON.stringify({ elements: [{ versionName: '1.3.0', versionCode: 1003000 }] }));
    assert.equal(manifest(apk, metadata, '1.3.0').sha256, createHash('sha256').update('sample').digest('hex'));
    assert.throws(() => manifest(apk, metadata, '1.3.1'));
    console.log('Android release manifest self-check passed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
} else {
  const [apk, metadata, packageJson, destination, tag] = process.argv.slice(2);
  if (!apk || !metadata || !packageJson || !destination || !tag) throw new Error('Usage: node release-manifest.mjs APK METADATA PACKAGE_JSON OUTPUT_DIR TAG');
  const version = JSON.parse(readFileSync(packageJson, 'utf8')).version;
  if (tag !== `app-v${version}`) throw new Error(`Tag ${tag} does not match app-v${version}`);
  const data = manifest(apk, metadata, version);
  copyFileSync(apk, join(destination, 'Focal-Android.apk'));
  writeFileSync(join(destination, 'android-update.json'), JSON.stringify(data) + '\n');
}
