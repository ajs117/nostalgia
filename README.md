# nostalgia

**nostalgia** - Your Instagram saved posts viewer

A Chrome and Edge extension that lets you sync, view, and organize your Instagram saved posts with a fast local viewer and an Instagram-inspired interface.

## Features

- 🔄 **Sync Saved Posts**: Automatically sync all your Instagram saved posts
- 📸 **Media Support**: View both images and videos
- 🎨 **Adaptive Themes**: Light and dark modes with Instagram-inspired branding
- 🔍 **Search & Filter**: Search posts by caption, filter by type (photo/video)
- 🎲 **Multiple Sort Modes**: Sort by newest saved, newest posted, alphabetical, or random with reshuffle
- 📁 **Collections**: Organize posts into collections
- 💾 **Offline Access**: All media stored locally in IndexedDB
- 🌍 **Internationalized UI**: English, Spanish, Simplified Chinese, Hindi, and Arabic

## Installation

### From Source

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `nostalgia` directory for development, or the `dist` directory after running a production build

### Building for Production

```bash
npm run build
```

This will:
- Minify all JavaScript files
- Minify all CSS files
- Copy all necessary files to the `dist/` directory
- Create a production-ready extension package

The built extension will be in the `dist/` directory.

To create a versioned zip package as well:

```bash
npm run package
```

This creates `nostalgia-v<version>.zip` in the project root.

## Usage

1. **Open Instagram**: Navigate to `https://www.instagram.com`
2. **Start Sync**: Click the extension icon or use the "Sync Posts" button in the viewer
3. **Sync Drawer**: A drawer will appear on Instagram with sync controls
4. **View Posts**: Open the extension viewer to browse your synced posts
5. **Search & Filter**: Use the search bar and filters to find specific posts

## Development

### Project Structure

```
nostalgia/
├── app.js             # Main viewer application
├── background.js      # Service worker (sync, storage, pagination)
├── contentScript.js   # Instagram page integration and sync UI
├── index.html         # Viewer page
├── styles.css         # Viewer styles
├── manifest.json      # Extension manifest
├── build.js           # Production build script
├── INSTALL.md         # Browser installation notes
├── SHIPPING.md        # Release checklist
├── __tests__/         # Jest test suite
└── dist/              # Generated production build output
```

### Building

```bash
# Build for production
npm run build

# Build and create zip package
npm run package
```

### Testing & Quality Gate

```bash
# Run quality gate (lint fix + build + tests)
npm run quality-gate

# Run tests only
npm test

# Run tests with coverage
npm run test:coverage

# Run the gradual TypeScript baseline check
npm run typecheck

# Run tests in watch mode
npm run test:watch

# Run ESLint
npm run lint

# Run ESLint with auto-fix
npm run lint:fix
```

The quality gate script will:
1. ✅ Run ESLint with auto-fix
2. ✅ Build the extension
3. ✅ Run unit tests with coverage

All steps must pass for the quality gate to succeed.

## Version

**Current Version**: 2.0.0

## License

MIT

## Privacy

- All data is stored locally in your browser
- No data is sent to external servers
- Instagram API calls are made directly from your browser
- Your credentials are never stored




