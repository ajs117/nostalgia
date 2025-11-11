let capturedImages = [];
let extensionTabId = null;
let activeInstagramTabId = null;

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }, (newTab) => {
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

// Check for saved progress on browser startup and when Instagram tabs are opened
chrome.runtime.onStartup.addListener(() => {
  checkForSavedProgress();
});

// Also check when any tab is updated (to catch Instagram tabs opening)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && tab.url.includes("instagram.com")) {
    // Small delay to ensure content script is ready
    setTimeout(() => {
      checkForSavedProgress(tabId);
    }, 1000);
  }
});

function checkForSavedProgress(tabId = null) {
  // Sync progress is still in chrome.storage.local for now (temporary state)
  chrome.storage.local.get(["instagram_sync_progress"], (result) => {
    if (result.instagram_sync_progress) {
      // There's saved progress, notify the Instagram tab
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: "SHOW_SYNC_DRAWER" }, (response) => {
          if (chrome.runtime.lastError) {
            // Content script might not be ready yet, try again
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: "SHOW_SYNC_DRAWER" });
            }, 2000);
          }
        });
      } else {
        // Find Instagram tab
        chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "SHOW_SYNC_DRAWER" });
          }
        });
      }
    }
  });
}

function updateExtensionTab() {
  // Find all extension tabs (index.html) and send update message to all of them
  chrome.tabs.query({ url: chrome.runtime.getURL("index.html") }, (tabs) => {
    if (tabs.length > 0) {
      // Update extensionTabId to the first active tab, or first tab if none active
      const activeTab = tabs.find(tab => tab.active) || tabs[0];
      if (activeTab) {
        extensionTabId = activeTab.id;
      }
      
      // Send update message to all extension tabs
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: "UPDATE_ITEMS" }, () => {
          if (chrome.runtime.lastError) {
            // Tab might not be ready, that's okay
          }
        });
      });
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CAPTURE_IMAGES") {
    capturedImages = request.images;
  } else if (request.action === "FETCH_IMAGE") {
    fetchImageAsDataURL(request.imageUrl)
      .then((dataUrl) => sendResponse({ success: true, dataUrl: dataUrl }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Indicates that the response is sent asynchronously
  } else if (request.action === "GET_CAPTURED_IMAGES") {
    sendResponse(capturedImages);
  } else if (request.action === "OPEN_MAIN_VIEWER") {
    if (extensionTabId !== null) {
      chrome.tabs.get(extensionTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          // Tab doesn't exist, create new one
          chrome.tabs.create(
            { url: chrome.runtime.getURL("index.html") },
            (newTab) => {
              extensionTabId = newTab.id;
              chrome.tabs.update(newTab.id, { active: true });
            }
          );
        } else {
          // Tab exists, activate it
          chrome.tabs.update(extensionTabId, { active: true });
        }
      });
    } else {
      // No tab exists, create new one
      chrome.tabs.create(
        { url: chrome.runtime.getURL("index.html") },
        (newTab) => {
          extensionTabId = newTab.id;
        }
      );
    }
  } else if (request.action === "GET_INSTAGRAM_POSTS") {
    // Retrieve posts from IndexedDB and convert IndexedDB keys to data URLs for display
    getPostsFromIndexedDB().then(async (posts) => {
      // Convert IndexedDB keys to data URLs on-demand
      const formattedPosts = await Promise.all(
        posts.map(post => formatInstagramPostObj(post))
      );
      
      // Filter out null posts (formatting errors)
      const validPosts = formattedPosts.filter(post => post !== null);
      
      sendResponse({ success: true, posts: validPosts });
    }).catch((error) => {
      console.error("Error retrieving posts:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Async response
  } else if (request.action === "GET_COLLECTIONS") {
    getCollectionsFromIndexedDB().then((collections) => {
      sendResponse({ success: true, collections });
    }).catch((error) => {
      console.error("Error retrieving collections:", error);
      sendResponse({ success: false, error: error.message, collections: [] });
    });
    return true; // Async response
  } else if (request.action === "SYNC_WITH_INSTAGRAM") {
    chrome.tabs.create({ url: "https://www.instagram.com/" }, (tab) => {
      activeInstagramTabId = tab.id;
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.sendMessage(tabId, { action: "SHOW_SYNC_DRAWER" });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      });
    });
  } else if (request.action === "START_SYNC") {
    if (activeInstagramTabId) {
      // Check if we're resuming or starting fresh
      chrome.storage.local.get(["instagram_sync_progress"], (result) => {
        const isResuming = result.instagram_sync_progress !== undefined;
        
        if (!isResuming) {
          // Clear existing posts only if starting fresh (not resuming)
          storePostsInIndexedDB([]).then(() => {
            chrome.tabs.sendMessage(activeInstagramTabId, {
              action: "IMPORT_INSTAGRAM_POSTS",
            });
          }).catch(() => {
            chrome.tabs.sendMessage(activeInstagramTabId, {
              action: "IMPORT_INSTAGRAM_POSTS",
            });
          });
        } else {
          // Just start the sync if resuming
          chrome.tabs.sendMessage(activeInstagramTabId, {
            action: "IMPORT_INSTAGRAM_POSTS",
          });
        }
      });
    }
  } else if (request.action === "RETURN_TO_EXTENSION") {
    if (extensionTabId !== null) {
      chrome.tabs.update(extensionTabId, { active: true }, () => {
        setTimeout(updateExtensionTab, 500);
      });
    } else {
      chrome.tabs.create(
        { url: chrome.runtime.getURL("index.html") },
        (newTab) => {
          extensionTabId = newTab.id;
          setTimeout(updateExtensionTab, 500);
        }
      );
    }
  } else if (request.action === "SAVE_POSTS_BATCH") {
    // Save batch of posts by appending to existing posts in IndexedDB
    getPostsFromIndexedDB().then((existingPosts) => {
      // Store posts with IndexedDB key references (small) - don't convert to data URLs yet
      // The conversion will happen on-demand when displaying posts
      const newPosts = request.posts.map((post) => {
        if (!post || typeof post !== "object") {
          return null;
        }
        // Use 'url' from incoming post (contentScript sends 'url')
        const { url, title, thumbnail, username, collectionIds, isVideo, videoUrl } = post;
        
        if (!url) {
          console.warn('Post missing url field:', post.id || 'unknown');
        }
        
        return {
          id: post.id || `${username}-${Date.now()}`,
          link: url, // Store as 'link' for consistency
          thumbnail: thumbnail, // Store base64 data URL directly in thumbnail field
          title,
          username,
          collectionIds,
          isVideo,
          videoUrl, // Keep IndexedDB key reference (e.g., "idb:vid_123")
          timestamp: post.timestamp || Date.now(),
        };
      }).filter(Boolean);
      const allPosts = [...existingPosts, ...newPosts];

      storePostsInIndexedDB(allPosts).then(() => {
        console.log(`Saved batch of ${newPosts.length} posts. Total: ${allPosts.length}`);
        // Update extension tab to show new posts
        updateExtensionTab();
        sendResponse({ success: true });
      }).catch((error) => {
        console.error("Error saving batch to IndexedDB:", error);
        sendResponse({ success: false, error: error.message });
      });
    }).catch((error) => {
      console.error("Error getting existing posts:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Async response
  } else if (request.action === "SAVE_COLLECTIONS") {
    storeCollectionsInIndexedDB(request.collections).then(() => {
      console.log(`Saved ${request.collections.length} collections`);
    }).catch((error) => {
      console.error("Error saving collections:", error);
    });
  } else if (request.action === "SYNC_FINISHED") {
    chrome.runtime.sendMessage({
      action: "SYNC_COMPLETE",
      syncedCount: request.syncedCount,
      failedCount: request.failedCount,
    });
    if (activeInstagramTabId) {
      chrome.tabs.sendMessage(activeInstagramTabId, {
        action: "SYNC_COMPLETE",
        syncedCount: request.syncedCount,
        failedCount: request.failedCount,
      });
    }
    setTimeout(updateExtensionTab, 500);
  } else if (request.action === "IMPORT_FAILED") {
    if (activeInstagramTabId) {
      chrome.tabs.sendMessage(activeInstagramTabId, {
        action: "IMPORT_FAILED",
        error: request.error,
      });
    }
  } else if (request.action === "STOP_SYNC") {
    if (activeInstagramTabId) {
      chrome.tabs.sendMessage(activeInstagramTabId, {
        action: "STOP_SYNC",
      });
    }
  } else if (request.action === "STORE_MEDIA_IN_IDB") {
    // Store media blob in IndexedDB (from content script)
    const { key, blob, type, size } = request;
    try {
      // Chrome message passing serializes typed arrays, so we receive it as a plain array
      // Convert array back to Uint8Array then to Blob
      let blobObj;
      
      if (Array.isArray(blob)) {
        // Most common case: sent as plain array
        const uint8Array = new Uint8Array(blob);
        blobObj = new Blob([uint8Array], { type: type || (key.startsWith('vid_') ? 'video/mp4' : 'image/jpeg') });
      } else if (blob instanceof Blob) {
        blobObj = blob;
      } else if (blob instanceof Uint8Array) {
        blobObj = new Blob([blob], { type: type || (key.startsWith('vid_') ? 'video/mp4' : 'image/jpeg') });
      } else if (blob instanceof ArrayBuffer) {
        blobObj = new Blob([blob], { type: type || (key.startsWith('vid_') ? 'video/mp4' : 'image/jpeg') });
      } else {
        console.error('Invalid blob data type:', typeof blob, 'Is array:', Array.isArray(blob), 'Has length:', blob?.length);
        throw new Error(`Invalid blob data type: ${typeof blob}. Expected array.`);
      }
      
      // Validate blob was created correctly
      if (!blobObj) {
        throw new Error('Failed to create blob object');
      }
      
      if (blobObj.size === 0) {
        throw new Error(`Created blob is empty (expected size: ${size || 'unknown'} bytes)`);
      }
      
      // Validate size matches if provided
      if (size && Math.abs(blobObj.size - size) > 100) {
        console.warn(`Size mismatch for ${key}: expected ${size}, got ${blobObj.size}`);
      }
      
      storeMediaInIndexedDB(key, blobObj)
        .then(() => {
          console.log(`✓ Stored: ${key} (${type || 'unknown'}, ${(blobObj.size / 1024).toFixed(2)} KB)`);
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error(`✗ Error storing ${key}:`, error);
          sendResponse({ success: false, error: error.message });
        });
    } catch (error) {
      console.error("Error creating blob:", error);
      console.error("Blob data type:", typeof blob, "Is array:", Array.isArray(blob), "Length:", blob?.length);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Async response
  } else if (request.action === "FETCH_AND_STORE_THUMBNAIL") {
    // Service workers can't use Image/Canvas, so just fetch and store without compression
    // Compression should happen in content script
    const { imageUrl, postId } = request;
    const thumbnailKey = `thumb_${postId}`;
    
    fetchImageAsDataURL(imageUrl)
      .then((dataUrl) => {
        // Convert data URL to blob and store directly (no compression in service worker)
        fetch(dataUrl)
          .then(res => res.blob())
          .then(blob => {
            storeMediaInIndexedDB(thumbnailKey, blob)
              .then(() => {
                console.log(`✓ Stored thumbnail via background (no compression): ${thumbnailKey}`);
                sendResponse({ success: true, thumbnailKey });
              })
              .catch((error) => {
                console.error(`✗ Error storing thumbnail:`, error);
                sendResponse({ success: false, error: error.message });
              });
          })
          .catch((error) => {
            console.error(`Error converting data URL to blob:`, error);
            sendResponse({ success: false, error: error.message });
          });
      })
      .catch((error) => {
        console.error(`Error fetching thumbnail:`, error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Async response
  } else if (request.action === "FETCH_VIDEO_CDN") {
    // Open Instagram post in hidden tab and extract video CDN link
    try {
      console.log('FETCH_VIDEO_CDN request:', request);
      const { permalink, postId } = request;
      
      if (!permalink) {
        console.error('No permalink in request. Request object:', JSON.stringify(request));
        throw new Error(`No permalink provided. Request keys: ${Object.keys(request).join(', ')}`);
      }
      
      // Track if response has been sent to prevent multiple calls
      let responseSent = false;
      const safeSendResponse = (response) => {
        if (!responseSent) {
          responseSent = true;
          sendResponse(response);
        }
      };
      
      // Helper to check if tab exists before operations
      const checkTabExists = (tabId, callback) => {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            callback(null, chrome.runtime.lastError.message);
          } else {
            callback(tab, null);
          }
        });
      };
      
      // First, check if there's already an Instagram tab open we can use
      chrome.tabs.query({ url: '*://www.instagram.com/*' }, (existingTabs) => {
        let tabId = null;
        let shouldCloseTab = false;
        
        if (existingTabs && existingTabs.length > 0) {
          // Use existing Instagram tab
          tabId = existingTabs[0].id;
          console.log('Using existing Instagram tab:', tabId);
          // Navigate existing tab to the post
          chrome.tabs.update(tabId, { url: permalink, active: false }, (updatedTab) => {
            if (chrome.runtime.lastError) {
              // If update fails, create new tab
              createNewTab();
            } else {
              processTab(updatedTab.id, false);
            }
          });
        } else {
          // Create a new hidden tab
          createNewTab();
        }
        
        function createNewTab() {
          chrome.tabs.create({
            url: permalink,
            active: false  // Hidden tab
          }, (tab) => {
            if (chrome.runtime.lastError) {
              safeSendResponse({ success: false, error: `Failed to create tab: ${chrome.runtime.lastError.message}` });
              return;
            }
            shouldCloseTab = true;
            processTab(tab.id, true);
          });
        }
        
        function processTab(tabId, isNewTab) {
          try {
          let attempts = 0;
          const maxAttempts = 20; // 10 seconds total (20 * 500ms)
          
          // Wait for page to load, then inject script to extract video
          // Instagram is a SPA, so we need to wait for content to load
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
                  
                  // Wait for page to be complete and give it extra time for dynamic content
                  // Need at least 5 attempts (2.5 seconds) to ensure page is ready
                  if (tabInfo.status === 'complete' && attempts >= 5) {
                    clearInterval(checkTab);
                    
                    // Wait a bit more for Instagram's JS to load video
                    setTimeout(() => {
                      try {
                        // First check if the page loaded correctly
                        checkTabExists(tabId, (tabInfo, error) => {
                          if (error) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                            safeSendResponse({ success: false, error: `Tab error: ${error}` });
                            return;
                          }
                          
                          // Check if URL is still Instagram and page is loaded
                          if (!tabInfo.url || !tabInfo.url.includes('instagram.com')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                            safeSendResponse({ success: false, error: `Page redirected or not accessible: ${tabInfo.url}` });
                            return;
                          }
                          
                          // Check if page is showing an error (chrome://error or similar)
                          if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('chrome-error://') || tabInfo.url.startsWith('edge://')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                            safeSendResponse({ success: false, error: `Page error: ${tabInfo.url}` });
                            return;
                          }
                          
                          // Check if redirected to login page or other non-post page
                          if (tabInfo.url && !tabInfo.url.includes('/p/') && !tabInfo.url.includes('/reel/')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                            safeSendResponse({ success: false, error: `Page redirected to: ${tabInfo.url}` });
                            return;
                          }
                          
                          // Verify the page is actually loaded and ready
                          if (tabInfo.status !== 'complete') {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                            safeSendResponse({ success: false, error: `Page not fully loaded. Status: ${tabInfo.status}` });
                            return;
                          }
                          
                          // First, try a simple test injection to verify the page is accessible
                          // This helps catch error pages before trying the full extraction
                          chrome.scripting.executeScript({
                            target: { tabId: tabId, allFrames: false },
                            func: () => {
                              // Simple test - just check if we're on a valid page
                              if (document.readyState !== 'complete') {
                                return { error: 'Page not ready' };
                              }
                              if (window.location.href.includes('chrome-error://') || 
                                  window.location.href.includes('edge-error://') ||
                                  window.location.href.includes('chrome://') ||
                                  window.location.href.includes('edge://')) {
                                return { error: 'Error page detected' };
                              }
                              return { ready: true };
                            }
                          }, (testResults) => {
                            if (chrome.runtime.lastError) {
                              const errorMsg = `Page not accessible: ${chrome.runtime.lastError.message}`;
                              console.error(errorMsg);
                              if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                              safeSendResponse({ success: false, error: errorMsg });
                              return;
                            }
                            
                            if (!testResults || !testResults[0] || testResults[0].result?.error) {
                              const errorMsg = testResults?.[0]?.result?.error || 'Page validation failed';
                              console.error(errorMsg);
                              if (shouldCloseTab) {
                                chrome.tabs.remove(tabId, () => {});
                              }
                              safeSendResponse({ success: false, error: errorMsg });
                              return;
                            }
                            
                            // Page is accessible, now do the actual extraction
                            chrome.scripting.executeScript({
                              target: { tabId: tabId, allFrames: false },
                              func: extractFromRenderedPage
                            }, (results) => {
                            try {
                              // Check for errors BEFORE accessing results
                              if (chrome.runtime.lastError) {
                                const errorMsg = `Script injection error: ${chrome.runtime.lastError.message}`;
                                console.error(errorMsg);
                                if (shouldCloseTab) {
                                  chrome.tabs.remove(tabId, () => {});
                                }
                                safeSendResponse({ success: false, error: errorMsg });
                                return;
                              }
                              
                              // Close the tab only if we created it (not if we used existing tab)
                              if (shouldCloseTab) {
                                chrome.tabs.remove(tabId, () => {
                                  // Ignore errors when closing
                                });
                              }
                              
                              if (!results || !results[0]) {
                                const errorMsg = 'Failed to extract video URL - no results from script';
                                console.error(errorMsg);
                                safeSendResponse({ success: false, error: errorMsg });
                                return;
                              }
                              
                              const extracted = results[0].result;
                              
                              // Log page dump if available
                              if (extracted && extracted.pageDump) {
                                console.log('=== PAGE DUMP FROM INSTAGRAM TAB ===');
                                console.log('URL:', extracted.pageDump.url);
                                console.log('Videos found:', extracted.pageDump.videos.length);
                                console.log('Images found:', extracted.pageDump.images.length);
                                console.log('Scripts with video:', extracted.pageDump.scripts.length);
                                console.log('Full page dump:', extracted.pageDump);
                                console.log('=== END PAGE DUMP ===');
                              }
                              
                              if (extracted && extracted.videoUrl) {
                                console.log('Successfully extracted video URL:', extracted.videoUrl.substring(0, 100));
                                safeSendResponse({ success: true, videoUrl: extracted.videoUrl });
                              } else {
                                const errorMsg = extracted?.error || 'Video not found on page';
                                console.error(errorMsg);
                                if (extracted?.pageDump) {
                                  console.error('Page dump available for debugging:', extracted.pageDump);
                                }
                                safeSendResponse({ success: false, error: errorMsg, pageDump: extracted?.pageDump });
                              }
                            } catch (error) {
                              console.error('Error in script injection callback:', error);
                              safeSendResponse({ success: false, error: `Script callback error: ${error.message}` });
                            }
                            });
                          });
                        });
                      } catch (error) {
                        console.error('Error executing script:', error);
                        if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                        safeSendResponse({ success: false, error: `Script execution error: ${error.message}` });
                      }
                    }, 3000); // Wait 3 seconds for dynamic content to load
                  }
                } catch (error) {
                  clearInterval(checkTab);
                  console.error('Error in tab check:', error);
                  if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                  safeSendResponse({ success: false, error: `Tab check error: ${error.message}` });
                }
              });
              
              // Timeout after max attempts
              if (attempts >= maxAttempts) {
                clearInterval(checkTab);
                if (shouldCloseTab) {
                  checkTabExists(tabId, (tab, error) => {
                    if (!error) {
                      chrome.tabs.remove(tabId);
                    }
                  });
                }
                safeSendResponse({ success: false, error: 'Timeout waiting for page to load' });
              }
            } catch (error) {
              clearInterval(checkTab);
              console.error('Error in checkTab interval:', error);
              if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
              safeSendResponse({ success: false, error: `Interval error: ${error.message}` });
            }
          }, 500);
          } catch (error) {
            console.error('Error in processTab:', error);
            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
            safeSendResponse({ success: false, error: `Process tab error: ${error.message}` });
          }
        }
      });
    } catch (error) {
      console.error('Error in FETCH_VIDEO_CDN handler:', error);
      sendResponse({ success: false, error: `Handler error: ${error.message}` });
    }
    
    return true; // Async response
  } else if (request.action === "DEBUG_INDEXEDDB") {
    // Debug tool to inspect IndexedDB contents
    debugIndexedDB().then((result) => {
      sendResponse({ success: true, data: result });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Async response
  }

  return true;
});

// IndexedDB helper functions
const DB_NAME = "instagram_media_db";
const DB_VERSION = 2; // Increment version to add new stores
const STORE_MEDIA = "media";
const STORE_POSTS = "posts";
const STORE_COLLECTIONS = "collections";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create media store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA);
      }
      
      // Create posts store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_POSTS)) {
        db.createObjectStore(STORE_POSTS);
      }
      
      // Create collections store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
        db.createObjectStore(STORE_COLLECTIONS);
      }
    };
  });
}

async function storeMediaInIndexedDB(key, blob) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MEDIA], "readwrite");
      const store = transaction.objectStore(STORE_MEDIA);
      const request = store.put(blob, key);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error("Error storing media in IndexedDB:", error);
    throw error;
  }
}

async function storePostsInIndexedDB(posts) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS], "readwrite");
      const store = transaction.objectStore(STORE_POSTS);
      const request = store.put(posts, "all_posts");
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error("Error storing posts in IndexedDB:", error);
    throw error;
  }
}

async function getPostsFromIndexedDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS], "readonly");
      const store = transaction.objectStore(STORE_POSTS);
      const request = store.get("all_posts");
      
      request.onsuccess = () => {
        const posts = request.result || [];
        db.close();
        resolve(posts);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("Error retrieving posts from IndexedDB:", error);
    return [];
  }
}

async function storeCollectionsInIndexedDB(collections) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_COLLECTIONS], "readwrite");
      const store = transaction.objectStore(STORE_COLLECTIONS);
      const request = store.put(collections, "all_collections");
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error("Error storing collections in IndexedDB:", error);
    throw error;
  }
}

async function getCollectionsFromIndexedDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_COLLECTIONS], "readonly");
      const store = transaction.objectStore(STORE_COLLECTIONS);
      const request = store.get("all_collections");
      
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
    console.error("Error retrieving collections from IndexedDB:", error);
    return [];
  }
}

async function getMediaFromIndexedDB(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MEDIA], "readonly");
      const store = transaction.objectStore(STORE_MEDIA);
      const request = store.get(key);
      
      request.onsuccess = () => {
        const blob = request.result;
        if (blob) {
          console.log(`Found blob for key ${key}: ${blob.size} bytes, type: ${blob.type}`);
          // Convert blob to data URL for display
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            console.log(`Converted ${key} to data URL: ${dataUrl ? dataUrl.substring(0, 50) + '...' : 'null'}`);
            db.close();
            resolve(dataUrl);
          };
          reader.onerror = () => {
            console.error(`FileReader error for key: ${key}`);
            db.close();
            resolve(null);
          };
          reader.readAsDataURL(blob);
        } else {
          console.warn(`No blob found in IndexedDB for key: ${key}`);
          // List available keys to help debug
          const getAllKeysRequest = store.getAllKeys();
          getAllKeysRequest.onsuccess = () => {
            const allKeys = getAllKeysRequest.result;
            const matchingKeys = allKeys.filter(k => k.includes(key.split('_').slice(-1)[0]) || key.includes(k.split('_').slice(-1)[0]));
            console.log(`Available keys (first 10):`, allKeys.slice(0, 10));
            console.log(`Looking for: ${key}`);
            if (matchingKeys.length > 0) {
              console.log(`Found similar keys:`, matchingKeys.slice(0, 5));
            }
          };
          db.close();
          resolve(null);
        }
      };
      request.onerror = () => {
        console.error(`IndexedDB get error for key: ${key}`, request.error);
        db.close();
        resolve(null);
      };
    });
  } catch (error) {
    console.error("Error retrieving media from IndexedDB:", error);
    return null;
  }
}

async function formatInstagramPostObj(post) {
  if (!post || typeof post !== "object") {
    console.error("Invalid post object:", post);
    return null;
  }

  const { link, title, thumbnail, username, collectionIds, isVideo, videoUrl, timestamp } = post;
  
  // Thumbnail is now stored as base64 data URL directly in the entity
  // Check both 'thumbnail' and 'image' fields (for backwards compatibility)
  let thumbnailValue = thumbnail || post.image;
  
  // Legacy: handle old IndexedDB keys
  let imageUrl = thumbnailValue;
  if (thumbnailValue && typeof thumbnailValue === 'string' && thumbnailValue.startsWith("idb:")) {
    // Legacy IndexedDB key - try to retrieve
    const dbKey = thumbnailValue.substring(4);
    const dataUrl = await getMediaFromIndexedDB(dbKey);
    imageUrl = dataUrl || null;
  }
  
  // For videos, videoUrl should be the permalink (link)
  let videoUrlFinal = null;
  if (isVideo) {
    videoUrlFinal = link; // Always use permalink for videos
  }
  
  return {
    id: post.id || `${username}-${Date.now()}`,
    link: link || null,
    image: imageUrl, // Base64 data URL or null
    title,
    username,
    collectionIds,
    isVideo,
    videoUrl: videoUrlFinal, // Permalink for videos (or null for photos)
    timestamp: timestamp || Date.now(),
  };
}

// Function to extract video URL from Instagram page (injected into page)
// Extract video and media info from rendered Instagram page
function extractFromRenderedPage() {
  try {
    // DUMP PAGE DATA FOR DEBUGGING
    const pageDump = {
      url: window.location.href,
      readyState: document.readyState,
      title: document.title,
      videos: [],
      images: [],
      scripts: [],
      windowData: {},
      htmlSnippet: document.documentElement.outerHTML.substring(0, 50000) // First 50KB
    };
    
    // First, try to find video element directly
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
    
    // Collect all video elements
    for (const selector of videoSelectors) {
      const videos = document.querySelectorAll(selector);
      videos.forEach((video, idx) => {
        const videoInfo = {
          selector: selector,
          index: idx,
          src: video.src || null,
          currentSrc: video.currentSrc || null,
          poster: video.poster || null,
          tagName: video.tagName,
          className: video.className,
          id: video.id || null,
          parentTag: video.parentElement?.tagName || null,
          parentClass: video.parentElement?.className || null
        };
        
        // Check for source element
        const source = video.querySelector('source');
        if (source) {
          videoInfo.sourceSrc = source.src || null;
          videoInfo.sourceType = source.type || null;
        }
        
        pageDump.videos.push(videoInfo);
        
        // Try to extract URL
        if (!videoUrl) {
          if (video.src && video.src.startsWith('http') && !video.src.includes('blob:')) {
            videoUrl = video.src;
          } else if (source && source.src && source.src.startsWith('http')) {
            videoUrl = source.src;
          } else if (video.currentSrc && video.currentSrc.startsWith('http') && !video.currentSrc.includes('blob:')) {
            videoUrl = video.currentSrc;
          }
        }
      });
    }
    
    // Try to find image as fallback
    const imageSelectors = [
      'article img[src*="cdninstagram"]',
      'img[src*="cdninstagram"]',
      'article img',
      'main img'
    ];
    
    // Collect all image elements
    for (const selector of imageSelectors) {
      const images = document.querySelectorAll(selector);
      images.forEach((img, idx) => {
        if (img.src && img.src.startsWith('http') && !img.src.includes('blob:')) {
          pageDump.images.push({
            selector: selector,
            index: idx,
            src: img.src,
            alt: img.alt || null,
            className: img.className,
            parentTag: img.parentElement?.tagName || null
          });
          
          if (!imageUrl) {
            imageUrl = img.src;
          }
        }
      });
    }
    
    // Extract username from page
    const usernameEl = document.querySelector('header a[href*="/"]') || 
                       document.querySelector('a[href*="/"][role="link"]');
    if (usernameEl) {
      const href = usernameEl.getAttribute('href');
      if (href) {
        const match = href.match(/instagram\.com\/([^\/\?]+)/);
        if (match) username = match[1];
      }
    }
    
    // Extract caption
    const captionEl = document.querySelector('article span') || 
                      document.querySelector('[data-testid]');
    if (captionEl) {
      caption = captionEl.textContent || '';
    }
    
    // Try to find in window data structures
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
    
    // Check window data and dump it
    if (window.__additionalDataLoaded) {
      try {
        pageDump.windowData.__additionalDataLoaded = JSON.stringify(window.__additionalDataLoaded).substring(0, 10000);
        if (!videoUrl) {
          videoUrl = findVideoUrl(window.__additionalDataLoaded);
        }
      } catch (e) {
        pageDump.windowData.__additionalDataLoaded = 'Error serializing: ' + e.message;
      }
    }
    
    if (window._sharedData) {
      try {
        pageDump.windowData._sharedData = JSON.stringify(window._sharedData).substring(0, 10000);
        if (!videoUrl) {
          videoUrl = findVideoUrl(window._sharedData);
        }
      } catch (e) {
        pageDump.windowData._sharedData = 'Error serializing: ' + e.message;
      }
    }
    
    // Check script tags for JSON data
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('video') || text.includes('Video') || text.includes('VIDEO') || text.includes('video_versions')) {
        pageDump.scripts.push({
          type: script.type || 'text/javascript',
          hasVideo: true,
          length: text.length,
          preview: text.substring(0, 500)
        });
        
        if (!videoUrl) {
          try {
            // First, try to parse the entire script as JSON (for application/json scripts)
            if (script.type === 'application/json' || text.trim().startsWith('{')) {
              try {
                const fullData = JSON.parse(text);
                const found = findVideoUrl(fullData);
                if (found) {
                  videoUrl = found;
                  continue;
                }
              } catch (e) {
                // Not valid JSON, continue with other methods
              }
            }
            
            // Look for video_versions array specifically - this is the most reliable method
            if (!videoUrl && text.includes('video_versions')) {
              // Find the position of "video_versions"
              const videoVersionsPos = text.indexOf('"video_versions"');
              if (videoVersionsPos !== -1) {
                // Look for "url" field after video_versions (within reasonable distance)
                const searchStart = videoVersionsPos;
                const searchEnd = Math.min(text.length, videoVersionsPos + 2000); // Search up to 2000 chars ahead
                const searchText = text.substring(searchStart, searchEnd);
                
                // Try multiple patterns to find the URL
                const urlPatterns = [
                  // Pattern: "url":"https:\/\/..." (with escaped slashes)
                  /"url"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/,
                  // Pattern: "url":"https://..." (without escaped slashes)
                  /"url"\s*:\s*"(https?:\/\/[^"]+)"/,
                  // Pattern: "url":"https..." (more flexible)
                  /"url"\s*:\s*"(https?[^"]+)"/,
                ];
                
                for (const pattern of urlPatterns) {
                  const match = searchText.match(pattern);
                  if (match && match[1]) {
                    let potentialUrl = match[1];
                    // Unescape JSON escape sequences
                    potentialUrl = potentialUrl.replace(/\\\//g, '/');
                    potentialUrl = potentialUrl.replace(/\\"/g, '"');
                    potentialUrl = potentialUrl.replace(/\\\\/g, '\\');
                    
                    // Check if it's a valid HTTP URL
                    if (potentialUrl.startsWith('http://') || potentialUrl.startsWith('https://')) {
                      // Make sure it's from Instagram CDN
                      if (potentialUrl.includes('cdninstagram.com') || potentialUrl.includes('fbcdn.net') || potentialUrl.includes('scontent')) {
                        videoUrl = potentialUrl;
                        break;
                      }
                    }
                  }
                }
              }
              
              // If regex didn't work, try to find and parse JSON structure containing video_versions
              if (!videoUrl) {
                // Find the position of video_versions
                const videoVersionsIndex = text.indexOf('"video_versions"');
                if (videoVersionsIndex !== -1) {
                  // Try to find the containing JSON object by looking backwards for opening brace
                  let startIdx = videoVersionsIndex;
                  let braceCount = 0;
                  let foundStart = false;
                  
                  // Look backwards for the start of the object
                  for (let i = videoVersionsIndex; i >= 0 && i >= videoVersionsIndex - 5000; i--) {
                    if (text[i] === '}') {
                      braceCount++;
                    } else if (text[i] === '{') {
                      if (braceCount === 0) {
                        startIdx = i;
                        foundStart = true;
                        break;
                      }
                      braceCount--;
                    }
                  }
                  
                  // Look forwards for the end of the object
                  if (foundStart) {
                    braceCount = 0;
                    let endIdx = startIdx;
                    for (let i = startIdx; i < text.length && i < startIdx + 10000; i++) {
                      if (text[i] === '{') {
                        braceCount++;
                      } else if (text[i] === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                          endIdx = i;
                          break;
                        }
                      }
                    }
                    
                    // Try to parse the extracted JSON
                    if (endIdx > startIdx) {
                      try {
                        const jsonStr = text.substring(startIdx, endIdx + 1);
                        const data = JSON.parse(jsonStr);
                        const found = findVideoUrl(data);
                        if (found) {
                          videoUrl = found;
                        }
                      } catch (e) {
                        // JSON parsing failed, continue
                      }
                    }
                  }
                }
              }
            }
            
            // Try to find JSON with video data (original method as fallback)
            if (!videoUrl && text.includes('video')) {
              const jsonMatches = text.match(/\{[^{}]*"video[^"]*"[^{}]*\}/g);
              if (jsonMatches) {
                for (const match of jsonMatches) {
                  try {
                    const data = JSON.parse(match);
                    const found = findVideoUrl(data);
                    if (found) {
                      videoUrl = found;
                      break;
                    }
                  } catch (e) {}
                }
              }
            }
          } catch (e) {
            console.error('Error parsing script for video URL:', e);
          }
        }
      }
    }
    
    // Log the dump to console
    console.log('=== INSTAGRAM PAGE DUMP ===');
    console.log('URL:', pageDump.url);
    console.log('Ready State:', pageDump.readyState);
    console.log('Videos found:', pageDump.videos.length);
    console.log('Videos:', pageDump.videos);
    console.log('Images found:', pageDump.images.length);
    console.log('Images:', pageDump.images);
    console.log('Scripts with video:', pageDump.scripts.length);
    console.log('Scripts:', pageDump.scripts);
    console.log('Window Data:', pageDump.windowData);
    console.log('HTML Snippet (first 50KB):', pageDump.htmlSnippet);
    console.log('=== END DUMP ===');
    
    // Also return the dump in the response
    if (videoUrl) {
      return { videoUrl, imageUrl, username, caption, pageDump };
    } else {
      return { error: 'Video URL not found on page', pageDump };
    }
  } catch (error) {
    return { error: `Extraction error: ${error.message}`, stack: error.stack };
  }
}

async function debugIndexedDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      // Get media store stats
      const mediaTransaction = db.transaction([STORE_MEDIA], "readonly");
      const mediaStore = mediaTransaction.objectStore(STORE_MEDIA);
      const mediaKeysRequest = mediaStore.getAllKeys();
      
      // Get posts
      const postsTransaction = db.transaction([STORE_POSTS], "readonly");
      const postsStore = postsTransaction.objectStore(STORE_POSTS);
      const postsRequest = postsStore.get("all_posts");
      
      // Get collections
      const collectionsTransaction = db.transaction([STORE_COLLECTIONS], "readonly");
      const collectionsStore = collectionsTransaction.objectStore(STORE_COLLECTIONS);
      const collectionsRequest = collectionsStore.get("all_collections");
      
      let mediaKeys = [];
      let posts = [];
      let collections = [];
      let completed = 0;
      
      const checkComplete = () => {
        completed++;
        if (completed === 3) {
          const mediaKeysArray = mediaKeys;
          const stats = {
            totalKeys: mediaKeysArray.length,
            imageKeys: mediaKeysArray.filter(k => k.startsWith('img_')).length,
            videoKeys: mediaKeysArray.filter(k => k.startsWith('vid_')).length,
            keys: mediaKeysArray.slice(0, 100), // First 100 keys
            sampleData: [],
            posts: {
              count: posts.length,
              data: posts
            },
            collections: {
              count: collections.length,
              data: collections
            }
          };
          
          // Get sample media data for first 5 items
          const sampleKeys = mediaKeysArray.slice(0, 5);
          if (sampleKeys.length === 0) {
            db.close();
            resolve(stats);
            return;
          }
          
          // Create a new transaction for getting sample data
          const sampleTransaction = db.transaction([STORE_MEDIA], "readonly");
          const sampleStore = sampleTransaction.objectStore(STORE_MEDIA);
          
          let samplesCollected = 0;
          for (const key of sampleKeys) {
            const getRequest = sampleStore.get(key);
            getRequest.onsuccess = () => {
              const blob = getRequest.result;
              if (blob) {
                stats.sampleData.push({
                  key: key,
                  type: blob.type,
                  size: blob.size,
                  sizeKB: (blob.size / 1024).toFixed(2)
                });
              }
              samplesCollected++;
              if (samplesCollected === sampleKeys.length) {
                db.close();
                resolve(stats);
              }
            };
            getRequest.onerror = () => {
              stats.sampleData.push({ key: key, error: 'Failed to retrieve' });
              samplesCollected++;
              if (samplesCollected === sampleKeys.length) {
                db.close();
                resolve(stats);
              }
            };
          }
        }
      };
      
      mediaKeysRequest.onsuccess = () => {
        mediaKeys = mediaKeysRequest.result;
        checkComplete();
      };
      mediaKeysRequest.onerror = () => {
        checkComplete();
      };
      
      postsRequest.onsuccess = () => {
        posts = postsRequest.result || [];
        checkComplete();
      };
      postsRequest.onerror = () => {
        checkComplete();
      };
      
      collectionsRequest.onsuccess = () => {
        collections = collectionsRequest.result || [];
        checkComplete();
      };
      collectionsRequest.onerror = () => {
        checkComplete();
      };
    });
  } catch (error) {
    console.error("Error debugging IndexedDB:", error);
    throw error;
  }
}

async function fetchImageAsDataURL(imageUrl) {
  try {
    const response = await fetch(imageUrl, { cache: "no-store" });
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
    console.error("Error fetching image:", error);
    throw error;
  }
}
