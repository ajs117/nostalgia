// Debug script to check sync progress
// Run this in Chrome DevTools console while on instagram.com

console.log('=== NOSTALGIA SYNC DEBUG ===');

// Check local storage for progress
chrome.storage.local.get(['instagram_sync_progress'], (result) => {
  console.log('Sync Progress:', result);

  if (result.instagram_sync_progress) {
    const progress = result.instagram_sync_progress;
    console.log(`Synced: ${progress.synced}, Failed: ${progress.failed}`);
    console.log(`Min ID: ${progress.minId}, Max ID: ${progress.maxId}`);
    console.log(`Timestamp: ${new Date(progress.timestamp).toLocaleString()}`);
  } else {
    console.log('No saved progress found');
  }
});

// Check if content script is loaded
console.log('Content script loaded:', typeof window.getInstagramSavedPosts !== 'undefined');

// Check sync state
console.log('Is syncing:', window.isSyncing || 'unknown');

// Get posts count from extension
chrome.runtime.sendMessage({ action: 'GET_POSTS_COUNT' }, (response) => {
  console.log('Posts in database:', response);
});








