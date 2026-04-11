# Installing Nostalgia Extension

The recommended install path is to build the extension and load the generated `dist` folder as an unpacked extension.

## Build First

```bash
npm run build
```

Optional: create a versioned archive for release handoff.

```bash
npm run package
```

This creates `nostalgia-v<version>.zip` in the project root.

## Microsoft Edge

### Load Unpacked

1. Open Microsoft Edge
2. Navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle in the bottom-left corner)
4. Click **"Load unpacked"** button
5. Select the `dist` folder from the nostalgia directory
6. The extension will be installed and ready to use!

## Google Chrome

### Load Unpacked

1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **"Load unpacked"** button
5. Select the `dist` folder from the nostalgia directory

## Troubleshooting

### Extension Not Loading

- Make sure you selected the `dist` folder, not the parent directory
- Run `npm run build` again if `dist` is missing or stale
- Check that all files are present in the `dist` folder
- Look for error messages in the extensions page

### Permission Errors

- Make sure Developer mode is enabled
- Try restarting the browser
- Check that the manifest.json is valid

### Extension Icon Not Showing

- The extension should appear in your extensions toolbar
- Click the puzzle piece icon (Edge) or extensions icon (Chrome) to see all extensions
- Pin the extension for easier access

## After Installation

1. Navigate to `https://www.instagram.com`
2. Click the Nostalgia extension icon
3. Click "Sync Posts" to start syncing your saved posts
4. Open the main viewer to browse your posts




