const fs = require('fs');
const path = require('path');

// Try to load dependencies
let sharp = null;
let terser = null;
try {
  sharp = require('sharp');
} catch (e) {
  // sharp not available, will use fallback
}
try {
  terser = require('terser');
} catch (e) {
  // terser not available, will use basic minifier
}

// Advanced minifier using terser
async function minifyJS(code, filename) {
  if (terser) {
    try {
      const result = await terser.minify(code, {
        compress: {
          drop_console: false, // Keep console.error and console.warn
          passes: 2,
          unsafe: false,
          unsafe_comps: false,
          unsafe_math: false,
          unsafe_methods: false,
          unsafe_proto: false,
          unsafe_regexp: false,
          unsafe_undefined: false
        },
        mangle: {
          reserved: ['chrome', 'indexedDB', 'FileReader', 'Blob', 'URL', 'fetch']
        },
        format: {
          comments: false,
          beautify: false
        }
      });
      if (result.error) {
        console.warn(`⚠ Terser error for ${filename}, using basic minifier:`, result.error.message);
        return basicMinifyJS(code);
      }
      return result.code;
    } catch (error) {
      console.warn(`⚠ Terser failed for ${filename}, using basic minifier:`, error.message);
      return basicMinifyJS(code);
    }
  }
  return basicMinifyJS(code);
}

// Basic minifier fallback
function basicMinifyJS(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '') // Remove line comments
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/\s*([{}();,=+\-*/])\s*/g, '$1') // Remove spaces around operators
    .replace(/;\s*}/g, '}') // Remove semicolons before closing braces
    .trim();
}

function minifyCSS(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/\s*([{}:;,>+~])\s*/g, '$1') // Remove spaces around selectors
    .replace(/;\s*}/g, '}') // Remove semicolons before closing braces
    .trim();
}

function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

function copyDirectory(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  entries.forEach((entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  });
}

async function build() {
  const distDir = path.join(__dirname, 'dist');

  // Clean dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  console.log('Building nostalgia extension...');
  console.log(terser ? '✓ Using Terser for advanced minification' : '⚠ Using basic minifier (install terser for better results)');
  console.log('');

  // Copy and minify JS files
  const jsFiles = ['background.js', 'syncOrdering.js', 'contentScript.js', 'i18n.js', 'app.js'];
  const originalSizes = {};
  const minifiedSizes = {};

  for (const file of jsFiles) {
    const src = path.join(__dirname, file);
    if (fs.existsSync(src)) {
      const content = fs.readFileSync(src, 'utf8');
      const originalSize = Buffer.byteLength(content, 'utf8');
      originalSizes[file] = originalSize;

      const minified = await minifyJS(content, file);
      const minifiedSize = Buffer.byteLength(minified, 'utf8');
      minifiedSizes[file] = minifiedSize;

      fs.writeFileSync(path.join(distDir, file), minified);
      const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
      console.log(`✓ Minified ${file}: ${(originalSize / 1024).toFixed(1)}KB → ${(minifiedSize / 1024).toFixed(1)}KB (${savings}% reduction)`);
    }
  }

  const totalOriginal = Object.values(originalSizes).reduce((a, b) => a + b, 0);
  const totalMinified = Object.values(minifiedSizes).reduce((a, b) => a + b, 0);
  const totalSavings = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);
  console.log(`\n📦 Total JS: ${(totalOriginal / 1024).toFixed(1)}KB → ${(totalMinified / 1024).toFixed(1)}KB (${totalSavings}% reduction)`);
  console.log('');

  // Copy and minify CSS files
  const cssFiles = ['styles.css'];
  const cssOriginalSizes = {};
  const cssMinifiedSizes = {};

  for (const file of cssFiles) {
    const src = path.join(__dirname, file);
    if (fs.existsSync(src)) {
      const content = fs.readFileSync(src, 'utf8');
      const originalSize = Buffer.byteLength(content, 'utf8');
      cssOriginalSizes[file] = originalSize;

      const minified = minifyCSS(content);
      const minifiedSize = Buffer.byteLength(minified, 'utf8');
      cssMinifiedSizes[file] = minifiedSize;

      fs.writeFileSync(path.join(distDir, file), minified);
      const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
      console.log(`✓ Minified ${file}: ${(originalSize / 1024).toFixed(1)}KB → ${(minifiedSize / 1024).toFixed(1)}KB (${savings}% reduction)`);
    }
  }

  const cssTotalOriginal = Object.values(cssOriginalSizes).reduce((a, b) => a + b, 0);
  const cssTotalMinified = Object.values(cssMinifiedSizes).reduce((a, b) => a + b, 0);
  const cssTotalSavings = ((1 - cssTotalMinified / cssTotalOriginal) * 100).toFixed(1);
  console.log(`📦 Total CSS: ${(cssTotalOriginal / 1024).toFixed(1)}KB → ${(cssTotalMinified / 1024).toFixed(1)}KB (${cssTotalSavings}% reduction)`);
  console.log('');

  // Copy HTML files (no minification needed)
  const htmlFiles = ['index.html'];
  htmlFiles.forEach(file => {
    const src = path.join(__dirname, file);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(distDir, file));
      console.log(`✓ Copied ${file}`);
    }
  });

  // Copy manifest
  copyFile(path.join(__dirname, 'manifest.json'), path.join(distDir, 'manifest.json'));
  console.log('✓ Copied manifest.json');

  copyDirectory(path.join(__dirname, '_locales'), path.join(distDir, '_locales'));
  console.log('✓ Copied _locales');

  // Convert SVG to PNG icons if sharp is available, otherwise copy existing PNGs
  const svgPath = path.join(__dirname, 'logo.svg');
  if (fs.existsSync(svgPath) && sharp) {
    console.log('Converting SVG to PNG icons...');
    const svgBuffer = fs.readFileSync(svgPath);

    // Generate different sizes
    const sizes = [
      { size: 16, name: 'logo16.png' },
      { size: 48, name: 'logo48.png' },
      { size: 128, name: 'logo128.png' },
      { size: 192, name: 'logo192.png' },
      { size: 512, name: 'logo512.png' }
    ];

    Promise.all(sizes.map(({ size, name }) => {
      return sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(path.join(distDir, name))
        .then(() => {
          // Also copy to root directory for development
          fs.copyFileSync(path.join(distDir, name), path.join(__dirname, name));
          console.log(`✓ Generated ${name} (${size}x${size})`);
        });
    })).then(() => {
      // Generate favicon (16x16)
      return sharp(svgBuffer)
        .resize(16, 16)
        .png()
        .toFile(path.join(distDir, 'favicon.ico'))
        .then(() => {
          // Also copy favicon to root directory
          fs.copyFileSync(path.join(distDir, 'favicon.ico'), path.join(__dirname, 'favicon.ico'));
          console.log('✓ Generated favicon.ico');
          console.log('\n✓ Build complete! Output in dist/ directory');
        });
    }).catch(err => {
      console.error('Error converting SVG:', err.message);
      // Fallback to copying existing assets
      copyExistingAssets(distDir);
      console.log('\n✓ Build complete! Output in dist/ directory');
    });
  } else {
    // Copy existing PNG icons or use fallback
    if (fs.existsSync(svgPath) && !sharp) {
      console.log('⚠ SVG found but sharp not available. Install sharp: npm install sharp');
      console.log('  Falling back to existing PNG files...');
    }
    copyExistingAssets(distDir);
    console.log('\n✓ Build complete! Output in dist/ directory');
  }
}

function copyExistingAssets(distDir) {
  const assets = ['logo16.png', 'logo48.png', 'logo128.png', 'logo192.png', 'logo512.png', 'favicon.ico'];
  assets.forEach(asset => {
    const src = path.join(__dirname, asset);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(distDir, asset));
      console.log(`✓ Copied ${asset}`);
    }
  });
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

