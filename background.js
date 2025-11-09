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
      
      // Create a hidden tab
      chrome.tabs.create({
        url: permalink,
        active: false
      }, (tab) => {
        try {
          if (chrome.runtime.lastError) {
            throw new Error(`Failed to create tab: ${chrome.runtime.lastError.message}`);
          }
          
          const tabId = tab.id;
          let attempts = 0;
          const maxAttempts = 20; // 10 seconds total (20 * 500ms)
          
          // Wait for page to load, then inject script to extract video
          // Instagram is a SPA, so we need to wait for content to load
          const checkTab = setInterval(() => {
            try {
              attempts++;
              chrome.tabs.get(tabId, (tabInfo) => {
                try {
                  if (chrome.runtime.lastError) {
                    clearInterval(checkTab);
                    sendResponse({ success: false, error: `Tab error: ${chrome.runtime.lastError.message}` });
                    return;
                  }
                  
                  // Wait for page to be complete and give it extra time for dynamic content
                  if (tabInfo.status === 'complete' && attempts >= 3) {
                    clearInterval(checkTab);
                    
                    // Wait a bit more for Instagram's JS to load video
                    setTimeout(() => {
                      try {
                        // First check if the page loaded correctly
                        chrome.tabs.get(tabId, (tabInfo) => {
                          if (chrome.runtime.lastError) {
                            chrome.tabs.remove(tabId, () => {});
                            sendResponse({ success: false, error: `Tab error: ${chrome.runtime.lastError.message}` });
                            return;
                          }
                          
                          // Check if URL is still Instagram and page is loaded
                          if (!tabInfo.url || !tabInfo.url.includes('instagram.com')) {
                            chrome.tabs.remove(tabId, () => {});
                            sendResponse({ success: false, error: `Page redirected or not accessible: ${tabInfo.url}` });
                            return;
                          }
                          
                          // Check if page is showing an error (chrome://error or similar)
                          if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('chrome-error://')) {
                            chrome.tabs.remove(tabId, () => {});
                            sendResponse({ success: false, error: `Page error: ${tabInfo.url}` });
                            return;
                          }
                          
                          // Inject script to extract video URL
                          chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            func: extractVideoUrl
                          }, (results) => {
                            try {
                              // Close the hidden tab
                              chrome.tabs.remove(tabId, () => {
                                // Ignore errors when closing
                              });
                              
                              if (chrome.runtime.lastError) {
                                const errorMsg = `Script injection error: ${chrome.runtime.lastError.message}`;
                                console.error(errorMsg);
                                sendResponse({ success: false, error: errorMsg });
                                return;
                              }
                              
                              if (!results || !results[0]) {
                                const errorMsg = 'Failed to extract video URL - no results from script';
                                console.error(errorMsg);
                                sendResponse({ success: false, error: errorMsg });
                                return;
                              }
                              
                              const videoUrl = results[0].result;
                              if (videoUrl) {
                                console.log('Successfully extracted video URL:', videoUrl.substring(0, 100));
                                sendResponse({ success: true, videoUrl });
                              } else {
                                const errorMsg = 'Video not found on page - extractVideoUrl returned null';
                                console.error(errorMsg);
                                sendResponse({ success: false, error: errorMsg });
                              }
                            } catch (error) {
                              console.error('Error in script injection callback:', error);
                              sendResponse({ success: false, error: `Script callback error: ${error.message}` });
                            }
                          });
                        });
                      } catch (error) {
                        console.error('Error executing script:', error);
                        chrome.tabs.remove(tabId, () => {});
                        sendResponse({ success: false, error: `Script execution error: ${error.message}` });
                      }
                    }, 2000); // Wait 2 seconds for dynamic content
                  }
                } catch (error) {
                  clearInterval(checkTab);
                  console.error('Error in tab check:', error);
                  chrome.tabs.remove(tabId, () => {});
                  sendResponse({ success: false, error: `Tab check error: ${error.message}` });
                }
              });
              
              // Timeout after max attempts
              if (attempts >= maxAttempts) {
                clearInterval(checkTab);
                chrome.tabs.get(tabId, () => {
                  if (!chrome.runtime.lastError) {
                    chrome.tabs.remove(tabId);
                  }
                });
                sendResponse({ success: false, error: 'Timeout waiting for page to load' });
              }
            } catch (error) {
              clearInterval(checkTab);
              console.error('Error in checkTab interval:', error);
              chrome.tabs.remove(tabId, () => {});
              sendResponse({ success: false, error: `Interval error: ${error.message}` });
            }
          }, 500);
        } catch (error) {
          console.error('Error in tab creation callback:', error);
          sendResponse({ success: false, error: `Tab creation callback error: ${error.message}` });
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
function extractVideoUrl() {
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
  
  for (const selector of videoSelectors) {
    const video = document.querySelector(selector);
    if (video) {
      // Try src attribute first
      if (video.src && video.src.startsWith('http') && !video.src.includes('blob:')) {
        return video.src;
      }
      
      // Try source element
      const source = video.querySelector('source');
      if (source && source.src && source.src.startsWith('http')) {
        return source.src;
      }
      
      // Try currentSrc
      if (video.currentSrc && video.currentSrc.startsWith('http') && !video.currentSrc.includes('blob:')) {
        return video.currentSrc;
      }
    }
  }
  
  // Try to find in window.__additionalDataLoaded (Instagram's data structure)
  const findVideoUrl = (obj, depth = 0) => {
    if (depth > 10) return null; // Prevent infinite recursion
    if (typeof obj !== 'object' || obj === null) return null;
    
    // Check common video URL fields
    if (obj.video_url && typeof obj.video_url === 'string' && obj.video_url.startsWith('http')) {
      return obj.video_url;
    }
    if (obj.videoUrl && typeof obj.videoUrl === 'string' && obj.videoUrl.startsWith('http')) {
      return obj.videoUrl;
    }
    if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
      const videoVersion = obj.video_versions.find(v => v.url && v.url.startsWith('http'));
      if (videoVersion) return videoVersion.url;
    }
    if (obj.video_versions && Array.isArray(obj.video_versions) && obj.video_versions[0]?.url) {
      return obj.video_versions[0].url;
    }
    
    // Recursively search
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const result = findVideoUrl(obj[key], depth + 1);
        if (result) return result;
      }
    }
    return null;
  };
  
  // Check window.__additionalDataLoaded
  if (window.__additionalDataLoaded) {
    try {
      const url = findVideoUrl(window.__additionalDataLoaded);
      if (url) return url;
    } catch (e) {
      // Ignore errors
    }
  }
  
  // Check window._sharedData
  if (window._sharedData) {
    try {
      const url = findVideoUrl(window._sharedData);
      if (url) return url;
    } catch (e) {
      // Ignore errors
    }
  }
  
  // Check all script tags for JSON data
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent && script.textContent.includes('video')) {
      try {
        // Try to find JSON in script
        const jsonMatch = script.textContent.match(/\{.*"video[^"]*"[^}]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          const url = findVideoUrl(data);
          if (url) return url;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
  
  return null;
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
