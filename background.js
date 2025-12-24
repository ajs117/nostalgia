let capturedImages = [];
let capturedImagesCleanupTimeout = null;
let extensionTabId = null;
let activeInstagramTabId = null;

// Mutex for preventing race conditions in batch saves
let batchSaveLock = Promise.resolve();

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle messages - each must explicitly return true (async) or false (sync)

  // Ping to wake up service worker
  if (request.action === 'PING') {
    sendResponse({ success: true });
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

    getPostsPaginated(page, limit, sortBy, filterType, searchQuery, hashtagFilter).then((result) => {
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

  if (request.action === 'GET_POSTS_COUNT') {
    // O(1) count retrieval from metadata
    getPostsCount().then((count) => {
      sendResponse({ count });
    }).catch((error) => {
      console.error('Error getting posts count:', error);
      sendResponse({ count: 0 });
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

    // Process all checks and return results
    Promise.all(postIds.map((id, index) => checkPostExists(id, links[index])))
      .then((results) => {
        sendResponse({ results });
      })
      .catch((error) => {
        console.error('Error in batch existence check:', error);
        sendResponse({ results: postIds.map(() => false) });
      });
    return true;
  }

  if (request.action === 'SYNC_WITH_INSTAGRAM') {
    chrome.tabs.create({ url: 'https://www.instagram.com/' }, (tab) => {
      activeInstagramTabId = tab.id;
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
    // Open Instagram in a background tab for sync (cookies required)
    chrome.tabs.create({ url: 'https://www.instagram.com/', active: false }, (tab) => {
      activeInstagramTabId = tab.id;

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
    safeBroadcast({ action: 'IMPORT_FAILED', error: request.error });
    if (activeInstagramTabId) {
      safeSendToTab(activeInstagramTabId, { action: 'IMPORT_FAILED', error: request.error });
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

      createNewTab();

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
                                  safeSendResponse({ success: false, error: extracted?.error || 'Video not found' });
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
      sendResponse({ min: null, max: null });
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
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_METADATA], 'readonly');
      const store = transaction.objectStore(STORE_METADATA);
      const request = store.get('posts_count');

      request.onsuccess = () => {
        db.close();
        resolve(request.result || 0);
      };
      request.onerror = () => {
        db.close();
        // Fallback: count posts directly
        countPostsDirectly().then(resolve).catch(() => resolve(0));
      };
    });
  } catch (error) {
    if (db) db.close();
    return 0;
  }
}

// Fallback count method
async function countPostsDirectly() {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_POSTS], 'readonly');
      const store = transaction.objectStore(STORE_POSTS);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        db.close();
        resolve(countRequest.result);
      };
      countRequest.onerror = () => {
        db.close();
        resolve(0);
      };
    });
  } catch (error) {
    if (db) db.close();
    return 0;
  }
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

// Get posts with pagination, sorting, and filtering
async function getPostsPaginated(page = 1, limit = 50, sortBy = 'newest-saved', filterType = 'all', searchQuery = '', hashtagFilter = null) {
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
              for (let i = sorted.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
              }
            } else {
              // Default fallback: timestamp descending
              sorted.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }

            const sliced = sorted.slice(targetStart, targetEndExclusive);
            db.close();
            resolve({
              posts: sliced,
              total: sorted.length,
              hasMore: sorted.length > targetEndExclusive,
              page
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
              allMatchedPosts.push(post);
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

// Get all hashtags with counts from all posts (with caching)
async function getAllHashtagsWithCounts() {
  let db;
  try {
    db = await openDB();

    return new Promise((resolve, reject) => {
      // Readonly is enough for cache lookup + count and reduces write-lock contention.
      const transaction = db.transaction([STORE_POSTS, STORE_METADATA], 'readonly');
      const store = transaction.objectStore(STORE_POSTS);
      const metaStore = transaction.objectStore(STORE_METADATA);

      // Check cache first
      const cacheRequest = metaStore.get('hashtags_cache');
      const countRequest = store.count();

      let currentCount = 0;
      let cacheData = null;

      countRequest.onsuccess = () => {
        currentCount = countRequest.result;
      };

      cacheRequest.onsuccess = () => {
        cacheData = cacheRequest.result;

        // Wait for count to be ready, then check cache validity
        transaction.oncomplete = () => {
          // If cache is valid (count matches), return cached data
          if (cacheData && cacheData.count === currentCount && cacheData.hashtags) {
            db.close();
            resolve(cacheData.hashtags);
            return;
          }

          // If cache exists but is stale and a sync appears to be active,
          // return the cached hashtags (stale) to avoid repeatedly
          // scanning the entire DB during an active sync which can be
          // very expensive for large datasets.
          if (cacheData && typeof activeInstagramTabId !== 'undefined' && activeInstagramTabId) {
            db.close();
            resolve(cacheData.hashtags || []);
            return;
          }

          // Cache miss or no active sync - recalculate
          recalculateHashtags();
        };
      };

      cacheRequest.onerror = () => {
        // On error, just recalculate
        transaction.oncomplete = () => {
          recalculateHashtags();
        };
      };

      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('Transaction error'));
      };

      async function recalculateHashtags() {
        let recalcDb;
        try {
          recalcDb = await openDB();
          const recalcTransaction = recalcDb.transaction([STORE_POSTS, STORE_METADATA], 'readwrite');
          const recalcStore = recalcTransaction.objectStore(STORE_POSTS);
          const recalcMetaStore = recalcTransaction.objectStore(STORE_METADATA);

          const hashtagCounts = new Map();
          const cursorRequest = recalcStore.openCursor();

          // Helper to extract hashtags from text
          const extractHashtags = (text) => {
            if (!text || typeof text !== 'string') return [];
            const hashtagRegex = /#[\w]+/g;
            const matches = text.match(hashtagRegex);
            return matches ? matches.map(tag => tag.toLowerCase()) : [];
          };

          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const post = cursor.value;
              if (post && post.title) {
                const caption = post.title || '';
                extractHashtags(caption).forEach(tag => {
                  if (tag) {
                    hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
                  }
                });
              }
              cursor.continue();
            } else {
              // Convert to array and sort by count
              const hashtags = Array.from(hashtagCounts.entries())
                .map(([tag, count]) => ({ tag, count }))
                .sort((a, b) => b.count - a.count);

              // Store in cache
              recalcMetaStore.put({ count: currentCount, hashtags }, 'hashtags_cache');

              recalcTransaction.oncomplete = () => {
                recalcDb.close();
                resolve(hashtags);
              };
            }
          };

          cursorRequest.onerror = () => {
            recalcDb.close();
            reject(cursorRequest.error || new Error('Cursor error'));
          };

          recalcTransaction.onerror = () => {
            recalcDb.close();
            reject(recalcTransaction.error || new Error('Transaction error'));
          };
        } catch (error) {
          if (recalcDb) recalcDb.close();
          reject(error);
        }
      }
    });
  } catch (error) {
    if (db) db.close();
    console.error('Error in getAllHashtagsWithCounts:', error);
    return Promise.resolve([]); // Return empty array instead of throwing
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
