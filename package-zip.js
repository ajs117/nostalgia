// Cross-platform packaging: zips dist/ into nostalgia-v<version>.zip at the
// repo root. Uses the native `zip` binary on macOS/Linux and PowerShell's
// Compress-Archive on Windows (the old npm script was Windows-only).
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { version } = require('./package.json');

const distDir = path.resolve(__dirname, 'dist');
const outFile = path.resolve(__dirname, `nostalgia-v${version}.zip`);

if (!fs.existsSync(distDir)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

try {
  if (process.platform === 'win32') {
    execSync(
      `powershell -ExecutionPolicy Bypass -Command "Compress-Archive -Path dist\\* -DestinationPath '${outFile}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`zip -r -X -q '${outFile}' .`, { cwd: distDir, stdio: 'inherit' });
  }
  const sizeKb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`✓ Packaged ${path.basename(outFile)} (${sizeKb} KB)`);
} catch (error) {
  console.error('Packaging failed:', error.message);
  process.exit(1);
}
