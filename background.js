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
  if (extensionTabId !== null) {
    chrome.tabs.get(extensionTabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.log("Extension tab not found, creating new tab");
        chrome.tabs.create(
          { url: chrome.runtime.getURL("index.html") },
          (newTab) => {
            extensionTabId = newTab.id;
          }
        );
      } else {
        // Send message to extension tab to update display
        chrome.tabs.sendMessage(extensionTabId, { action: "UPDATE_ITEMS" }, () => {
          if (chrome.runtime.lastError) {
            // Extension tab might not be ready, that's okay
          }
        });
      }
    });
  } else {
    console.log("No extension tab found, creating new tab");
    chrome.tabs.create(
      { url: chrome.runtime.getURL("index.html") },
      (newTab) => {
        extensionTabId = newTab.id;
      }
    );
  }
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
    // Retrieve posts and convert IndexedDB keys to data URLs for display
    chrome.storage.local.get(["instagramSavedPosts"], async (result) => {
      let posts = [];
      try {
        posts = result.instagramSavedPosts ? JSON.parse(result.instagramSavedPosts) : [];
      } catch (error) {
        console.error("Error parsing posts:", error);
        sendResponse({ success: false, error: error.message });
        return;
      }
      
      // Convert IndexedDB keys to data URLs on-demand
      const formattedPosts = await Promise.all(
        posts.map(post => formatInstagramPostObj(post))
      );
      
      sendResponse({ success: true, posts: formattedPosts });
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
          chrome.storage.local.set(
            {
              instagramSavedPosts: JSON.stringify([]),
            },
            () => {
              chrome.tabs.sendMessage(activeInstagramTabId, {
                action: "IMPORT_INSTAGRAM_POSTS",
              });
            }
          );
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
    // Save batch of posts by appending to existing posts
    chrome.storage.local.get(["instagramSavedPosts"], async (result) => {
      let existingPosts = [];
      try {
        existingPosts = result.instagramSavedPosts
          ? JSON.parse(result.instagramSavedPosts)
          : [];
      } catch (error) {
        console.error("Error parsing existing posts:", error);
      }

      // Store posts with IndexedDB key references (small) - don't convert to data URLs yet
      // The conversion will happen on-demand when displaying posts
      const newPosts = request.posts.map((post) => {
        if (!post || typeof post !== "object") {
          return null;
        }
        const { url, title, thumbnail, username, collectionIds, isVideo, videoUrl } = post;
        return {
          id: post.id || `${username}-${Date.now()}`,
          link: url,
          image: thumbnail, // Keep IndexedDB key reference (e.g., "idb:img_123")
          title,
          username,
          collectionIds,
          isVideo,
          videoUrl, // Keep IndexedDB key reference (e.g., "idb:vid_123")
        };
      }).filter(Boolean);
      const allPosts = [...existingPosts, ...newPosts];

      chrome.storage.local.set(
        {
          instagramSavedPosts: JSON.stringify(allPosts),
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              "Error saving batch to storage:",
              chrome.runtime.lastError
            );
            sendResponse({ success: false });
          } else {
            console.log(`Saved batch of ${newPosts.length} posts. Total: ${allPosts.length}`);
            // Update extension tab to show new posts
            updateExtensionTab();
            sendResponse({ success: true });
          }
        }
      );
    });
    return true; // Async response
  } else if (request.action === "SAVE_COLLECTIONS") {
    chrome.storage.local.set(
      {
        instagramCollections: JSON.stringify(request.collections),
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error saving collections:",
            chrome.runtime.lastError
          );
        } else {
          console.log(`Saved ${request.collections.length} collections`);
        }
      }
    );
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
const DB_VERSION = 1;
const STORE_NAME = "media";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function storeMediaInIndexedDB(key, blob) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
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

async function getMediaFromIndexedDB(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      
      request.onsuccess = () => {
        const blob = request.result;
        if (blob) {
          // Convert blob to data URL for display
          const reader = new FileReader();
          reader.onloadend = () => {
            db.close();
            resolve(reader.result);
          };
          reader.onerror = () => {
            console.error(`FileReader error for key: ${key}`);
            db.close();
            reject(new Error('FileReader failed'));
          };
          reader.readAsDataURL(blob);
        } else {
          console.warn(`No blob found in IndexedDB for key: ${key}`);
          // Try to list all keys to debug (but don't wait for it)
          const getAllRequest = store.getAllKeys();
          getAllRequest.onsuccess = () => {
            const keys = getAllRequest.result;
            const matchingKeys = keys.filter(k => {
              const keyPart = key.split('_').slice(1).join('_');
              return k.includes(keyPart) || key.includes(k.split('_').slice(1).join('_'));
            });
            console.log(`Available keys sample (first 20):`, keys.slice(0, 20));
            console.log(`Looking for key: ${key}`);
            if (matchingKeys.length > 0) {
              console.log(`Found similar keys:`, matchingKeys.slice(0, 10));
            } else {
              console.log(`No similar keys found. Key format might be different.`);
            }
          };
          db.close();
          resolve(null);
        }
      };
      request.onerror = () => {
        console.error(`IndexedDB get error for key: ${key}`, request.error);
        reject(request.error);
        db.close();
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

  const { url, title, thumbnail, username, collectionIds, isVideo, videoUrl, timestamp } = post;
  
  // URLs are now stored directly, but check for legacy IndexedDB keys for backward compatibility
  let imageUrl = thumbnail;
  let videoUrlFinal = videoUrl;
  
  // Backward compatibility: Check if thumbnail/videoUrl are IndexedDB keys
  if (thumbnail && typeof thumbnail === 'string' && thumbnail.startsWith("idb:")) {
    const dbKey = thumbnail.substring(4);
    const dataUrl = await getMediaFromIndexedDB(dbKey);
    if (dataUrl) {
      imageUrl = dataUrl;
    } else {
      // If IndexedDB retrieval fails, fallback to Instagram CDN or permalink
      imageUrl = null;
    }
  }
  
  if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith("idb:")) {
    const dbKey = videoUrl.substring(4);
    const dataUrl = await getMediaFromIndexedDB(dbKey);
    if (dataUrl) {
      videoUrlFinal = dataUrl;
    } else {
      videoUrlFinal = null;
    }
  }
  
  return {
    id: post.id || `${username}-${Date.now()}`,
    link: url,
    image: imageUrl, // Direct CDN URL or data URL (for legacy)
    title,
    username,
    collectionIds,
    isVideo,
    videoUrl: videoUrlFinal, // Direct CDN URL or data URL (for legacy)
    timestamp: timestamp || Date.now(),
  };
}

async function debugIndexedDB() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const getAllRequest = store.getAllKeys();
      
      getAllRequest.onsuccess = async () => {
        const keys = getAllRequest.result;
        const stats = {
          totalKeys: keys.length,
          imageKeys: keys.filter(k => k.startsWith('img_')).length,
          videoKeys: keys.filter(k => k.startsWith('vid_')).length,
          keys: keys.slice(0, 100), // First 100 keys
          sampleData: []
        };
        
        // Get sample data for first 5 items
        const sampleKeys = keys.slice(0, 5);
        for (const key of sampleKeys) {
          const getRequest = store.get(key);
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
            
            // When all samples are collected, resolve
            if (stats.sampleData.length === sampleKeys.length) {
              db.close();
              resolve(stats);
            }
          };
          getRequest.onerror = () => {
            stats.sampleData.push({ key: key, error: 'Failed to retrieve' });
            if (stats.sampleData.length === sampleKeys.length) {
              db.close();
              resolve(stats);
            }
          };
        }
        
        // If no keys, resolve immediately
        if (keys.length === 0) {
          db.close();
          resolve(stats);
        }
      };
      
      getAllRequest.onerror = () => {
        db.close();
        reject(getAllRequest.error);
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
