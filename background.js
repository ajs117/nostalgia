/** @type {string[]} */
let capturedImages = [];
let capturedImagesCleanupTimeout = null;
let extensionTabId = null;
let activeInstagramTabId = null;
// True while a saved-posts sync is running. Video-URL lookups must NOT touch the
// sync tab or fire concurrent Instagram API calls during this window, or the
// sync's paginated request sequence gets corrupted (it "loses track" of state).
let syncInProgress = false;
// A dedicated tab for tab-free video-URL lookups, kept entirely separate from
// activeInstagramTabId (the sync tab) so the two never interfere.
let videoApiTabId = null;

// Mutex for preventing race conditions in batch saves
let batchSaveLock = Promise.resolve();

// MV3 kills the service worker after ~30s idle -- easily hit while a sync sits
// in a rate-limit backoff. In-memory sync state must survive that restart or
// the worker wakes up amnesiac: the concurrent-sync guard fails, GET_SYNC_STATE
// answers wrong, and the sync tab leaks. Persist to storage.session (cleared on
// browser exit, which matches the state's real lifetime) and rehydrate on boot.
const SYNC_STATE_SESSION_KEY = 'nostalgia_sw_sync_state';

function persistSyncState() {
  try {
    chrome.storage.session.set({
      [SYNC_STATE_SESSION_KEY]: { syncInProgress, activeInstagramTabId }
    });
  } catch (e) { /* storage.session unavailable: state stays in-memory only */ }
}

try {
  chrome.storage.session.get([SYNC_STATE_SESSION_KEY], (result) => {
    const saved = result && result[SYNC_STATE_SESSION_KEY];
    if (!saved || syncInProgress) return;
    const tabId = saved.activeInstagramTabId;
    if (!tabId) return;
    // Validate against reality: the tab may have been closed while the worker
    // was asleep (onRemoved never fired for a dead worker).
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab) {
        activeInstagramTabId = tabId;
        syncInProgress = !!saved.syncInProgress;
      } else {
        persistSyncState();
      }
    });
  });
} catch (e) { /* ignore */ }

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }, (newTab) => {
    extensionTabId = newTab.id;
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === extensionTabId) {
    extensionTabId = null;
  }
  if (tabId === activeInstagramTabId) {
    activeInstagramTabId = null;
    // The sync runs in this tab; if it's gone, the sync is no longer running.
    // Clear the flag so a future sync isn't permanently blocked.
    syncInProgress = false;
    persistSyncState();
  }
  if (tabId === videoApiTabId) {
    videoApiTabId = null;
  }
});

// Function kept for manual user-initiated sync only
// eslint-disable-next-line no-unused-vars
function _checkForSavedProgress(tabId = null) {
  chrome.storage.local.get(['instagram_sync_progress'], (result) => {
    if (result.instagram_sync_progress) {
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'SHOW_SYNC_DRAWER' }, () => {
          if (chrome.runtime.lastError) {
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: 'SHOW_SYNC_DRAWER' });
            }, 2000);
          }
        });
      } else {
        chrome.tabs.query({ url: 'https://www.instagram.com/*' }, (tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'SHOW_SYNC_DRAWER' });
          }
        });
      }
    }
  });
}

let updateExtensionTabTimeout = null;
function updateExtensionTab(immediate = false) {
  // Throttle updates during sync to prevent UI flicker and performance issues
  if (updateExtensionTabTimeout && !immediate) {
    return; // Already scheduled
  }

  const doUpdate = () => {
    updateExtensionTabTimeout = null;
    chrome.tabs.query({ url: chrome.runtime.getURL('index.html') }, (tabs) => {
      if (tabs.length > 0) {
        const activeTab = tabs.find(tab => tab.active) || tabs[0];
        if (activeTab) {
          extensionTabId = activeTab.id;
        }

        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'UPDATE_ITEMS' }, () => {
            if (chrome.runtime.lastError) {
              // Tab might not be ready, that's okay
            }
          });
        });
      }
    });
  };

  if (immediate) {
    doUpdate();
  } else {
    // Throttle to max once per 2 seconds during sync
    if (updateExtensionTabTimeout) {
      clearTimeout(updateExtensionTabTimeout);
    }
    updateExtensionTabTimeout = setTimeout(doUpdate, 2000);
  }
}

// Throttle progress events to avoid overwhelming the extension page during sync.
// Service workers can get bogged down by high-frequency messaging when the DB is large.
let lastSyncProgressBroadcastAt = 0;
let pendingSyncProgressPayload = null;
let syncProgressBroadcastTimeout = null;
const SYNC_PROGRESS_BROADCAST_INTERVAL_MS = 500;

function throttleSyncProgressBroadcast(payload) {
  pendingSyncProgressPayload = payload;
  const now = Date.now();
  const elapsed = now - lastSyncProgressBroadcastAt;

  const flush = () => {
    syncProgressBroadcastTimeout = null;
    lastSyncProgressBroadcastAt = Date.now();
    const toSend = pendingSyncProgressPayload;
    pendingSyncProgressPayload = null;
    if (toSend) {
      safeBroadcast(toSend);
    }
  };

  if (elapsed >= SYNC_PROGRESS_BROADCAST_INTERVAL_MS) {
    if (syncProgressBroadcastTimeout) {
      clearTimeout(syncProgressBroadcastTimeout);
      syncProgressBroadcastTimeout = null;
    }
    flush();
    return;
  }

  if (!syncProgressBroadcastTimeout) {
    syncProgressBroadcastTimeout = setTimeout(flush, SYNC_PROGRESS_BROADCAST_INTERVAL_MS - elapsed);
  }
}

// Drop any queued progress broadcast. Must be called right before SYNC_COMPLETE
// (or SYNC_STOPPED) is sent: otherwise a trailing throttled SYNC_PROGRESS can
// fire ~500ms later and overwrite the final total with the (larger) estimate,
// which is why the tile appeared to "revert to the estimated total" on complete.
function cancelPendingSyncProgressBroadcast() {
  if (syncProgressBroadcastTimeout) {
    clearTimeout(syncProgressBroadcastTimeout);
    syncProgressBroadcastTimeout = null;
  }
  pendingSyncProgressPayload = null;
}

// Safe message sender that handles closed channels
function safeSendToTab(tabId, message) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      // Channel closed, ignore
    }
  });
}

function safeBroadcast(message) {
  // Send to extension tabs
  chrome.tabs.query({ url: chrome.runtime.getURL('index.html') }, (tabs) => {
    if (chrome.runtime.lastError) return;
    (tabs || []).forEach(tab => safeSendToTab(tab.id, message));
  });
}

function sanitizeDownloadFilename(filename) {
  // Sanitize each path segment but keep '/' so callers can target a subfolder
  // (e.g. "nostalgia/<file>"). Drop traversal ('..') and empty segments so the
  // download can't escape the Downloads directory.
  const sanitizeSegment = (segment) =>
    Array.from(segment, (character) => {
      const codePoint = character.charCodeAt(0);
      if ('<>:"\\|?*'.includes(character) || codePoint < 32) {
        return '-';
      }
      return character;
    })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

  const segments = String(filename || 'nostalgia-media')
    .split('/')
    .map(sanitizeSegment)
    .filter((segment) => segment && segment !== '.' && segment !== '..');

  return segments.join('/').slice(0, 200) || 'nostalgia-media';
}

function waitForTabToComplete(tabId) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      chrome.tabs.onUpdated.removeListener(handleUpdate);
    };

    const handleUpdate = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        cleanup();
        setTimeout(() => resolve(tabId), 1200);
      }
    };

    chrome.tabs.onUpdated.addListener(handleUpdate);

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Instagram tab to load'));
    }, 15000);

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        cleanup();
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (tab && tab.status === 'complete') {
        cleanup();
        setTimeout(() => resolve(tabId), 1200);
      }
    });
  });
}

function ensureInstagramTabForAction() {
  return new Promise((resolve, reject) => {
    if (activeInstagramTabId !== null) {
      chrome.tabs.get(activeInstagramTabId, (tab) => {
        if (!chrome.runtime.lastError && tab) {
          resolve(activeInstagramTabId);
          return;
        }

        activeInstagramTabId = null;
        chrome.tabs.create({ url: 'https://www.instagram.com/', active: false }, (newTab) => {
          if (chrome.runtime.lastError || !newTab) {
            reject(new Error(chrome.runtime.lastError?.message || 'Failed to open Instagram tab'));
            return;
          }

          activeInstagramTabId = newTab.id;
          waitForTabToComplete(newTab.id).then(resolve).catch(reject);
        });
      });
      return;
    }

    chrome.tabs.query({ url: 'https://www.instagram.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        activeInstagramTabId = tabs[0].id;
        resolve(activeInstagramTabId);
        return;
      }

      chrome.tabs.create({ url: 'https://www.instagram.com/', active: false }, (newTab) => {
        if (chrome.runtime.lastError || !newTab) {
          reject(new Error(chrome.runtime.lastError?.message || 'Failed to open Instagram tab'));
          return;
        }

        activeInstagramTabId = newTab.id;
        waitForTabToComplete(newTab.id).then(resolve).catch(reject);
      });
    });
  });
}

// Resolve/reuse a dedicated hidden Instagram tab for tab-free video-URL lookups.
// This is deliberately kept SEPARATE from activeInstagramTabId (the sync tab):
// it never adopts, creates over, or hands back the sync tab, so video lookups
// can't disturb an in-flight sync. Never resolves the sync tab.
function ensureVideoApiTab() {
  return new Promise((resolve, reject) => {
    if (videoApiTabId !== null) {
      chrome.tabs.get(videoApiTabId, (tab) => {
        if (!chrome.runtime.lastError && tab) {
          resolve(videoApiTabId);
          return;
        }
        videoApiTabId = null;
        pickOrCreateVideoApiTab(resolve, reject);
      });
      return;
    }
    pickOrCreateVideoApiTab(resolve, reject);
  });
}

function pickOrCreateVideoApiTab(resolve, reject) {
  chrome.tabs.query({ url: 'https://www.instagram.com/*' }, (tabs) => {
    // Reuse any existing Instagram tab EXCEPT the sync tab.
    const usable = (tabs || []).find((t) => t.id !== activeInstagramTabId);
    if (usable) {
      videoApiTabId = usable.id;
      resolve(videoApiTabId);
      return;
    }
    chrome.tabs.create({ url: 'https://www.instagram.com/', active: false }, (newTab) => {
      if (chrome.runtime.lastError || !newTab) {
        reject(new Error(chrome.runtime.lastError?.message || 'Failed to open Instagram tab'));
        return;
      }
      videoApiTabId = newTab.id;
      waitForTabToComplete(newTab.id).then(resolve).catch(reject);
    });
  });
}

// Try to resolve a video URL through Instagram's authenticated media-info API in
// a dedicated content-script tab, instead of spawning a throwaway per-video tab.
// Resolves to { success, videoUrl } on success or null on any failure, so callers
// can cleanly fall back to the legacy tab-scrape. Never rejects.
//
// While a sync is running we deliberately bail (resolve null -> tab-scrape
// fallback): firing media-info API calls in parallel with the sync's paginated
// requests corrupts the sync's state ("it doesn't know what state it's in").
function fetchVideoViaContentApi(mediaId, carouselIndex = null) {
  return new Promise((resolve) => {
    if (!mediaId || syncInProgress) {
      resolve(null);
      return;
    }

    ensureVideoApiTab().then((tabId) => {
      chrome.tabs.sendMessage(
        tabId,
        { action: 'FETCH_MEDIA_VIDEO', mediaId, carouselIndex },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          if (response && response.success && response.videoUrl) {
            resolve(response);
          } else {
            resolve(null);
          }
        }
      );
    }).catch(() => resolve(null));
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle messages - each must explicitly return true (async) or false (sync)

  // Ping to wake up service worker
  if (request.action === 'PING') {
    sendResponse({ success: true });
    return false;
  }

  // Authoritative "is a sync running right now?" for the viewer UI. The page
  // can reload (or open fresh) mid-sync; without this it guesses and gets the
  // buttons/progress state wrong.
  if (request.action === 'GET_SYNC_STATE') {
    sendResponse({ syncing: syncInProgress && activeInstagramTabId !== null });
    return false;
  }

  if (request.action === 'CAPTURE_IMAGES') {
    capturedImages = Array.isArray(request.images) ? request.images : [];

    // Prevent unbounded memory retention if very large payloads are captured.
    // Keep only the most recent items.
    const MAX_CAPTURED_IMAGES = 500;
    if (capturedImages.length > MAX_CAPTURED_IMAGES) {
      capturedImages = capturedImages.slice(-MAX_CAPTURED_IMAGES);
    }

    // Auto-clear after a short period to avoid keeping large blobs in memory.
    if (capturedImagesCleanupTimeout) {
      clearTimeout(capturedImagesCleanupTimeout);
    }
    capturedImagesCleanupTimeout = setTimeout(() => {
      capturedImages = [];
      capturedImagesCleanupTimeout = null;
    }, 2 * 60 * 1000);
    return false;
  }

  if (request.action === 'FETCH_IMAGE') {
    fetchImageAsDataURL(request.imageUrl)
      .then((dataUrl) => sendResponse({ success: true, dataUrl: dataUrl }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'GET_CAPTURED_IMAGES') {
    sendResponse(capturedImages);
    return false;
  }

  if (request.action === 'OPEN_MAIN_VIEWER') {
    if (extensionTabId !== null) {
      chrome.tabs.get(extensionTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          chrome.tabs.create(
            { url: chrome.runtime.getURL('index.html') },
            (newTab) => {
              extensionTabId = newTab.id;
              chrome.tabs.update(newTab.id, { active: true });
            }
          );
        } else {
          chrome.tabs.update(extensionTabId, { active: true });
        }
      });
    } else {
      chrome.tabs.create(
        { url: chrome.runtime.getURL('index.html') },
        (newTab) => {
          extensionTabId = newTab.id;
        }
      );
    }
    return false;
  }

  if (request.action === 'GET_INSTAGRAM_POSTS') {
    // Paginated post retrieval
    const page = request.page || 1;
    const limit = request.limit || 50;
    const sortBy = request.sortBy || 'newest';
    const filterType = request.filterType || 'all';
    const searchQuery = request.searchQuery || '';
    const hashtagFilter = request.hashtagFilter || null;
    const randomSeed = Number.isFinite(request.randomSeed) ? request.randomSeed : null;

    getPostsPaginated(page, limit, sortBy, filterType, searchQuery, hashtagFilter, randomSeed).then(async (result) => {
      // Thumbnails are stored as binary blobs; rehydrate the page's records to
      // data URLs here so the viewer's render path stays unchanged.
      result.posts = await hydrateThumbnails(result.posts);
      sendResponse({
        success: true,
        posts: result.posts,
        total: result.total,
        hasMore: result.hasMore,
        page: result.page
      });
    }).catch((error) => {
      console.error('Error retrieving posts:', error);
      sendResponse({ success: false, error: error.message, posts: [], total: 0 });
    });
    return true;
  }

  if (request.action === 'GET_COLLECTIONS') {
    getCollectionsFromIndexedDB().then((collections) => {
      sendResponse({ success: true, collections });
    }).catch((error) => {
      console.error('Error retrieving collections:', error);
      sendResponse({ success: false, error: error.message, collections: [] });
    });
    return true;
  }

  if (request.action === 'DOWNLOAD_MEDIA') {
    if (!request.url) {
      sendResponse({ success: false, error: 'No media URL provided' });
      return false;
    }

    chrome.downloads.download({
      url: request.url,
      filename: sanitizeDownloadFilename(request.filename),
      saveAs: true,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      sendResponse({ success: true, downloadId });
    });

    return true;
  }

  if (request.action === 'ADD_POST_TO_NOSTALGIA_COLLECTION') {
    const post = request.post;
    if (!post || !post.id || !post.link) {
      sendResponse({ success: false, error: 'Post metadata is incomplete' });
      return false;
    }

    ensureInstagramTabForAction().then((tabId) => {
      chrome.tabs.sendMessage(tabId, {
        action: 'ADD_POST_TO_NOSTALGIA_COLLECTION',
        post
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        if (response?.updatedCollections) {
          storeCollectionsInIndexedDB(response.updatedCollections).catch((error) => {
            console.error('Error updating collections cache:', error);
          });
        }

        sendResponse(response || { success: false, error: 'No response from Instagram tab' });
      });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });

    return true;
  }

  if (request.action === 'BUMP_POST_TO_TOP') {
    const post = request.post;
    if (!post || !post.id) {
      sendResponse({ success: false, error: 'Post metadata is incomplete' });
      return false;
    }

    ensureInstagramTabForAction().then((tabId) => {
      chrome.tabs.sendMessage(tabId, { action: 'BUMP_POST_TO_TOP', post }, async (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (!response || !response.success) {
          sendResponse(response || { success: false, error: 'No response from Instagram tab' });
          return;
        }

        // Mirror the bump locally: put it just above the current max savedOrder
        // so nostalgia's "Newest Saved" also shows it on top.
        try {
          const bounds = await getDbBounds();
          const newOrder = (typeof bounds.max === 'number' ? bounds.max : 0) + 1;
          await updatePostsSavedOrder([{ id: post.id, link: post.link, savedOrder: newOrder }]);
          updateExtensionTab();
          sendResponse({ success: true, savedOrder: newOrder });
        } catch (error) {
          // The Instagram bump succeeded; only the local reorder failed.
          sendResponse({ success: true, localReorderFailed: true });
        }
      });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });

    return true;
  }

  if (request.action === 'GET_POSTS_COUNT') {
    // O(1) count retrieval from metadata
    getPostsCount().then((count) => {
      sendResponse({ count });
    }).catch((error) => {
      console.error('Error getting posts count:', error);
      // count:null (not 0) -- "couldn't read" must be distinguishable from
      // "genuinely empty" or the sync wrongly restarts from scratch.
      sendResponse({ count: null, error: error.message || 'count unavailable' });
    });
    return true;
  }

  if (request.action === 'GET_ALL_HASHTAGS') {
    // Get all hashtags with counts from all posts
    // IMPORTANT: Keep reference to sendResponse and return true immediately
    const responseCallback = sendResponse;
    getAllHashtagsWithCounts()
      .then((hashtags) => {
        responseCallback({ success: true, hashtags: hashtags || [] });
      })
      .catch((error) => {
        console.error('Error getting hashtags:', error);
        responseCallback({ success: false, hashtags: [] });
      });
    return true; // Keep message channel open for async response
  }



  if (request.action === 'CHECK_POSTS_BATCH_EXISTS') {
    // Check multiple posts for existence at once
    const postIds = request.postIds || [];
    const links = request.links || [];

    checkPostsBatchExists(postIds, links)
      .then((results) => {
        sendResponse({ results });
      })
      .catch((error) => {
        console.error('Error in batch existence check:', error);
        // results:null, NOT all-false. "Couldn't check" must never read as
        // "none of these exist": that made the sync treat the whole library as
        // new (full feed re-walk) and false-triggered order-drift rebuilds.
        sendResponse({ results: null, error: error.message || 'existence check failed' });
      });
    return true;
  }

  if (request.action === 'SYNC_WITH_INSTAGRAM') {
    syncInProgress = true;
    chrome.tabs.create({ url: 'https://www.instagram.com/' }, (tab) => {
      activeInstagramTabId = tab.id;
      persistSyncState();
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          safeSendToTab(tabId, { action: 'SHOW_SYNC_DRAWER' });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      });
    });
    return false;
  }

  if (request.action === 'SYNC_WITH_INSTAGRAM_BACKGROUND') {
    // Guard against a second concurrent sync (e.g. auto-sync firing while a
    // previous background sync is still running). Two syncs writing the same DB
    // and reporting conflicting counts is what makes progress oscillate and the
    // state go haywire. Just re-announce the running sync instead.
    if (syncInProgress && activeInstagramTabId !== null) {
      safeBroadcast({ action: 'SYNC_STARTED' });
      return false;
    }

    // Open Instagram in a background tab for sync (cookies required)
    syncInProgress = true;
    chrome.tabs.create({ url: 'https://www.instagram.com/', active: false }, (tab) => {
      activeInstagramTabId = tab.id;
      persistSyncState();

      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          // Start sync via content script after page loads
          setTimeout(() => {
            safeSendToTab(tabId, { action: 'START_BACKGROUND_SYNC' });
          }, 1500);
          chrome.tabs.onUpdated.removeListener(listener);
        }
      });
    });
    // Notify UI
    safeBroadcast({ action: 'SYNC_STARTED' });
    return false;
  }

  if (request.action === 'REBUILD_STARTED') {
    // Sent by the content script when a sync detects saved-order drift and
    // starts an automatic rebuild in the same tab (see contentScript.js).
    safeBroadcast({ action: 'REBUILD_STARTED' });
    return false;
  }

  if (request.action === 'REBUILD_SAVED_ORDER_BATCH') {
    updatePostsSavedOrder(request.updates || [])
      .then((updated) => {
        updateExtensionTab(false);
        sendResponse({ success: true, updated });
      })
      .catch((error) => {
        console.error('Error updating saved order:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'REBUILD_FINISHED' || request.action === 'REBUILD_STOPPED') {
    const message = {
      action: request.action === 'REBUILD_FINISHED' ? 'REBUILD_COMPLETE' : 'REBUILD_STOPPED',
      processed: request.processed || 0
    };
    safeBroadcast(message);
    if (activeInstagramTabId) {
      setTimeout(() => {
        if (activeInstagramTabId) {
          chrome.tabs.remove(activeInstagramTabId, () => {
            if (chrome.runtime.lastError) { /* tab may already be closed */ }
            activeInstagramTabId = null;
          });
        }
      }, 500);
    }
    setTimeout(() => updateExtensionTab(true), 500);
    return false;
  }

  if (request.action === 'START_SYNC') {
    if (activeInstagramTabId) {
      chrome.storage.local.get(['instagram_sync_progress'], () => {
        safeSendToTab(activeInstagramTabId, { action: 'SHOW_SYNC_DRAWER' });
        safeBroadcast({ action: 'SYNC_STARTED' });
        safeSendToTab(activeInstagramTabId, { action: 'IMPORT_INSTAGRAM_POSTS' });
      });
    }
    return false;
  }

  if (request.action === 'RETURN_TO_EXTENSION') {
    if (extensionTabId !== null) {
      chrome.tabs.update(extensionTabId, { active: true }, () => {
        setTimeout(updateExtensionTab, 500);
      });
    } else {
      chrome.tabs.create(
        { url: chrome.runtime.getURL('index.html') },
        (newTab) => {
          extensionTabId = newTab.id;
          setTimeout(updateExtensionTab, 500);
        }
      );
    }
    return false;
  }

  if (request.action === 'SAVE_POSTS_BATCH') {
    // Use mutex to prevent race conditions
    batchSaveLock = batchSaveLock.then(async () => {
      try {
        const newPosts = request.posts
          .filter(post => post && typeof post === 'object' && post.url)
          .map((post) => {
            const { url, title, thumbnail, username, collectionIds, isVideo, videoUrl, isCarousel, carouselMedia, carouselCount } = post;
            const postId = post.id || `${username}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            return {
              id: postId,
              link: url,
              thumbnail,
              title,
              username,
              collectionIds,
              isVideo,
              videoUrl,
              isCarousel: isCarousel || false,
              carouselMedia: carouselMedia || null,
              carouselCount: carouselCount || 0,
              timestamp: post.timestamp || Date.now(),
              takenAt: post.takenAt || post.timestamp || Date.now(),
              savedOrder: post.savedOrder // Preserve API order from sync
            };
          })
          .filter(Boolean);

        if (newPosts.length === 0) {
          sendResponse({ success: true, added: 0 });
          return;
        }

        // Store thumbnails as binary blobs (smaller on disk than inline base64)
        // and replace the inline data URL with a lightweight key reference.
        await migrateThumbnailsToBlobs(newPosts);

        // Add posts in batch for better performance
        const addedCount = await addPostsToIndexedDB(newPosts);

        // Update extension tab (throttled during sync)
        updateExtensionTab(false);
        sendResponse({ success: true, added: addedCount });
      } catch (error) {
        console.error('Error saving batch:', error);
        sendResponse({ success: false, error: error.message });
      }
    }).catch((error) => {
      console.error('Error in batch save lock:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'SAVE_COLLECTIONS') {
    storeCollectionsInIndexedDB(request.collections).catch((error) => {
      console.error('Error saving collections:', error);
    });
    return false;
  }

  if (request.action === 'SYNC_FINISHED') {
    syncInProgress = false;
    persistSyncState();
    cancelPendingSyncProgressBroadcast();
    const completeMsg = {
      action: 'SYNC_COMPLETE',
      syncedCount: request.syncedCount,
      failedCount: request.failedCount
    };
    safeBroadcast(completeMsg);
    if (activeInstagramTabId) {
      safeSendToTab(activeInstagramTabId, completeMsg);
      // Close the background Instagram tab after sync
      setTimeout(() => {
        if (activeInstagramTabId) {
          chrome.tabs.remove(activeInstagramTabId, () => {
            if (chrome.runtime.lastError) { /* tab might be closed */ }
            activeInstagramTabId = null;
          });
        }
      }, 1000);
    }
    setTimeout(() => updateExtensionTab(true), 500); // Immediate update after sync complete
    return false;
  }

  if (request.action === 'SYNC_PROGRESS_UPDATE') {
    // Forward progress updates to the extension tab (throttled to reduce message/UI load)
    throttleSyncProgressBroadcast({
      action: 'SYNC_PROGRESS',
      synced: request.synced,
      failed: request.failed,
      total: request.total || 0
    });
    return false;
  }

  if (request.action === 'IMPORT_FAILED') {
    syncInProgress = false;
    persistSyncState();
    cancelPendingSyncProgressBroadcast();
    safeBroadcast({ action: 'IMPORT_FAILED', error: request.error });
    if (activeInstagramTabId) {
      safeSendToTab(activeInstagramTabId, { action: 'IMPORT_FAILED', error: request.error });
      // Close the background sync tab; leaving it open kept stale tab/state
      // around that confused the next sync attempt.
      setTimeout(() => {
        if (activeInstagramTabId) {
          chrome.tabs.remove(activeInstagramTabId, () => {
            if (chrome.runtime.lastError) { /* tab may already be closed */ }
            activeInstagramTabId = null;
          });
        }
      }, 1000);
    }
    return false;
  }

  if (request.action === 'SYNC_LOGIN_REQUIRED') {
    syncInProgress = false;
    persistSyncState();
    safeBroadcast({ action: 'SYNC_LOGIN_REQUIRED', error: request.error });

    if (activeInstagramTabId) {
      chrome.tabs.update(activeInstagramTabId, { active: true }, () => {
        if (chrome.runtime.lastError) {
          // Tab may have been closed by the user.
        }
      });
    }

    return false;
  }

  if (request.action === 'STOP_SYNC') {
    if (activeInstagramTabId) {
      safeSendToTab(activeInstagramTabId, { action: 'STOP_SYNC' });
    }
    return false;
  }

  if (request.action === 'SYNC_STOPPED') {
    syncInProgress = false;
    persistSyncState();
    cancelPendingSyncProgressBroadcast();
    const stoppedMsg = {
      action: 'SYNC_STOPPED',
      syncedCount: request.syncedCount,
      failedCount: request.failedCount
    };
    safeBroadcast(stoppedMsg);
    // Close the background tab if sync was stopped
    if (activeInstagramTabId) {
      setTimeout(() => {
        if (activeInstagramTabId) {
          chrome.tabs.remove(activeInstagramTabId, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
            activeInstagramTabId = null;
          });
        }
      }, 500);
    }
    return false;
  }

  if (request.action === 'STORE_MEDIA_IN_IDB') {
    const { key, blob, type } = request;
    try {
      let blobObj;

      if (Array.isArray(blob)) {
        const uint8Array = new Uint8Array(blob);
        blobObj = new Blob([uint8Array], { type: type || (key.startsWith('vid_') ? 'video/mp4' : 'image/jpeg') });
      } else if (blob instanceof Blob) {
        blobObj = blob;
      } else if (blob instanceof Uint8Array) {
        blobObj = new Blob([blob], { type: type || (key.startsWith('vid_') ? 'video/mp4' : 'image/jpeg') });
      } else if (blob instanceof ArrayBuffer) {
        blobObj = new Blob([blob], { type: type || (key.startsWith('vid_') ? 'video/mp4' : 'image/jpeg') });
      } else {
        throw new Error(`Invalid blob data type: ${typeof blob}`);
      }

      if (!blobObj || blobObj.size === 0) {
        throw new Error('Failed to create valid blob');
      }

      storeMediaInIndexedDB(key, blobObj)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
    } catch (error) {
      console.error('Error creating blob:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (request.action === 'FETCH_AND_STORE_THUMBNAIL') {
    const { imageUrl, postId } = request;
    const thumbnailKey = `thumb_${postId}`;

    fetchImageAsDataURL(imageUrl)
      .then((dataUrl) => {
        fetch(dataUrl)
          .then(res => res.blob())
          .then(blob => {
            storeMediaInIndexedDB(thumbnailKey, blob)
              .then(() => sendResponse({ success: true, thumbnailKey }))
              .catch((error) => sendResponse({ success: false, error: error.message }));
          })
          .catch((error) => sendResponse({ success: false, error: error.message }));
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'FETCH_VIDEO_CDN') {
    try {
      const { permalink } = request;

      if (!permalink) {
        sendResponse({ success: false, error: 'No permalink provided' });
        return true;
      }

      let responseSent = false;
      const safeSendResponse = (response) => {
        if (!responseSent) {
          responseSent = true;
          sendResponse(response);
        }
      };

      const checkTabExists = (tabId, callback) => {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            callback(null, chrome.runtime.lastError.message);
          } else {
            callback(tab, null);
          }
        });
      };

      let shouldCloseTab = false;
      let hideListener = null;
      let updateListener = null;

      function cleanupListeners() {
        if (hideListener) {
          chrome.tabs.onActivated.removeListener(hideListener);
          hideListener = null;
        }
        if (updateListener) {
          chrome.tabs.onUpdated.removeListener(updateListener);
          updateListener = null;
        }
      }

      function createNewTab() {
        chrome.tabs.create({
          url: permalink,
          active: false,
          pinned: false
        }, (tab) => {
          if (chrome.runtime.lastError) {
            safeSendResponse({ success: false, error: `Failed to create tab: ${chrome.runtime.lastError.message}` });
            return;
          }
          shouldCloseTab = true;

          // Mute the scraping tab. Instagram autoplays the reel while we read the
          // CDN URL out of the page, and (especially during autoplay preload of
          // the *next* post) that audio would otherwise play out loud in the
          // background while the user is still watching the current video.
          chrome.tabs.update(tab.id, { muted: true }, () => {
            if (chrome.runtime.lastError) { /* tab may already be gone */ }
          });

          hideListener = (activeInfo) => {
            if (activeInfo.tabId === tab.id) {
              chrome.tabs.update(tab.id, { active: false });
            }
          };
          chrome.tabs.onActivated.addListener(hideListener);

          updateListener = (changedTabId, changeInfo) => {
            if (changedTabId === tab.id && changeInfo.active) {
              chrome.tabs.update(tab.id, { active: false });
            }
          };
          chrome.tabs.onUpdated.addListener(updateListener);

          chrome.tabs.query({}, (allTabs) => {
            if (allTabs && allTabs.length > 0) {
              const lastIndex = allTabs.length - 1;
              chrome.tabs.move(tab.id, { index: lastIndex }, () => {
                chrome.tabs.update(tab.id, { active: false }, () => {
                  setTimeout(() => {
                    chrome.tabs.update(tab.id, { active: false }, () => {
                      processTab(tab.id, true);
                    });
                  }, 50);
                });
              });
            } else {
              chrome.tabs.update(tab.id, { active: false }, () => {
                processTab(tab.id, true);
              });
            }
          });
        });
      }

      // Prefer the tab-free API path; only fall back to spawning a scrape tab
      // (createNewTab) if it can't resolve the URL. This is what stops tabs from
      // flashing in and out during autoplay/preload.
      fetchVideoViaContentApi(request.postId, null).then((apiResult) => {
        if (apiResult && apiResult.videoUrl) {
          safeSendResponse({ success: true, videoUrl: apiResult.videoUrl });
        } else {
          createNewTab();
        }
      });

      function processTab(tabId, _isNewTab) {
        try {
          let attempts = 0;
          const maxAttempts = 20;

          const checkTab = setInterval(() => {
            try {
              attempts++;
              checkTabExists(tabId, (tabInfo, error) => {
                try {
                  if (error) {
                    clearInterval(checkTab);
                    safeSendResponse({ success: false, error: `Tab error: ${error}` });
                    return;
                  }

                  if (tabInfo.status === 'complete' && attempts >= 5) {
                    clearInterval(checkTab);

                    setTimeout(() => {
                      try {
                        checkTabExists(tabId, (tabInfo, error) => {
                          if (error) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                            safeSendResponse({ success: false, error: `Tab error: ${error}` });
                            return;
                          }

                          if (!tabInfo.url || !tabInfo.url.includes('instagram.com')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                            safeSendResponse({ success: false, error: 'Page redirected' });
                            return;
                          }

                          if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('chrome-error://')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                            safeSendResponse({ success: false, error: 'Page error' });
                            return;
                          }

                          if (tabInfo.url && !tabInfo.url.includes('/p/') && !tabInfo.url.includes('/reel/')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                            safeSendResponse({ success: false, error: `Page redirected to: ${tabInfo.url}` });
                            return;
                          }

                          chrome.scripting.executeScript({
                            target: { tabId: tabId, allFrames: false },
                            func: () => {
                              if (document.readyState !== 'complete') {
                                return { error: 'Page not ready' };
                              }
                              return { ready: true };
                            }
                          }, (testResults) => {
                            if (chrome.runtime.lastError) {
                              if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                              safeSendResponse({ success: false, error: 'Page not accessible' });
                              return;
                            }

                            if (!testResults || !testResults[0] || testResults[0].result?.error) {
                              if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                              safeSendResponse({ success: false, error: 'Page validation failed' });
                              return;
                            }

                            chrome.scripting.executeScript({
                              target: { tabId: tabId, allFrames: false },
                              func: extractFromRenderedPage
                            }, (results) => {
                              try {
                                if (chrome.runtime.lastError) {
                                  if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                                  safeSendResponse({ success: false, error: 'Script error' });
                                  return;
                                }

                                if (!results || !results[0]) {
                                  cleanupListeners();
                                  if (shouldCloseTab) {
                                    setTimeout(() => {
                                      checkTabExists(tabId, (tab, error) => {
                                        if (!error) chrome.tabs.remove(tabId);
                                      });
                                    }, 500);
                                  }
                                  safeSendResponse({ success: false, error: 'No results from script' });
                                  return;
                                }

                                const extracted = results[0].result;
                                cleanupListeners();

                                if (extracted && extracted.videoUrl) {
                                  safeSendResponse({ success: true, videoUrl: extracted.videoUrl });
                                  if (shouldCloseTab) {
                                    setTimeout(() => {
                                      checkTabExists(tabId, (tab, error) => {
                                        if (!error) chrome.tabs.remove(tabId);
                                      });
                                    }, 500);
                                  }
                                } else {
                                  safeSendResponse({ success: false, unavailable: !!extracted?.unavailable, error: extracted?.error || 'Video not found' });
                                  if (shouldCloseTab) {
                                    setTimeout(() => {
                                      checkTabExists(tabId, (tab, error) => {
                                        if (!error) chrome.tabs.remove(tabId);
                                      });
                                    }, 500);
                                  }
                                }
                              } catch (error) {
                                safeSendResponse({ success: false, error: error.message });
                              }
                            });
                          });
                        });
                      } catch (error) {
                        cleanupListeners();
                        if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                        safeSendResponse({ success: false, error: error.message });
                      }
                    }, 3000);
                  }
                } catch (error) {
                  clearInterval(checkTab);
                  cleanupListeners();
                  if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
                  safeSendResponse({ success: false, error: error.message });
                }
              });

              if (attempts >= maxAttempts) {
                clearInterval(checkTab);
                cleanupListeners();
                if (shouldCloseTab) {
                  checkTabExists(tabId, (tab, error) => {
                    if (!error) chrome.tabs.remove(tabId);
                  });
                }
                safeSendResponse({ success: false, error: 'Timeout' });
              }
            } catch (error) {
              clearInterval(checkTab);
              cleanupListeners();
              if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
              safeSendResponse({ success: false, error: error.message });
            }
          }, 500);
        } catch (error) {
          cleanupListeners();
          if (shouldCloseTab) chrome.tabs.remove(tabId, () => { });
          safeSendResponse({ success: false, error: error.message });
        }
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    return true;
  }

  if (request.action === 'FETCH_CAROUSEL_VIDEO') {
    // Fetch video from a carousel post
    try {
      const { permalink, carouselIndex } = request;

      if (!permalink) {
        sendResponse({ success: false, error: 'No permalink provided' });
        return true;
      }

      let responseSent = false;
      const safeSendResponse = (response) => {
        if (!responseSent) {
          responseSent = true;
          sendResponse(response);
        }
      };

      // Try the tab-free API path first (no flashing tabs); fall back to the
      // scrape tab below only if it can't resolve the URL.
      fetchVideoViaContentApi(request.postId, carouselIndex).then((apiResult) => {
        if (apiResult && apiResult.videoUrl) {
          safeSendResponse({ success: true, videoUrl: apiResult.videoUrl });
          return;
        }
        startCarouselScrapeTab();
      });

      function startCarouselScrapeTab() {
      // Create background tab to extract video
        chrome.tabs.create({
          url: permalink,
          active: false,
          pinned: false
        }, (tab) => {
          if (chrome.runtime.lastError) {
            safeSendResponse({ success: false, error: `Failed to create tab: ${chrome.runtime.lastError.message}` });
            return;
          }

          const tabId = tab.id;
          let attempts = 0;
          const maxAttempts = 20;

          // Mute so the reel's audio doesn't leak while we scrape the URL.
          chrome.tabs.update(tabId, { muted: true }, () => {
            if (chrome.runtime.lastError) { /* tab may already be gone */ }
          });

          const checkTab = setInterval(() => {
            attempts++;

            chrome.tabs.get(tabId, (tabInfo) => {
              if (chrome.runtime.lastError) {
                clearInterval(checkTab);
                safeSendResponse({ success: false, error: 'Tab error' });
                return;
              }

              if (tabInfo.status === 'complete' && attempts >= 5) {
                clearInterval(checkTab);

                setTimeout(() => {
                  chrome.scripting.executeScript({
                    target: { tabId: tabId, allFrames: false },
                    func: extractCarouselVideo,
                    args: [carouselIndex]
                  }, (results) => {
                    chrome.tabs.remove(tabId, () => { });

                    if (chrome.runtime.lastError || !results || !results[0]) {
                      safeSendResponse({ success: false, error: 'Script error' });
                      return;
                    }

                    const extracted = results[0].result;
                    if (extracted && extracted.videoUrl) {
                      safeSendResponse({ success: true, videoUrl: extracted.videoUrl });
                    } else {
                      safeSendResponse({ success: false, error: 'Video not found in carousel' });
                    }
                  });
                }, 3000);
              }

              if (attempts >= maxAttempts) {
                clearInterval(checkTab);
                chrome.tabs.remove(tabId, () => { });
                safeSendResponse({ success: false, error: 'Timeout' });
              }
            });
          }, 500);
        });
      } // end startCarouselScrapeTab
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (request.action === 'FETCH_FULL_IMAGE') {
    // Fetch full-resolution image from Instagram post page
    try {
      const { permalink } = request;

      if (!permalink) {
        sendResponse({ success: false, error: 'No permalink provided' });
        return true;
      }

      let responseSent = false;
      const safeSendResponse = (response) => {
        if (!responseSent) {
          responseSent = true;
          sendResponse(response);
        }
      };

      // Create background tab to extract image
      chrome.tabs.create({
        url: permalink,
        active: false,
        pinned: false
      }, (tab) => {
        if (chrome.runtime.lastError) {
          safeSendResponse({ success: false, error: `Failed to create tab: ${chrome.runtime.lastError.message}` });
          return;
        }

        const tabId = tab.id;
        let attempts = 0;
        const maxAttempts = 15;

        const checkTab = setInterval(() => {
          attempts++;

          chrome.tabs.get(tabId, (tabInfo) => {
            if (chrome.runtime.lastError) {
              clearInterval(checkTab);
              safeSendResponse({ success: false, error: 'Tab error' });
              return;
            }

            if (tabInfo.status === 'complete' && attempts >= 3) {
              clearInterval(checkTab);

              setTimeout(() => {
                chrome.scripting.executeScript({
                  target: { tabId: tabId, allFrames: false },
                  func: extractFullResImage
                }, (results) => {
                  // Close the tab
                  chrome.tabs.remove(tabId, () => { });

                  if (chrome.runtime.lastError || !results || !results[0]) {
                    safeSendResponse({ success: false, error: 'Script error' });
                    return;
                  }

                  const extracted = results[0].result;
                  if (extracted && extracted.imageUrl) {
                    safeSendResponse({ success: true, imageUrl: extracted.imageUrl });
                  } else {
                    safeSendResponse({ success: false, error: 'Image not found' });
                  }
                });
              }, 2000);
            }

            if (attempts >= maxAttempts) {
              clearInterval(checkTab);
              chrome.tabs.remove(tabId, () => { });
              safeSendResponse({ success: false, error: 'Timeout' });
            }
          });
        }, 500);
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (request.action === 'CLEAR_STORAGE') {
    Promise.all([
      new Promise((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onblocked = () => {
          setTimeout(() => {
            const retryRequest = indexedDB.deleteDatabase(DB_NAME);
            retryRequest.onsuccess = () => resolve();
            retryRequest.onerror = () => reject(retryRequest.error);
          }, 1000);
        };
      }),
      new Promise((resolve) => {
        chrome.storage.local.clear(() => resolve());
      })
    ]).then(() => {
      updateExtensionTab();
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Error clearing storage:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'CLEAR_ALL_POSTS') {
    clearAllPosts().then(() => {
      updateExtensionTab();
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Error clearing posts:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'DELETE_SINGLE_POST') {
    deleteSinglePost(request.postId).then(() => {
      updateExtensionTab();
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Error deleting post:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'SET_POST_UNAVAILABLE') {
    setPostUnavailable(request.postId, request.unavailable !== false).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Error flagging post:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'CHECK_POST_EXISTS') {
    // Quick check if a post exists by ID or link
    checkPostExists(request.postId, request.link).then((exists) => {
      sendResponse({ exists });
    }).catch(() => {
      sendResponse({ exists: false });
    });
    return true;
  }

  if (request.action === 'GET_DB_BOUNDS') {
    getDbBounds().then((bounds) => {
      sendResponse(bounds);
    }).catch((error) => {
      console.error('Error getting DB bounds:', error);
      // Signal the failure explicitly: {min:null,max:null} is also what a
      // genuinely empty DB returns, and the sync must tell those apart or it
      // re-downloads the whole library from scratch.
      sendResponse({ min: null, max: null, error: error.message || 'bounds unavailable' });
    });
    return true;
  }

  if (request.action === 'EXPORT_DATA') {
    exportAllData().then((data) => {
      sendResponse({ success: true, data });
    }).catch((error) => {
      console.error('Error exporting data:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'IMPORT_DATA') {
    importAllData(request.data).then((result) => {
      updateExtensionTab();
      sendResponse({ success: true, ...result });
    }).catch((error) => {
      console.error('Error importing data:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  return false;
});

// IndexedDB configuration
const DB_NAME = 'instagram_media_db';
const DB_VERSION = 4; // Increment for new schema - added savedOrder and takenAt indexes
const STORE_MEDIA = 'media';
const STORE_POSTS = 'posts';
const STORE_POSTS_INDEX = 'posts_index'; // New index store
const STORE_COLLECTIONS = 'collections';
const STORE_METADATA = 'metadata'; // New metadata store

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create media store
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA);
      }

      // Create posts store with keyPath
      if (!db.objectStoreNames.contains(STORE_POSTS)) {
        const postsStore = db.createObjectStore(STORE_POSTS, { keyPath: 'id' });
        postsStore.createIndex('timestamp', 'timestamp', { unique: false });
        postsStore.createIndex('link', 'link', { unique: false });
        postsStore.createIndex('username', 'username', { unique: false });
        postsStore.createIndex('title', 'title', { unique: false });
        postsStore.createIndex('isVideo', 'isVideo', { unique: false });
        postsStore.createIndex('savedOrder', 'savedOrder', { unique: false });
        postsStore.createIndex('takenAt', 'takenAt', { unique: false });
      } else {
        // Add new indexes if store already exists
        const postsStore = event.target.transaction.objectStore(STORE_POSTS);
        if (!postsStore.indexNames.contains('savedOrder')) {
          postsStore.createIndex('savedOrder', 'savedOrder', { unique: false });
        }
        if (!postsStore.indexNames.contains('takenAt')) {
          postsStore.createIndex('takenAt', 'takenAt', { unique: false });
        }
        if (!postsStore.indexNames.contains('title')) {
          postsStore.createIndex('title', 'title', { unique: false });
        }
      }

      // Create posts index store for quick lookups
      if (!db.objectStoreNames.contains(STORE_POSTS_INDEX)) {
        db.createObjectStore(STORE_POSTS_INDEX);
      }

      // Create collections store
      if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
        db.createObjectStore(STORE_COLLECTIONS);
      }

      // Create metadata store for counts and other stats
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA);
      }
    };
  });
}

// Add posts with efficient duplicate checking using direct store lookups
async function addPostsToIndexedDB(posts) {
  let db;
  try {
    db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS, STORE_METADATA], 'readwrite');
      const postsStore = transaction.objectStore(STORE_POSTS);
      const metaStore = transaction.objectStore(STORE_METADATA);

      let addedCount = 0;
      let processedCount = 0;
      const totalPosts = posts.length;

      if (totalPosts === 0) {
        db.close();
        resolve(0);
        return;
      }

      // Process each post using direct lookups (more efficient than loading all IDs)
      posts.forEach((post) => {
        // Try to get existing post by ID first (primary key lookup - O(1))
        const getRequest = postsStore.get(post.id);

        getRequest.onsuccess = () => {
          const existingPost = getRequest.result;

          if (existingPost) {
            // Post exists by ID - preserve original timestamp and savedOrder
            if (existingPost.timestamp) {
              post.timestamp = existingPost.timestamp;
            }
            if (existingPost.savedOrder !== undefined) {
              post.savedOrder = existingPost.savedOrder;
            }
            // Update existing post
            postsStore.put(post);
            processedCount++;
            checkComplete();
          } else if (post.link) {
            // Check by link index if ID not found
            const linkIndex = postsStore.index('link');
            const linkRequest = linkIndex.get(post.link);

            linkRequest.onsuccess = () => {
              const existingByLink = linkRequest.result;
              if (existingByLink) {
                // Post exists by link - preserve timestamp and savedOrder
                if (existingByLink.timestamp) {
                  post.timestamp = existingByLink.timestamp;
                }
                if (existingByLink.savedOrder !== undefined) {
                  post.savedOrder = existingByLink.savedOrder;
                }
                postsStore.put(post);
              } else {
                // New post
                postsStore.put(post);
                addedCount++;
              }
              processedCount++;
              checkComplete();
            };

            linkRequest.onerror = () => {
              // On error, try to add anyway
              postsStore.put(post);
              addedCount++;
              processedCount++;
              checkComplete();
            };
          } else {
            // No link and no existing ID - add as new
            postsStore.put(post);
            addedCount++;
            processedCount++;
            checkComplete();
          }
        };

        getRequest.onerror = () => {
          // On error, try to add anyway
          postsStore.put(post);
          addedCount++;
          processedCount++;
          checkComplete();
        };
      });

      function checkComplete() {
        if (processedCount === totalPosts) {
          // Update count efficiently using store.count()
          const countRequest = postsStore.count();
          countRequest.onsuccess = () => {
            metaStore.put(countRequest.result, 'posts_count');
          };
        }
      }

      transaction.oncomplete = () => {
        db.close();
        resolve(addedCount);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    if (db) db.close();
    throw error;
  }
}

// Get posts count from metadata (O(1))
async function getPostsCount() {
  let db;
  let metaCount;
  try {
    db = await openDB();
    metaCount = await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_METADATA], 'readonly');
      const store = transaction.objectStore(STORE_METADATA);
      const request = store.get('posts_count');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('metadata read failed'));
    });
    db.close();
    db = null;
  } catch (error) {
    if (db) db.close();
    // Metadata unreadable: fall through to the direct count below rather than
    // failing outright.
    metaCount = undefined;
  }

  if (typeof metaCount === 'number' && metaCount > 0) {
    return metaCount;
  }

  // Metadata says 0 or is missing. That can be a stale/corrupted cache (e.g.
  // left behind by an interrupted sync), and trusting it made the sync treat a
  // full library as empty and re-download everything. Verify against the posts
  // store itself and repair the cache when they disagree.
  const directCount = await countPostsDirectly();
  if (directCount > 0) {
    try {
      await setPostsCountMetadata(directCount);
      console.warn(`Repaired stale posts_count metadata: ${metaCount} -> ${directCount}`);
    } catch (e) { /* repair is best-effort; the returned count is still right */ }
  }
  return directCount;
}

// Write the posts_count metadata cache (used to repair a stale value).
async function setPostsCountMetadata(count) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_METADATA], 'readwrite');
    transaction.objectStore(STORE_METADATA).put(count, 'posts_count');
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

// Fallback count method. Rejects when the store can't be read -- callers must
// not mistake "unreadable" for "empty" (that's what caused full re-syncs).
async function countPostsDirectly() {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS], 'readonly');
      const store = transaction.objectStore(STORE_POSTS);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        db.close();
        resolve(countRequest.result);
      };
      countRequest.onerror = () => {
        db.close();
        reject(countRequest.error || new Error('posts count failed'));
      };
    });
  } catch (error) {
    if (db) db.close();
    throw error;
  }
}



// Batch existence check on a single DB connection/transaction. The previous
// implementation opened one connection per post (21+ parallel opens per feed
// page), which was slow and failure-prone on large libraries; any failure was
// then misreported as "not saved". Rejects on error so callers can retry.
async function checkPostsBatchExists(postIds, links) {
  if (!postIds || postIds.length === 0) return [];

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_POSTS], 'readonly');
    const store = transaction.objectStore(STORE_POSTS);
    const linkIndex = store.index('link');
    const results = new Array(postIds.length).fill(false);
    let pending = postIds.length;
    let failed = false;

    const settleOne = () => {
      pending--;
      if (pending === 0 && !failed) {
        db.close();
        resolve(results);
      }
    };

    const fail = (error) => {
      if (failed) return;
      failed = true;
      db.close();
      reject(error || new Error('existence lookup failed'));
    };

    postIds.forEach((postId, i) => {
      const checkByLink = () => {
        const link = links[i];
        if (!link) {
          settleOne();
          return;
        }
        const linkRequest = linkIndex.get(link);
        linkRequest.onsuccess = () => {
          results[i] = !!linkRequest.result;
          settleOne();
        };
        linkRequest.onerror = () => fail(linkRequest.error);
      };

      if (postId) {
        const getRequest = store.get(postId);
        getRequest.onsuccess = () => {
          if (getRequest.result) {
            results[i] = true;
            settleOne();
          } else {
            checkByLink();
          }
        };
        getRequest.onerror = () => fail(getRequest.error);
      } else {
        checkByLink();
      }
    });
  });
}

// Check if a post exists using direct store lookups
async function checkPostExists(postId, link) {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_POSTS], 'readonly');
      const store = transaction.objectStore(STORE_POSTS);

      // Check by ID first (O(1) primary key lookup)
      if (postId) {
        const getRequest = store.get(postId);
        getRequest.onsuccess = () => {
          if (getRequest.result) {
            db.close();
            resolve(true);
            return;
          }

          // ID not found, check by link if provided
          if (link) {
            const linkIndex = store.index('link');
            const linkRequest = linkIndex.get(link);
            linkRequest.onsuccess = () => {
              db.close();
              resolve(!!linkRequest.result);
            };
            linkRequest.onerror = () => {
              db.close();
              resolve(false);
            };
          } else {
            db.close();
            resolve(false);
          }
        };
        getRequest.onerror = () => {
          db.close();
          resolve(false);
        };
      } else if (link) {
        // No ID, check by link
        const linkIndex = store.index('link');
        const linkRequest = linkIndex.get(link);
        linkRequest.onsuccess = () => {
          db.close();
          resolve(!!linkRequest.result);
        };
        linkRequest.onerror = () => {
          db.close();
          resolve(false);
        };
      } else {
        db.close();
        resolve(false);
      }
    });
  } catch (error) {
    if (db) db.close();
    return false;
  }
}

// Get min and max savedOrder from DB
async function getDbBounds() {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_POSTS], 'readonly');
      const store = transaction.objectStore(STORE_POSTS);
      const index = store.index('savedOrder');

      let minOrder = null;
      let maxOrder = null;

      // Get min
      const minRequest = index.openCursor(null, 'next');
      minRequest.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          minOrder = cursor.value.savedOrder;
        }

        // Get max
        const maxRequest = index.openCursor(null, 'prev');
        maxRequest.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            maxOrder = cursor.value.savedOrder;
          }

          db.close();
          resolve({ min: minOrder, max: maxOrder });
        };
        maxRequest.onerror = () => {
          db.close();
          resolve({ min: minOrder, max: null });
        };
      };
      minRequest.onerror = () => {
        db.close();
        resolve({ min: null, max: null });
      };
    });
  } catch (error) {
    if (db) db.close();
    return { min: null, max: null };
  }
}

function stableHashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function comparePostsForStableRandom(a, b, randomSeed) {
  const seed = Number.isFinite(randomSeed) ? Math.trunc(randomSeed) : 0;
  const aIdentity = a.id || a.link || a.username || a.title || '';
  const bIdentity = b.id || b.link || b.username || b.title || '';
  const aWeight = stableHashString(`${seed}:${aIdentity}`);
  const bWeight = stableHashString(`${seed}:${bIdentity}`);

  if (aWeight !== bWeight) {
    return aWeight - bWeight;
  }

  const fallbackA = `${aIdentity}:${a.timestamp || 0}`;
  const fallbackB = `${bIdentity}:${b.timestamp || 0}`;
  return fallbackA.localeCompare(fallbackB);
}

// Get posts with pagination, sorting, and filtering
async function getPostsPaginated(page = 1, limit = 50, sortBy = 'newest-saved', filterType = 'all', searchQuery = '', hashtagFilter = null, randomSeed = null) {
  let db;
  try {
    db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS], 'readonly');
      const store = transaction.objectStore(STORE_POSTS);

      // Helper to extract hashtags from text
      const extractHashtags = (text) => {
        if (!text || typeof text !== 'string') return [];
        const hashtagRegex = /#[\w]+/g;
        const matches = text.match(hashtagRegex);
        return matches ? matches.map(tag => tag.toLowerCase()) : [];
      };

      // Helper to check if post matches filters
      const matchesFilters = (post) => {
        // Apply type filter
        if (filterType === 'photo' && post.isVideo) return false;
        if (filterType === 'video' && !post.isVideo) return false;

        // Apply search filter
        if (searchQuery) {
          const searchLower = searchQuery.toLowerCase();
          const titleMatch = (post.title || '').toLowerCase().includes(searchLower);
          const usernameMatch = (post.username || '').toLowerCase().includes(searchLower);
          if (!titleMatch && !usernameMatch) return false;
        }

        // Apply hashtag filter
        if (hashtagFilter) {
          const caption = post.title || '';
          const hashtags = extractHashtags(caption);
          if (!hashtags.includes(hashtagFilter.toLowerCase())) return false;
        }

        return true;
      };

      // For saved-order-based sorts (newest/oldest saved), use savedOrder index
      // API returns newest first, so lower savedOrder = newer
      const useSavedOrderIndex = (sortBy === 'newest-saved' || sortBy === 'newest' ||
        sortBy === 'oldest-saved' || sortBy === 'oldest') &&
        !searchQuery && !hashtagFilter && filterType === 'all';

      // For posted-date-based sorts, use takenAt index
      const useTakenAtIndex = (sortBy === 'newest-posted' || sortBy === 'oldest-posted') &&
        !searchQuery && !hashtagFilter && filterType === 'all';

      if (useSavedOrderIndex) {
        // Fast path: use savedOrder index with cursor advancement for true pagination
        const index = store.index('savedOrder');
        // For newest saved: descending (higher savedOrder = newer)
        // For oldest saved: ascending (lower savedOrder = older)
        const direction = (sortBy === 'newest-saved' || sortBy === 'newest') ? 'prev' : 'next';

        // Get total count first (O(1) operation)
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          const total = countRequest.result;
          const startIdx = (page - 1) * limit;

          // If start is beyond total, return empty
          if (startIdx >= total) {
            db.close();
            resolve({ posts: [], total, hasMore: false, page });
            return;
          }

          const paginatedPosts = [];
          let skipped = false;
          let collected = 0;

          const cursorRequest = index.openCursor(null, direction);

          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
              // No more results
              db.close();
              resolve({
                posts: paginatedPosts,
                total,
                hasMore: startIdx + collected < total,
                page
              });
              return;
            }

            // Skip to start position on first iteration
            if (!skipped && startIdx > 0) {
              skipped = true;
              cursor.advance(startIdx);
              return;
            }

            // Collect posts up to limit
            if (collected < limit) {
              paginatedPosts.push(cursor.value);
              collected++;
              cursor.continue();
            } else {
              // We have enough posts
              db.close();
              resolve({
                posts: paginatedPosts,
                total,
                hasMore: startIdx + collected < total,
                page
              });
            }
          };

          cursorRequest.onerror = () => {
            db.close();
            reject(cursorRequest.error);
          };
        };

        countRequest.onerror = () => {
          db.close();
          reject(countRequest.error);
        };
      } else if (useTakenAtIndex) {
        // Fast path: use takenAt index with cursor advancement for true pagination
        const index = store.index('takenAt');
        const direction = (sortBy === 'newest-posted') ? 'prev' : 'next';

        // Get total count first (O(1) operation)
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          const total = countRequest.result;
          const startIdx = (page - 1) * limit;

          // If start is beyond total, return empty
          if (startIdx >= total) {
            db.close();
            resolve({ posts: [], total, hasMore: false, page });
            return;
          }

          const paginatedPosts = [];
          let skipped = false;
          let collected = 0;

          const cursorRequest = index.openCursor(null, direction);

          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
              // No more results
              db.close();
              resolve({
                posts: paginatedPosts,
                total,
                hasMore: startIdx + collected < total,
                page
              });
              return;
            }

            // Skip to start position on first iteration
            if (!skipped && startIdx > 0) {
              skipped = true;
              cursor.advance(startIdx);
              return;
            }

            // Collect posts up to limit
            if (collected < limit) {
              paginatedPosts.push(cursor.value);
              collected++;
              cursor.continue();
            } else {
              // We have enough posts
              db.close();
              resolve({
                posts: paginatedPosts,
                total,
                hasMore: startIdx + collected < total,
                page
              });
            }
          };

          cursorRequest.onerror = () => {
            db.close();
            reject(cursorRequest.error);
          };
        };

        countRequest.onerror = () => {
          db.close();
          reject(countRequest.error);
        };
      } else {
        // Filtered / complex path.
        // IMPORTANT: Pagination must be based on the globally sorted filtered set.
        // The previous implementation only sorted the page slice, which could return
        // incorrect results for many sort modes.

        const targetStart = (page - 1) * limit;
        const targetEndExclusive = targetStart + limit;

        const isSavedOrderSort = (sortBy === 'newest-saved' || sortBy === 'newest' || sortBy === 'oldest-saved' || sortBy === 'oldest');
        const isTakenAtSort = (sortBy === 'newest-posted' || sortBy === 'oldest-posted');
        const isAlphabeticalSort = (sortBy === 'alphabetical');
        const isRandomSort = (sortBy === 'random');

        // If the sort can be streamed in the desired order, we can avoid buffering
        // all matches (still need to scan to compute total).
        const canStreamSorted = isSavedOrderSort || isTakenAtSort;

        let totalMatched = 0;
        const pagePosts = [];
        const allMatchedPosts = (canStreamSorted ? null : []);

        let cursorRequest;
        if (isSavedOrderSort) {
          const index = store.index('savedOrder');
          const direction = (sortBy === 'newest-saved' || sortBy === 'newest') ? 'prev' : 'next';
          cursorRequest = index.openCursor(null, direction);
        } else if (isTakenAtSort) {
          const index = store.index('takenAt');
          const direction = (sortBy === 'newest-posted') ? 'prev' : 'next';
          cursorRequest = index.openCursor(null, direction);
        } else {
          cursorRequest = store.openCursor();
        }

        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) {
            // End of scan
            if (canStreamSorted) {
              db.close();
              resolve({
                posts: pagePosts,
                total: totalMatched,
                hasMore: totalMatched > targetEndExclusive,
                page
              });
              return;
            }

            // Need to sort/shuffle the full filtered set, then slice the page.
            const sorted = allMatchedPosts || [];
            if (isAlphabeticalSort) {
              sorted.sort((a, b) => {
                const usernameA = (a.username || '').toLowerCase();
                const usernameB = (b.username || '').toLowerCase();
                if (usernameA !== usernameB) {
                  return usernameA.localeCompare(usernameB);
                }
                const titleA = (a.title || '').toLowerCase();
                const titleB = (b.title || '').toLowerCase();
                return titleA.localeCompare(titleB);
              });
            } else if (isRandomSort) {
              sorted.sort((a, b) => comparePostsForStableRandom(a, b, randomSeed));
            } else {
              // Default fallback: timestamp descending
              sorted.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }

            // Re-fetch the full records for just the current page (sorted holds
            // lightweight projections, not the stored thumbnails).
            const pageKeys = sorted.slice(targetStart, targetEndExclusive).map((entry) => entry.id);
            const totalSorted = sorted.length;

            if (pageKeys.length === 0) {
              db.close();
              resolve({
                posts: [],
                total: totalSorted,
                hasMore: totalSorted > targetEndExclusive,
                page
              });
              return;
            }

            const pageRecords = new Array(pageKeys.length);
            let fetched = 0;
            let settled = false;

            const finishPageFetch = () => {
              if (settled) return;
              settled = true;
              db.close();
              resolve({
                posts: pageRecords.filter(Boolean),
                total: totalSorted,
                hasMore: totalSorted > targetEndExclusive,
                page
              });
            };

            pageKeys.forEach((key, idx) => {
              const getReq = store.get(key);
              getReq.onsuccess = () => {
                pageRecords[idx] = getReq.result;
                fetched++;
                if (fetched === pageKeys.length) finishPageFetch();
              };
              getReq.onerror = () => {
                fetched++;
                if (fetched === pageKeys.length) finishPageFetch();
              };
            });
            return;
          }

          const post = cursor.value;
          if (matchesFilters(post)) {
            if (canStreamSorted) {
              const matchIndex = totalMatched;
              if (matchIndex >= targetStart && matchIndex < targetEndExclusive) {
                pagePosts.push(post);
              }
              totalMatched++;
            } else {
              // Buffer only the fields needed for sorting (plus the primary key
              // for re-fetch). Avoids holding every post's base64 thumbnail in
              // memory while sorting large filtered sets.
              allMatchedPosts.push({
                id: post.id,
                link: post.link,
                username: post.username,
                title: post.title,
                timestamp: post.timestamp
              });
              totalMatched++;
            }
          }

          cursor.continue();
        };

        cursorRequest.onerror = () => {
          db.close();
          reject(cursorRequest.error);
        };
      }
    });
  } catch (error) {
    if (db) db.close();
    throw error;
  }
}

async function storeMediaInIndexedDB(key, blob) {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MEDIA], 'readwrite');
      const store = transaction.objectStore(STORE_MEDIA);
      const request = store.put(blob, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    if (db) db.close();
    throw error;
  }
}

// Store several media blobs in a single transaction (used for thumbnail batches).
async function storeMediaBatch(entries) {
  if (!entries || entries.length === 0) return;
  let db;
  try {
    db = await openDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MEDIA], 'readwrite');
      const store = transaction.objectStore(STORE_MEDIA);
      entries.forEach(({ key, blob }) => store.put(blob, key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    if (db) db.close();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

// Convert inline base64 thumbnails to binary blobs stored under `thumb_<id>`,
// replacing the inline data URL with a `thumbnailKey` reference. On any failure
// the inline base64 is left intact as a fallback (so the post still renders).
async function migrateThumbnailsToBlobs(posts) {
  const entries = [];
  for (const post of posts) {
    if (post && typeof post.thumbnail === 'string' && post.thumbnail.startsWith('data:')) {
      try {
        const blob = await dataUrlToBlob(post.thumbnail);
        if (blob && blob.size > 0) {
          const key = `thumb_${post.id}`;
          entries.push({ key, blob });
          post.thumbnailKey = key;
          delete post.thumbnail;
        }
      } catch (error) {
        // Keep the inline base64 as a fallback.
      }
    }
  }
  if (entries.length > 0) {
    await storeMediaBatch(entries);
  }
}

// Read stored thumbnail blobs for a page of posts and attach them as data URLs.
// Posts that already carry an inline thumbnail (legacy records) are left as-is.
async function hydrateThumbnails(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return posts;
  const needing = posts.filter((p) => p && !p.thumbnail && p.thumbnailKey);
  if (needing.length === 0) return posts;

  let db;
  try {
    db = await openDB();
    const blobsByKey = await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MEDIA], 'readonly');
      const store = transaction.objectStore(STORE_MEDIA);
      const map = new Map();
      needing.forEach((p) => {
        const req = store.get(p.thumbnailKey);
        req.onsuccess = () => {
          if (req.result) map.set(p.thumbnailKey, req.result);
        };
        req.onerror = () => { /* missing blob -> placeholder */ };
      });
      transaction.oncomplete = () => resolve(map);
      transaction.onerror = () => reject(transaction.error);
    });

    await Promise.all(needing.map(async (p) => {
      const blob = blobsByKey.get(p.thumbnailKey);
      if (blob) {
        try {
          p.thumbnail = await blobToDataUrl(blob);
        } catch (error) {
          // Leave without a thumbnail; the viewer shows a placeholder.
        }
      }
    }));
  } catch (error) {
    console.error('Error hydrating thumbnails:', error);
  } finally {
    if (db) db.close();
  }

  return posts;
}

async function storeCollectionsInIndexedDB(collections) {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_COLLECTIONS], 'readwrite');
      const store = transaction.objectStore(STORE_COLLECTIONS);
      const request = store.put(collections, 'all_collections');

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    if (db) db.close();
    throw error;
  }
}

async function getCollectionsFromIndexedDB() {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_COLLECTIONS], 'readonly');
      const store = transaction.objectStore(STORE_COLLECTIONS);
      const request = store.get('all_collections');

      request.onsuccess = () => {
        const collections = request.result || [];
        db.close();
        resolve(collections);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    if (db) db.close();
    return [];
  }
}

// eslint-disable-next-line no-unused-vars
async function _getMediaFromIndexedDB(key) {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_MEDIA], 'readonly');
      const store = transaction.objectStore(STORE_MEDIA);
      const request = store.get(key);

      request.onsuccess = () => {
        const blob = request.result;
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => {
            db.close();
            resolve(reader.result);
          };
          reader.onerror = () => {
            db.close();
            resolve(null);
          };
          reader.readAsDataURL(blob);
        } else {
          db.close();
          resolve(null);
        }
      };
      request.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch (error) {
    if (db) db.close();
    return null;
  }
}

let hashtagCacheRebuildScheduled = false;
let hashtagCacheRebuildInProgress = false;

async function rebuildHashtagCache(expectedCount = null) {
  let db;
  try {
    db = await openDB();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS, STORE_METADATA], 'readwrite');
      const postsStore = transaction.objectStore(STORE_POSTS);
      const metadataStore = transaction.objectStore(STORE_METADATA);
      const hashtagCounts = new Map();
      const cursorRequest = postsStore.openCursor();
      let resolvedCount = Number.isFinite(expectedCount);
      let currentCount = Number.isFinite(expectedCount) ? expectedCount : 0;

      if (!resolvedCount) {
        const countRequest = postsStore.count();
        countRequest.onsuccess = () => {
          currentCount = countRequest.result;
          resolvedCount = true;
        };
        countRequest.onerror = () => {
          currentCount = 0;
          resolvedCount = true;
        };
      }

      const extractHashtags = (text) => {
        if (!text || typeof text !== 'string') return [];
        const hashtagRegex = /#[\w]+/g;
        const matches = text.match(hashtagRegex);
        return matches ? matches.map(tag => tag.toLowerCase()) : [];
      };

      const finalize = () => {
        const hashtags = Array.from(hashtagCounts.entries())
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count);

        metadataStore.put({ count: currentCount, hashtags }, 'hashtags_cache');
        resolve(hashtags);
      };

      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          if (resolvedCount) {
            finalize();
          } else {
            setTimeout(finalize, 0);
          }
          return;
        }

        const post = cursor.value;
        if (post && post.title) {
          extractHashtags(post.title).forEach(tag => {
            if (tag) {
              hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
            }
          });
        }

        cursor.continue();
      };

      cursorRequest.onerror = () => {
        reject(cursorRequest.error || new Error('Cursor error'));
      };

      transaction.oncomplete = () => {
        db.close();
      };

      transaction.onerror = () => {
        reject(transaction.error || new Error('Transaction error'));
      };
    });
  } catch (error) {
    if (db) db.close();
    throw error;
  }
}

function scheduleHashtagCacheRebuild(expectedCount = null) {
  if (hashtagCacheRebuildScheduled || hashtagCacheRebuildInProgress) {
    return;
  }

  hashtagCacheRebuildScheduled = true;

  setTimeout(async () => {
    hashtagCacheRebuildScheduled = false;
    if (hashtagCacheRebuildInProgress) {
      return;
    }

    hashtagCacheRebuildInProgress = true;
    try {
      await rebuildHashtagCache(expectedCount);
    } catch (error) {
      console.error('Background hashtag cache rebuild failed:', error);
    } finally {
      hashtagCacheRebuildInProgress = false;
    }
  }, 750);
}

// Get all hashtags with counts from all posts (with caching)
async function getAllHashtagsWithCounts() {
  let db;
  try {
    db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS, STORE_METADATA], 'readonly');
      const store = transaction.objectStore(STORE_POSTS);
      const metaStore = transaction.objectStore(STORE_METADATA);
      const cacheRequest = metaStore.get('hashtags_cache');
      const countRequest = store.count();

      let currentCount = 0;
      let cacheData = null;

      countRequest.onsuccess = () => {
        currentCount = countRequest.result;
      };

      cacheRequest.onsuccess = () => {
        cacheData = cacheRequest.result;

        transaction.oncomplete = () => {
          if (cacheData && cacheData.count === currentCount && cacheData.hashtags) {
            db.close();
            resolve(cacheData.hashtags);
            return;
          }

          if (cacheData && typeof activeInstagramTabId !== 'undefined' && activeInstagramTabId) {
            db.close();
            scheduleHashtagCacheRebuild(currentCount);
            resolve(cacheData.hashtags || []);
            return;
          }

          rebuildHashtagCache(currentCount).then(resolve).catch(reject);
        };
      };

      cacheRequest.onerror = () => {
        transaction.oncomplete = () => {
          rebuildHashtagCache(currentCount).then(resolve).catch(reject);
        };
      };

      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('Transaction error'));
      };
    });
  } catch (error) {
    if (db) db.close();
    console.error('Error in getAllHashtagsWithCounts:', error);
    return Promise.resolve([]);
  }
}

// Overwrite savedOrder for existing posts (used by the "Rebuild saved order"
// tool). Matches by id, then by link; never re-downloads thumbnails.
async function updatePostsSavedOrder(updates) {
  if (!updates || updates.length === 0) return 0;
  let db;
  try {
    db = await openDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS], 'readwrite');
      const store = transaction.objectStore(STORE_POSTS);
      const linkIndex = store.index('link');
      let updated = 0;

      updates.forEach((update) => {
        if (!update || update.savedOrder === undefined) return;
        const getRequest = store.get(update.id);
        getRequest.onsuccess = () => {
          const post = getRequest.result;
          if (post) {
            post.savedOrder = update.savedOrder;
            store.put(post);
            updated++;
          } else if (update.link) {
            const linkRequest = linkIndex.get(update.link);
            linkRequest.onsuccess = () => {
              const byLink = linkRequest.result;
              if (byLink) {
                byLink.savedOrder = update.savedOrder;
                store.put(byLink);
                updated++;
              }
            };
            linkRequest.onerror = () => { /* skip */ };
          }
        };
        getRequest.onerror = () => { /* skip */ };
      });

      transaction.oncomplete = () => {
        db.close();
        resolve(updated);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    if (db) db.close();
    throw error;
  }
}

// Clear all posts and related data
async function clearAllPosts() {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        [STORE_POSTS, STORE_POSTS_INDEX, STORE_METADATA, STORE_MEDIA],
        'readwrite'
      );

      // Clear posts
      const postsStore = transaction.objectStore(STORE_POSTS);
      postsStore.clear();

      // Clear posts index
      const indexStore = transaction.objectStore(STORE_POSTS_INDEX);
      indexStore.clear();

      // Reset metadata
      const metaStore = transaction.objectStore(STORE_METADATA);
      metaStore.put(0, 'posts_count');

      // Clear media (thumbnails)
      const mediaStore = transaction.objectStore(STORE_MEDIA);
      mediaStore.clear();

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    if (db) db.close();
    throw error;
  }
}

const BACKUP_FORMAT_VERSION = 1;

// Bundle posts, collections, metadata, and media (thumbnails/videos) into a single
// JSON-serializable snapshot. Blobs are inlined as data URLs so the whole backup
// is one portable file.
async function exportAllData() {
  let db;
  try {
    db = await openDB();

    const posts = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_POSTS], 'readonly');
      const request = tx.objectStore(STORE_POSTS).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    const collections = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_COLLECTIONS], 'readonly');
      const request = tx.objectStore(STORE_COLLECTIONS).get('all_collections');
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    const metadata = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_METADATA], 'readonly');
      const store = tx.objectStore(STORE_METADATA);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      tx.oncomplete = () => resolve(keysRequest.result.map((key, i) => ({ key, value: valuesRequest.result[i] })));
      tx.onerror = () => reject(tx.error);
    });

    const mediaEntries = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MEDIA], 'readonly');
      const store = tx.objectStore(STORE_MEDIA);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      tx.oncomplete = () => resolve(keysRequest.result.map((key, i) => ({ key, blob: valuesRequest.result[i] })));
      tx.onerror = () => reject(tx.error);
    });

    // Converting thousands of thumbnail blobs is the slow part of an export;
    // stream progress so the button isn't frozen with no feedback.
    const totalMedia = mediaEntries.length;
    let doneMedia = 0;
    let lastProgressAt = 0;
    const media = await Promise.all(mediaEntries.map(async ({ key, blob }) => {
      const dataUrl = await blobToDataUrl(blob);
      doneMedia++;
      const now = Date.now();
      if (now - lastProgressAt > 300 || doneMedia === totalMedia) {
        lastProgressAt = now;
        safeBroadcast({ action: 'BACKUP_PROGRESS', phase: 'export', done: doneMedia, total: totalMedia });
      }
      return { key, dataUrl };
    }));

    return {
      version: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      posts,
      collections,
      metadata,
      media
    };
  } finally {
    if (db) db.close();
  }
}

// Restore a snapshot produced by exportAllData(). Posts and media are upserted
// by key (so importing into a non-empty library merges rather than duplicates);
// collections and metadata are replaced wholesale.
async function importAllData(data) {
  if (!data || !Array.isArray(data.posts)) {
    throw new Error('Invalid backup file');
  }

  let db;
  try {
    db = await openDB();

    const totalMedia = (data.media || []).length;
    let doneMedia = 0;
    let lastProgressAt = 0;
    const mediaBlobs = await Promise.all((data.media || []).map(async ({ key, dataUrl }) => {
      const blob = await dataUrlToBlob(dataUrl);
      doneMedia++;
      const now = Date.now();
      if (now - lastProgressAt > 300 || doneMedia === totalMedia) {
        lastProgressAt = now;
        safeBroadcast({ action: 'BACKUP_PROGRESS', phase: 'import', done: doneMedia, total: totalMedia });
      }
      return { key, blob };
    }));

    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_POSTS, STORE_COLLECTIONS, STORE_METADATA, STORE_MEDIA], 'readwrite');

      const postsStore = tx.objectStore(STORE_POSTS);
      data.posts.forEach((post) => postsStore.put(post));

      if (data.collections) {
        tx.objectStore(STORE_COLLECTIONS).put(data.collections, 'all_collections');
      }

      const metaStore = tx.objectStore(STORE_METADATA);
      (data.metadata || []).forEach(({ key, value }) => metaStore.put(value, key));

      const mediaStore = tx.objectStore(STORE_MEDIA);
      mediaBlobs.forEach(({ key, blob }) => mediaStore.put(blob, key));

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const postsCount = await countPostsDirectly();

    // countPostsDirectly() may reflect posts merged in from an existing library, so
    // the imported metadata's posts_count (a snapshot from the source instance) is stale.
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_METADATA], 'readwrite');
      tx.objectStore(STORE_METADATA).put(postsCount, 'posts_count');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    scheduleHashtagCacheRebuild(postsCount);

    return { importedPosts: data.posts.length, totalPosts: postsCount };
  } finally {
    if (db) db.close();
  }
}

// Remove a single post (and its stored thumbnail) from the DB and keep the
// cached posts_count in step. Used by the "Remove from library" action for
// posts that Instagram has deleted.
async function deleteSinglePost(postId) {
  if (!postId) throw new Error('Missing postId');
  let db;
  try {
    db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_POSTS, STORE_MEDIA, STORE_METADATA], 'readwrite');
      const postsStore = tx.objectStore(STORE_POSTS);

      const getReq = postsStore.get(postId);
      getReq.onsuccess = () => {
        const post = getReq.result;
        if (post) {
          postsStore.delete(postId);
          const thumbKey = post.thumbnailKey || `thumb_${postId}`;
          tx.objectStore(STORE_MEDIA).delete(thumbKey);

          const metaStore = tx.objectStore(STORE_METADATA);
          const countReq = metaStore.get('posts_count');
          countReq.onsuccess = () => {
            const current = countReq.result;
            if (typeof current === 'number' && current > 0) {
              metaStore.put(current - 1, 'posts_count');
            }
          };
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    scheduleHashtagCacheRebuild();
  } finally {
    if (db) db.close();
  }
}

// Set/clear an `unavailable` flag on a post so the grid can dim it. Reversible:
// a later successful load clears it.
async function setPostUnavailable(postId, unavailable) {
  if (!postId) throw new Error('Missing postId');
  let db;
  try {
    db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_POSTS], 'readwrite');
      const store = tx.objectStore(STORE_POSTS);
      const getReq = store.get(postId);
      getReq.onsuccess = () => {
        const post = getReq.result;
        if (post && !!post.unavailable !== unavailable) {
          if (unavailable) {
            post.unavailable = true;
          } else {
            delete post.unavailable;
          }
          store.put(post);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    if (db) db.close();
  }
}

// Extract video from carousel at specific index
function extractCarouselVideo(carouselIndex) {
  try {
    // Instagram carousels have navigation buttons and multiple media items
    // First, try to navigate to the correct item
    // Note: Carousel navigation code is commented out for now

    // Find all video elements on the page
    const videos = document.querySelectorAll('video');
    const videoUrls = [];

    videos.forEach(video => {
      if (video.src && video.src.startsWith('http') && !video.src.includes('blob:')) {
        videoUrls.push(video.src);
      } else if (video.currentSrc && video.currentSrc.startsWith('http') && !video.currentSrc.includes('blob:')) {
        videoUrls.push(video.currentSrc);
      }
    });

    // Try to find video URLs in the page's JSON data
    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const carouselVideos = findCarouselVideos(data, carouselIndex);
        if (carouselVideos) {
          return { videoUrl: carouselVideos };
        }
      } catch (e) { }
    }

    // Return the video at the specified index if available
    if (videoUrls.length > carouselIndex) {
      return { videoUrl: videoUrls[carouselIndex] };
    } else if (videoUrls.length > 0) {
      return { videoUrl: videoUrls[0] };
    }

    // Fallback: search page source
    const pageText = document.body.innerHTML;
    const videoVersionsMatch = pageText.match(/"video_versions"\s*:\s*\[\s*\{[^}]*"url"\s*:\s*"([^"]+)"/);
    if (videoVersionsMatch && videoVersionsMatch[1]) {
      let url = videoVersionsMatch[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
      return { videoUrl: url };
    }

    return { error: 'No video found in carousel' };
  } catch (error) {
    return { error: error.message };
  }

  function findCarouselVideos(obj, targetIndex, depth = 0) {
    if (depth > 15 || typeof obj !== 'object' || obj === null) return null;

    // Look for carousel_media array
    if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
      const item = obj.carousel_media[targetIndex];
      if (item && item.video_versions && item.video_versions.length > 0) {
        return item.video_versions[0].url;
      }
    }

    // Look for edge_sidecar_to_children (GraphQL format)
    if (obj.edge_sidecar_to_children && obj.edge_sidecar_to_children.edges) {
      const edges = obj.edge_sidecar_to_children.edges;
      if (edges[targetIndex] && edges[targetIndex].node) {
        const node = edges[targetIndex].node;
        if (node.video_url) return node.video_url;
      }
    }

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const result = findCarouselVideos(obj[key], targetIndex, depth + 1);
        if (result) return result;
      }
    }
    return null;
  }
}

// Extract full-resolution image from Instagram page
function extractFullResImage() {
  try {
    let bestImage = null;
    let bestWidth = 0;

    // Look for images in the post
    const imageSelectors = [
      'article img[src*="cdninstagram"]',
      'article img[src*="fbcdn"]',
      'article img[src*="scontent"]',
      'main img[src*="cdninstagram"]',
      'main img[src*="fbcdn"]',
      'img[src*="cdninstagram"]'
    ];

    for (const selector of imageSelectors) {
      const images = document.querySelectorAll(selector);
      for (const img of images) {
        if (img.src && img.src.startsWith('http') && !img.src.includes('blob:')) {
          // Skip small profile pictures and icons
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;

          // Look for the largest image (likely the main post image)
          if (width > bestWidth && width >= 300 && height >= 300) {
            bestWidth = width;
            bestImage = img.src;
          }
        }
      }
    }

    // Also check srcset for higher resolution versions
    const allImages = document.querySelectorAll('article img[srcset], main img[srcset]');
    for (const img of allImages) {
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        // Parse srcset to find the highest resolution
        const sources = srcset.split(',').map(s => {
          const parts = s.trim().split(' ');
          const url = parts[0];
          const width = parseInt(parts[1]) || 0;
          return { url, width };
        }).filter(s => s.url && s.url.startsWith('http'));

        // Get the largest one
        sources.sort((a, b) => b.width - a.width);
        if (sources.length > 0 && sources[0].width > bestWidth) {
          bestWidth = sources[0].width;
          bestImage = sources[0].url;
        }
      }
    }

    // Check for image URLs in page data
    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const imageUrl = findHighResImage(data);
        if (imageUrl) {
          return { imageUrl };
        }
      } catch (e) { }
    }

    if (bestImage) {
      return { imageUrl: bestImage };
    }

    return { error: 'No high-resolution image found' };
  } catch (error) {
    return { error: error.message };
  }

  function findHighResImage(obj, depth = 0) {
    if (depth > 10 || typeof obj !== 'object' || obj === null) return null;

    // Look for image_versions2 which contains different resolutions
    if (obj.image_versions2 && obj.image_versions2.candidates) {
      const candidates = obj.image_versions2.candidates;
      if (Array.isArray(candidates) && candidates.length > 0) {
        // Sort by width and get the largest
        candidates.sort((a, b) => (b.width || 0) - (a.width || 0));
        if (candidates[0].url) return candidates[0].url;
      }
    }

    // Also check display_url which is often high-res
    if (obj.display_url && typeof obj.display_url === 'string' && obj.display_url.startsWith('http')) {
      return obj.display_url;
    }

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const result = findHighResImage(obj[key], depth + 1);
        if (result) return result;
      }
    }
    return null;
  }
}

// Extract video URL from Instagram page
function extractFromRenderedPage() {
  // Strict "deleted post" detection: true ONLY when Instagram is showing its
  // explicit "content isn't available" page (no real media + an unavailable
  // marker), so a slow/rate-limited load is never mistaken for a deletion.
  // Inlined because executeScript only serializes this single function's body.
  const isUnavailablePage = () => {
    try {
      if (document.querySelector('article video, article img[src*="cdninstagram"], article img[src*="fbcdn"], main video')) {
        return false;
      }
      const body = (document.body && document.body.innerText || '').toLowerCase();
      const markers = [
        "isn't available", 'isnt available', 'page not found', 'sorry, this page',
        'no está disponible', 'esta página no', // es
        '该页面无法', '无法使用', // zh
        'उपलब्ध नहीं', // hi
        'هذه الصفحة غير متوفرة', 'غير متاح' // ar
      ];
      return markers.some((m) => body.includes(m));
    } catch (e) {
      return false;
    }
  };

  try {
    const videoSelectors = [
      'video[src]',
      'video source[src]',
      'video',
      '[role="presentation"] video',
      'article video',
      'main video',
      'section video'
    ];

    let videoUrl = null;
    let imageUrl = null;
    let username = null;
    let caption = null;

    for (const selector of videoSelectors) {
      const videos = document.querySelectorAll(selector);
      for (const video of videos) {
        if (!videoUrl) {
          if (video.src && video.src.startsWith('http') && !video.src.includes('blob:')) {
            videoUrl = video.src;
            break;
          }

          const source = video.querySelector('source');
          if (source && source.src && source.src.startsWith('http')) {
            videoUrl = source.src;
            break;
          }

          if (video.currentSrc && video.currentSrc.startsWith('http') && !video.currentSrc.includes('blob:')) {
            videoUrl = video.currentSrc;
            break;
          }
        }
      }
      if (videoUrl) break;
    }

    const imageSelectors = [
      'article img[src*="cdninstagram"]',
      'img[src*="cdninstagram"]',
      'article img',
      'main img'
    ];

    for (const selector of imageSelectors) {
      const images = document.querySelectorAll(selector);
      for (const img of images) {
        if (img.src && img.src.startsWith('http') && !img.src.includes('blob:')) {
          if (!imageUrl) {
            imageUrl = img.src;
          }
          break;
        }
      }
      if (imageUrl) break;
    }

    const usernameEl = document.querySelector('header a[href*="/"]') ||
      document.querySelector('a[href*="/"][role="link"]');
    if (usernameEl) {
      const href = usernameEl.getAttribute('href');
      if (href) {
        const match = href.match(/instagram\.com\/([^/?]+)/); // eslint-disable-line no-useless-escape
        if (match) username = match[1];
      }
    }

    const captionEl = document.querySelector('article span') ||
      document.querySelector('[data-testid]');
    if (captionEl) {
      caption = captionEl.textContent || '';
    }

    const findVideoUrl = (obj, depth = 0) => {
      if (depth > 10) return null;
      if (typeof obj !== 'object' || obj === null) return null;

      if (obj.video_url && typeof obj.video_url === 'string' && obj.video_url.startsWith('http')) {
        return obj.video_url;
      }
      if (obj.videoUrl && typeof obj.videoUrl === 'string' && obj.videoUrl.startsWith('http')) {
        return obj.videoUrl;
      }
      if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
        const videoVersion = obj.video_versions.find(v => v.url && v.url.startsWith('http'));
        if (videoVersion) return videoVersion.url;
        if (obj.video_versions[0]?.url) return obj.video_versions[0].url;
      }

      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const result = findVideoUrl(obj[key], depth + 1);
          if (result) return result;
        }
      }
      return null;
    };

    if (!videoUrl && window.__additionalDataLoaded) {
      try {
        videoUrl = findVideoUrl(window.__additionalDataLoaded);
      } catch (e) { }
    }

    if (!videoUrl && window._sharedData) {
      try {
        videoUrl = findVideoUrl(window._sharedData);
      } catch (e) { }
    }

    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('video_versions') || (text.includes('video') && !videoUrl)) {
        if (!videoUrl) {
          try {
            if (script.type === 'application/json' || text.trim().startsWith('{')) {
              try {
                const fullData = JSON.parse(text);
                const found = findVideoUrl(fullData);
                if (found) {
                  videoUrl = found;
                  continue;
                }
              } catch (e) { }
            }

            if (!videoUrl && text.includes('video_versions')) {
              const videoVersionsPos = text.indexOf('"video_versions"');
              if (videoVersionsPos !== -1) {
                const searchStart = videoVersionsPos;
                const searchEnd = Math.min(text.length, videoVersionsPos + 2000);
                const searchText = text.substring(searchStart, searchEnd);

                const urlPatterns = [
                  /"url"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/,
                  /"url"\s*:\s*"(https?:\/\/[^"]+)"/,
                  /"url"\s*:\s*"(https?[^"]+)"/
                ];

                for (const pattern of urlPatterns) {
                  const match = searchText.match(pattern);
                  if (match && match[1]) {
                    let potentialUrl = match[1];
                    potentialUrl = potentialUrl.replace(/\\\//g, '/');
                    potentialUrl = potentialUrl.replace(/\\"/g, '"');
                    potentialUrl = potentialUrl.replace(/\\\\/g, '\\');

                    if (potentialUrl.startsWith('http://') || potentialUrl.startsWith('https://')) {
                      if (potentialUrl.includes('cdninstagram.com') || potentialUrl.includes('fbcdn.net') || potentialUrl.includes('scontent')) {
                        videoUrl = potentialUrl;
                        break;
                      }
                    }
                  }
                }
              }
            }
          } catch (e) { }
        }
      }
    }

    if (videoUrl) {
      return { videoUrl, imageUrl, username, caption };
    } else if (isUnavailablePage()) {
      return { unavailable: true, error: 'This post is no longer available on Instagram' };
    } else {
      return { error: 'Video URL not found on page' };
    }
  } catch (error) {
    return { error: `Extraction error: ${error.message}` };
  }
}

async function fetchImageAsDataURL(imageUrl) {
  try {
    const response = await fetch(imageUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    throw error;
  }
}
