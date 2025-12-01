# Nostalgia

**Nostalgia** - Your Instagram saved posts viewer

A Chrome extension that lets you sync, view, and organize your Instagram saved posts with a beautiful Instagram-inspired interface.

## Features

- 🔄 **Sync Saved Posts**: Automatically sync all your Instagram saved posts
- 📸 **Media Support**: View both images and videos
- 🎨 **Instagram-Style UI**: Beautiful dark theme with Instagram gradient branding
- 🔍 **Search & Filter**: Search posts by caption, filter by type (photo/video)
- 📁 **Collections**: Organize posts into collections
- 💾 **Offline Access**: All media stored locally in IndexedDB

## Installation

### From Source

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `nostalgia` directory (or `dist` directory for production build)

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
├── background.js      # Service worker (handles sync, storage)
├── contentScript.js   # Instagram page injection (sync drawer)
├── app.js            # Main viewer application
├── popup.js          # Extension popup
├── styles.css        # Main styles
├── theme.css         # Theme variables
├── popup.css         # Popup styles
├── index.html        # Viewer page
├── popup.html        # Popup page
├── manifest.json     # Extension manifest
└── build.js          # Build script

dist/                 # Production build output
```

### Building

```bash
# Build for production
npm run build

# Build and create zip package
npm run package
```

## Version

**Current Version**: 1.0

## License

MIT

## Privacy

- All data is stored locally in your browser
- No data is sent to external servers
- Instagram API calls are made directly from your browser
- Your credentials are never stored




