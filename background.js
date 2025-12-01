let capturedImages = [];
let extensionTabId = null;
let activeInstagramTabId = null;

// Mutex for preventing race conditions in batch saves
let batchSaveLock = Promise.resolve();

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

// Function kept for manual user-initiated sync only
function checkForSavedProgress(tabId = null) {
  chrome.storage.local.get(["instagram_sync_progress"], (result) => {
    if (result.instagram_sync_progress) {
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: "SHOW_SYNC_DRAWER" }, (response) => {
          if (chrome.runtime.lastError) {
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: "SHOW_SYNC_DRAWER" });
            }, 2000);
          }
        });
      } else {
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
  chrome.tabs.query({ url: chrome.runtime.getURL("index.html") }, (tabs) => {
    if (tabs.length > 0) {
      const activeTab = tabs.find(tab => tab.active) || tabs[0];
      if (activeTab) {
        extensionTabId = activeTab.id;
      }
      
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
    return true;
  } else if (request.action === "GET_CAPTURED_IMAGES") {
    sendResponse(capturedImages);
  } else if (request.action === "OPEN_MAIN_VIEWER") {
    if (extensionTabId !== null) {
      chrome.tabs.get(extensionTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          chrome.tabs.create(
            { url: chrome.runtime.getURL("index.html") },
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
        { url: chrome.runtime.getURL("index.html") },
        (newTab) => {
          extensionTabId = newTab.id;
        }
      );
    }
  } else if (request.action === "GET_INSTAGRAM_POSTS") {
    // Paginated post retrieval
    const page = request.page || 1;
    const limit = request.limit || 50;
    const sortBy = request.sortBy || 'newest';
    const filterType = request.filterType || 'all';
    const searchQuery = request.searchQuery || '';
    
    getPostsPaginated(page, limit, sortBy, filterType, searchQuery).then((result) => {
      sendResponse({ 
        success: true, 
        posts: result.posts,
        total: result.total,
        hasMore: result.hasMore,
        page: result.page
      });
    }).catch((error) => {
      console.error("Error retrieving posts:", error);
      sendResponse({ success: false, error: error.message, posts: [], total: 0 });
    });
    return true;
  } else if (request.action === "GET_COLLECTIONS") {
    getCollectionsFromIndexedDB().then((collections) => {
      sendResponse({ success: true, collections });
    }).catch((error) => {
      console.error("Error retrieving collections:", error);
      sendResponse({ success: false, error: error.message, collections: [] });
    });
    return true;
  } else if (request.action === "GET_POSTS_COUNT") {
    // O(1) count retrieval from metadata
    getPostsCount().then((count) => {
      sendResponse({ count });
    }).catch((error) => {
      console.error("Error getting posts count:", error);
      sendResponse({ count: 0 });
    });
    return true;
  } else if (request.action === "GET_POSTS_INFO") {
    // Get count and check if specific IDs exist
    getPostsMetadata().then((metadata) => {
      sendResponse({ 
        count: metadata.count, 
        ids: metadata.ids,
        links: metadata.links
      });
    }).catch((error) => {
      console.error("Error getting posts info:", error);
      sendResponse({ count: 0, ids: [], links: [] });
    });
    return true;
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
      chrome.storage.local.get(["instagram_sync_progress"], (result) => {
        const isResuming = result.instagram_sync_progress !== undefined;
        
        chrome.tabs.sendMessage(activeInstagramTabId, { action: "SHOW_SYNC_DRAWER" }, () => {});
        
        chrome.runtime.sendMessage({ action: "SYNC_STARTED" });

        if (!isResuming) {
          Promise.resolve().then(() => {
            chrome.tabs.sendMessage(activeInstagramTabId, {
              action: "IMPORT_INSTAGRAM_POSTS",
            });
          }).catch(() => {
            chrome.tabs.sendMessage(activeInstagramTabId, {
              action: "IMPORT_INSTAGRAM_POSTS",
            });
          });
        } else {
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
    // Use mutex to prevent race conditions
    batchSaveLock = batchSaveLock.then(async () => {
      try {
        const newPosts = request.posts
          .filter(post => post && typeof post === "object" && post.url)
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
            };
          })
          .filter(Boolean);
        
        if (newPosts.length === 0) {
          sendResponse({ success: true, added: 0 });
          return;
        }
        
        // Add posts individually (handles duplicates internally)
        const addedCount = await addPostsToIndexedDB(newPosts);
        
        // Update extension tab
        updateExtensionTab();
        sendResponse({ success: true, added: addedCount });
      } catch (error) {
        console.error("Error saving batch:", error);
        sendResponse({ success: false, error: error.message });
      }
    }).catch((error) => {
      console.error("Error in batch save lock:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (request.action === "SAVE_COLLECTIONS") {
    storeCollectionsInIndexedDB(request.collections).then(() => {
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
    const { key, blob, type, size } = request;
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
      console.error("Error creating blob:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  } else if (request.action === "FETCH_AND_STORE_THUMBNAIL") {
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
  } else if (request.action === "FETCH_VIDEO_CDN") {
    try {
      const { permalink, postId } = request;
      
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
      let videoTabId = null;
      
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
          videoTabId = tab.id;
          
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
        
      function processTab(tabId, isNewTab) {
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
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                            safeSendResponse({ success: false, error: `Tab error: ${error}` });
                            return;
                          }
                          
                          if (!tabInfo.url || !tabInfo.url.includes('instagram.com')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                            safeSendResponse({ success: false, error: `Page redirected` });
                            return;
                          }
                          
                          if (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('chrome-error://')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                            safeSendResponse({ success: false, error: `Page error` });
                            return;
                          }
                          
                          if (tabInfo.url && !tabInfo.url.includes('/p/') && !tabInfo.url.includes('/reel/')) {
                            if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
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
                              if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                              safeSendResponse({ success: false, error: `Page not accessible` });
                              return;
                            }
                            
                            if (!testResults || !testResults[0] || testResults[0].result?.error) {
                              if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                              safeSendResponse({ success: false, error: 'Page validation failed' });
                              return;
                            }
                            
                            chrome.scripting.executeScript({
                              target: { tabId: tabId, allFrames: false },
                              func: extractFromRenderedPage
                            }, (results) => {
                              try {
                                if (chrome.runtime.lastError) {
                                  if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                                  safeSendResponse({ success: false, error: `Script error` });
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
                        if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
                        safeSendResponse({ success: false, error: error.message });
                      }
                    }, 3000);
                  }
                } catch (error) {
                  clearInterval(checkTab);
                  cleanupListeners();
                  if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
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
              if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
              safeSendResponse({ success: false, error: error.message });
            }
          }, 500);
        } catch (error) {
          cleanupListeners();
          if (shouldCloseTab) chrome.tabs.remove(tabId, () => {});
          safeSendResponse({ success: false, error: error.message });
        }
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    
    return true;
  } else if (request.action === "FETCH_CAROUSEL_VIDEO") {
    // Fetch video from a carousel post
    try {
      const { permalink, postId, carouselIndex } = request;
      
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
                  chrome.tabs.remove(tabId, () => {});
                  
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
              chrome.tabs.remove(tabId, () => {});
              safeSendResponse({ success: false, error: 'Timeout' });
            }
          });
        }, 500);
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  } else if (request.action === "FETCH_FULL_IMAGE") {
    // Fetch full-resolution image from Instagram post page
    try {
      const { permalink, postId } = request;
      
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
                  chrome.tabs.remove(tabId, () => {});
                  
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
              chrome.tabs.remove(tabId, () => {});
              safeSendResponse({ success: false, error: 'Timeout' });
            }
          });
        }, 500);
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  } else if (request.action === "CLEAR_STORAGE") {
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
  } else if (request.action === "CHECK_POST_EXISTS") {
    // Quick check if a post exists by ID or link
    checkPostExists(request.postId, request.link).then((exists) => {
      sendResponse({ exists });
    }).catch(() => {
      sendResponse({ exists: false });
    });
    return true;
  }

  return true;
});

// IndexedDB configuration
const DB_NAME = "instagram_media_db";
const DB_VERSION = 3; // Increment for new schema
const STORE_MEDIA = "media";
const STORE_POSTS = "posts";
const STORE_POSTS_INDEX = "posts_index"; // New index store
const STORE_COLLECTIONS = "collections";
const STORE_METADATA = "metadata"; // New metadata store

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
        postsStore.createIndex('isVideo', 'isVideo', { unique: false });
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

// Add posts individually with duplicate checking
async function addPostsToIndexedDB(posts) {
  let db;
  try {
    db = await openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS, STORE_POSTS_INDEX, STORE_METADATA], "readwrite");
      const postsStore = transaction.objectStore(STORE_POSTS);
      const indexStore = transaction.objectStore(STORE_POSTS_INDEX);
      const metaStore = transaction.objectStore(STORE_METADATA);
      
      let addedCount = 0;
      let processedCount = 0;
      
      // Get current index
      const getIndexRequest = indexStore.get('post_ids');
      getIndexRequest.onsuccess = () => {
        const existingIds = new Set(getIndexRequest.result || []);
        const existingLinks = new Set();
        
        // Get existing links
        const getLinksRequest = indexStore.get('post_links');
        getLinksRequest.onsuccess = () => {
          const links = getLinksRequest.result || [];
          links.forEach(l => existingLinks.add(l));
          
          // Process each post
          posts.forEach((post) => {
            // Check for duplicates
            if (existingIds.has(post.id) || existingLinks.has(post.link)) {
              processedCount++;
              checkComplete();
              return;
            }
            
            // Add the post
            const addRequest = postsStore.put(post);
            addRequest.onsuccess = () => {
              addedCount++;
              existingIds.add(post.id);
              if (post.link) existingLinks.add(post.link);
              processedCount++;
              checkComplete();
            };
            addRequest.onerror = () => {
              processedCount++;
              checkComplete();
            };
          });
          
          if (posts.length === 0) {
            checkComplete();
          }
        };
        
        function checkComplete() {
          if (processedCount === posts.length) {
            // Update index
            indexStore.put([...existingIds], 'post_ids');
            indexStore.put([...existingLinks], 'post_links');
            
            // Update count in metadata
            metaStore.put(existingIds.size, 'posts_count');
          }
        }
      };
      
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
      const transaction = db.transaction([STORE_METADATA], "readonly");
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
      const transaction = db.transaction([STORE_POSTS], "readonly");
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

// Get posts metadata (IDs and links for duplicate checking)
async function getPostsMetadata() {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_POSTS_INDEX, STORE_METADATA], "readonly");
      const indexStore = transaction.objectStore(STORE_POSTS_INDEX);
      const metaStore = transaction.objectStore(STORE_METADATA);
      
      let count = 0;
      let ids = [];
      let links = [];
      
      const countRequest = metaStore.get('posts_count');
      countRequest.onsuccess = () => {
        count = countRequest.result || 0;
      };
      
      const idsRequest = indexStore.get('post_ids');
      idsRequest.onsuccess = () => {
        ids = idsRequest.result || [];
      };
      
      const linksRequest = indexStore.get('post_links');
      linksRequest.onsuccess = () => {
        links = linksRequest.result || [];
      };
      
      transaction.oncomplete = () => {
        db.close();
        resolve({ count, ids, links });
      };
      transaction.onerror = () => {
        db.close();
        resolve({ count: 0, ids: [], links: [] });
      };
    });
  } catch (error) {
    if (db) db.close();
    return { count: 0, ids: [], links: [] };
  }
}

// Check if a post exists
async function checkPostExists(postId, link) {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_POSTS_INDEX], "readonly");
      const store = transaction.objectStore(STORE_POSTS_INDEX);
      
      const idsRequest = store.get('post_ids');
      idsRequest.onsuccess = () => {
        const ids = new Set(idsRequest.result || []);
        if (postId && ids.has(postId)) {
          db.close();
          resolve(true);
          return;
        }
        
        if (link) {
          const linksRequest = store.get('post_links');
          linksRequest.onsuccess = () => {
            const links = new Set(linksRequest.result || []);
            db.close();
            resolve(links.has(link));
          };
          linksRequest.onerror = () => {
            db.close();
            resolve(false);
          };
        } else {
          db.close();
          resolve(false);
        }
      };
      idsRequest.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch (error) {
    if (db) db.close();
    return false;
  }
}

// Get posts with pagination, sorting, and filtering
async function getPostsPaginated(page = 1, limit = 50, sortBy = 'newest', filterType = 'all', searchQuery = '') {
  let db;
  try {
    db = await openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_POSTS], "readonly");
      const store = transaction.objectStore(STORE_POSTS);
      
      const allPosts = [];
      const cursorRequest = store.openCursor();
      
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const post = cursor.value;
          
          // Apply type filter
          if (filterType === 'photo' && post.isVideo) {
            cursor.continue();
            return;
          }
          if (filterType === 'video' && !post.isVideo) {
            cursor.continue();
            return;
          }
          
          // Apply search filter
          if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            const titleMatch = (post.title || '').toLowerCase().includes(searchLower);
            const usernameMatch = (post.username || '').toLowerCase().includes(searchLower);
            if (!titleMatch && !usernameMatch) {
              cursor.continue();
              return;
            }
          }
          
          allPosts.push(post);
          cursor.continue();
        } else {
          // All posts collected, now sort
          if (sortBy === 'newest') {
            allPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          } else if (sortBy === 'oldest') {
            allPosts.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          } else if (sortBy === 'random') {
            // Fisher-Yates shuffle
            for (let i = allPosts.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [allPosts[i], allPosts[j]] = [allPosts[j], allPosts[i]];
            }
          }
          
          const total = allPosts.length;
          const startIdx = (page - 1) * limit;
          const endIdx = startIdx + limit;
          const paginatedPosts = allPosts.slice(startIdx, endIdx);
          
          db.close();
          resolve({
            posts: paginatedPosts,
            total,
            hasMore: endIdx < total,
            page
          });
        }
      };
      
      cursorRequest.onerror = () => {
        db.close();
        reject(cursorRequest.error);
      };
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
      const transaction = db.transaction([STORE_MEDIA], "readwrite");
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
      const transaction = db.transaction([STORE_COLLECTIONS], "readwrite");
      const store = transaction.objectStore(STORE_COLLECTIONS);
      const request = store.put(collections, "all_collections");
      
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
    if (db) db.close();
    return [];
  }
}

async function getMediaFromIndexedDB(key) {
  let db;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_MEDIA], "readonly");
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

// Extract video from carousel at specific index
function extractCarouselVideo(carouselIndex) {
  try {
    // Instagram carousels have navigation buttons and multiple media items
    // First, try to navigate to the correct item
    const nextButtons = document.querySelectorAll('button[aria-label="Next"], button[aria-label="Go forward"]');
    const carouselContainer = document.querySelector('article');
    
    // Click through carousel to get to the right index
    // This is a workaround since Instagram lazy-loads carousel items
    let clicksNeeded = carouselIndex;
    
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
    
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
      } catch (e) {}
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
      } catch (e) {}
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
        const match = href.match(/instagram\.com\/([^\/\?]+)/);
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
      } catch (e) {}
    }
    
    if (!videoUrl && window._sharedData) {
      try {
        videoUrl = findVideoUrl(window._sharedData);
      } catch (e) {}
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
              } catch (e) {}
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
                  /"url"\s*:\s*"(https?[^"]+)"/,
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
          } catch (e) {}
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
