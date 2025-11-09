let postsCount = 0;
let syncedCount = 0;
let failedCount = 0;
let isSyncing = false;

const defaultRequest = {
  headers: {
    accept: "*/*",
    "sec-ch-ua-mobile": "?0",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "sec-gpc": "1",
    "x-ig-app-id": "936619743392459",
    "x-asbd-id": "198387",
    "x-requested-with": "XMLHttpRequest",
  },
  referrer: "https://www.instagram.com/",
  credentials: "include",
  mode: "cors",
};

const BATCH_SIZE = 21; // Save after each API page (Instagram returns 21 posts per request)
const SYNC_PROGRESS_KEY = "instagram_sync_progress";

function createSyncDrawer() {
  const drawer = document.createElement("div");
  drawer.id = "instagram-sync-drawer";
  drawer.style.cssText = `
    position: fixed;
    top: 0;
    right: -380px;
    width: 380px;
    height: 100%;
    background: var(--bg-primary, #1a1a1a);
    color: var(--text-primary, #ffffff);
    box-shadow: -4px 0 12px rgba(0,0,0,0.5);
    transition: right 0.3s ease;
    z-index: 10000;
    padding: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  `;

  // Header with gradient
  const header = document.createElement("div");
  header.style.cssText = `
    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
    color: white;
    padding: 24px 20px;
    border-bottom: 1px solid var(--border, #363636);
  `;
  
  const heading = document.createElement("h2");
  heading.textContent = "Sync Instagram Saved Posts";
  heading.style.cssText = `
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: white;
  `;
  header.appendChild(heading);
  
  const contentWrapper = document.createElement("div");
  contentWrapper.style.cssText = `
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: var(--bg-primary, #1a1a1a);
    color: var(--text-primary, #ffffff);
  `;

  // Check if there's saved progress
  chrome.storage.local.get([SYNC_PROGRESS_KEY], (result) => {
    if (result[SYNC_PROGRESS_KEY]) {
      const progress = result[SYNC_PROGRESS_KEY];
      const resumeInfo = document.createElement("p");
      resumeInfo.id = "resume-info";
      resumeInfo.style.cssText = `
        margin-bottom: 0;
        padding: 12px;
        background-color: rgba(240, 148, 51, 0.2);
        border-left: 3px solid var(--accent-orange, #f09433);
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.6;
        color: var(--accent-orange, #f09433);
      `;
      resumeInfo.innerHTML = `
        <strong>⚠️ Resume available</strong><br>
        Previous sync: ${progress.synced} synced, ${progress.failed} failed<br>
        <span style="font-size: 11px; opacity: 0.8;">${new Date(progress.timestamp).toLocaleString()}</span>
      `;
      contentWrapper.insertBefore(resumeInfo, contentWrapper.firstChild);
      
      // Add clear progress button
      const clearButton = document.createElement("button");
      clearButton.id = "clear-progress-button";
      clearButton.textContent = "Clear & Start Fresh";
      clearButton.style.cssText = `
        padding: 6px 12px;
        background-color: transparent;
        color: var(--accent-orange, #f09433);
        border: 1px solid var(--accent-orange, #f09433);
        border-radius: 6px;
        cursor: pointer;
        margin-top: 8px;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
      `;
      clearButton.addEventListener('mouseenter', () => {
        clearButton.style.background = 'rgba(240, 148, 51, 0.3)';
      });
      clearButton.addEventListener('mouseleave', () => {
        clearButton.style.background = 'transparent';
      });
      clearButton.addEventListener("click", () => {
        if (confirm("Clear saved progress and start fresh? This will reset the sync.")) {
          chrome.storage.local.remove([SYNC_PROGRESS_KEY], () => {
            resumeInfo.remove();
            clearButton.remove();
          });
        }
      });
      resumeInfo.appendChild(clearButton);
    }
  });

  const syncButton = document.createElement("button");
  syncButton.id = "sync-button";
  
  // Check for existing posts in database to determine button text and style
  chrome.storage.local.get(["instagramSavedPosts", SYNC_PROGRESS_KEY], (result) => {
    let hasExistingPosts = false;
    try {
      const postsData = result.instagramSavedPosts;
      if (postsData) {
        const posts = JSON.parse(postsData);
        hasExistingPosts = Array.isArray(posts) && posts.length > 0;
      }
    } catch (error) {
      console.error("Error checking existing posts:", error);
    }
    
    // Show resume if there are existing posts OR saved progress
    const hasProgress = result[SYNC_PROGRESS_KEY];
    const shouldResume = hasExistingPosts || hasProgress;
    
    if (shouldResume) {
      syncButton.textContent = "Resume Sync";
      syncButton.style.cssText = `
        padding: 12px 20px;
        background: var(--accent-orange, #f09433);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.2s;
        width: 100%;
        box-shadow: 0 2px 8px rgba(240, 148, 51, 0.3);
      `;
    } else {
      syncButton.textContent = "Start Sync";
      syncButton.style.cssText = `
        padding: 12px 20px;
        background: var(--accent-solid, #e1306c);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.2s;
        width: 100%;
        box-shadow: 0 2px 8px rgba(225, 48, 108, 0.3);
      `;
    }
  });
  
  syncButton.addEventListener('mouseenter', () => {
    if (!syncButton.disabled) {
      const isResume = syncButton.textContent === "Resume Sync";
      if (isResume) {
        syncButton.style.background = '#d97706';
        syncButton.style.boxShadow = '0 4px 12px rgba(240, 148, 51, 0.4)';
      } else {
        syncButton.style.background = 'var(--accent-hover, #c91c56)';
        syncButton.style.boxShadow = '0 4px 12px rgba(225, 48, 108, 0.4)';
      }
      syncButton.style.transform = 'translateY(-1px)';
    }
  });
  syncButton.addEventListener('mouseleave', () => {
    if (!syncButton.disabled) {
      const isResume = syncButton.textContent === "Resume Sync";
      if (isResume) {
        syncButton.style.background = 'var(--accent-orange, #f09433)';
        syncButton.style.boxShadow = '0 2px 8px rgba(240, 148, 51, 0.3)';
      } else {
        syncButton.style.background = 'var(--accent-solid, #e1306c)';
        syncButton.style.boxShadow = '0 2px 8px rgba(225, 48, 108, 0.3)';
      }
      syncButton.style.transform = 'translateY(0)';
    }
  });

  syncButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "START_SYNC" });
    syncButton.textContent = "Syncing...";
    syncButton.disabled = true;
    
    // Add stop button
    const stopButton = document.createElement("button");
    stopButton.id = "stop-sync-button";
    stopButton.textContent = "Stop Sync";
    stopButton.style.cssText = `
      padding: 12px 20px;
      background-color: var(--error, #ed4956);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
      width: 100%;
      box-shadow: 0 2px 8px rgba(237, 73, 86, 0.3);
    `;
    stopButton.addEventListener('mouseenter', () => {
      if (!stopButton.disabled) {
        stopButton.style.background = '#dc2626';
        stopButton.style.transform = 'translateY(-1px)';
        stopButton.style.boxShadow = '0 4px 12px rgba(237, 73, 86, 0.4)';
      }
    });
    stopButton.addEventListener('mouseleave', () => {
      if (!stopButton.disabled) {
        stopButton.style.background = 'var(--error, #ed4956)';
        stopButton.style.transform = 'translateY(0)';
        stopButton.style.boxShadow = '0 2px 8px rgba(237, 73, 86, 0.3)';
      }
    });
    stopButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "STOP_SYNC" });
      stopButton.disabled = true;
      stopButton.textContent = "Stopping...";
    });
    syncButton.insertAdjacentElement('afterend', stopButton);
  });

  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    width: 32px;
    height: 32px;
    background: rgba(0, 0, 0, 0.2);
    border: none;
    border-radius: 50%;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.background = 'rgba(0, 0, 0, 0.3)';
  });
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.background = 'rgba(0, 0, 0, 0.2)';
  });

  closeButton.addEventListener("click", () => {
    drawer.style.right = "-380px";
  });

  const progressElement = document.createElement("p");
  progressElement.id = "sync-progress";
  progressElement.style.cssText = `
    margin: 0;
    font-size: 14px;
    color: var(--text-primary, #ffffff);
    font-weight: 500;
  `;

  const statsElement = document.createElement("div");
  statsElement.id = "sync-stats";
  statsElement.style.cssText = `
    padding: 16px;
    background: #f5f5f5;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.8;
  `;

  drawer.appendChild(header);
  header.appendChild(closeButton);
  drawer.appendChild(contentWrapper);
  contentWrapper.appendChild(syncButton);
  contentWrapper.appendChild(progressElement);
  contentWrapper.appendChild(statsElement);
  document.body.appendChild(drawer);

  return drawer;
}

function updateSyncDrawer(syncedCount, failedCount, wasStopped = false) {
  const drawer = document.getElementById("instagram-sync-drawer");
  if (drawer) {
    const syncButton = drawer.querySelector("#sync-button");
    if (syncButton) {
      if (wasStopped) {
        syncButton.style.backgroundColor = "#f59e0b";
        syncButton.textContent = "Resume Sync";
        syncButton.disabled = false;
        
        // Remove old event listeners by cloning
        const newSyncButton = syncButton.cloneNode(true);
        syncButton.parentNode.replaceChild(newSyncButton, syncButton);
        newSyncButton.id = "sync-button";
        
        newSyncButton.addEventListener("click", () => {
          chrome.runtime.sendMessage({ action: "START_SYNC" });
          newSyncButton.textContent = "Syncing...";
          newSyncButton.disabled = true;
          newSyncButton.style.backgroundColor = "#0095f6";
        });
        
        // Re-add hover effects
        newSyncButton.addEventListener('mouseenter', () => {
          if (!newSyncButton.disabled) {
            newSyncButton.style.background = '#d97706';
          }
        });
        newSyncButton.addEventListener('mouseleave', () => {
          if (!newSyncButton.disabled) {
            newSyncButton.style.background = '#f59e0b';
          }
        });
      } else {
        syncButton.textContent = "Sync Complete";
        syncButton.disabled = true;
        syncButton.style.backgroundColor = "#0095f6";
      }
    }

    const stopButton = drawer.querySelector("#stop-sync-button");
    if (stopButton) {
      stopButton.remove();
    }

    const progressElement = drawer.querySelector("#sync-progress");
    if (progressElement) {
      const totalCount = syncedCount + failedCount;
      if (wasStopped) {
        progressElement.textContent = `Sync paused. Processed ${totalCount} posts so far.`;
      } else {
        progressElement.textContent = `Sync complete! Processed ${totalCount} posts.`;
      }
      progressElement.style.color = "";
    }

      const statsElement = drawer.querySelector("#sync-stats");
      if (statsElement) {
        statsElement.innerHTML = `
          <div style="color: var(--success, #42c767);"><strong>✓ Synced:</strong> ${syncedCount}</div>
          <div style="color: ${failedCount > 0 ? 'var(--error, #ed4956)' : 'var(--text-secondary, #a8a8a8)'}"><strong>✗ Failed:</strong> ${failedCount}</div>
          ${wasStopped ? '<div style="margin-top: 8px; font-size: 12px; opacity: 0.8; color: var(--text-secondary, #a8a8a8);">Progress saved. You can resume later.</div>' : ''}
        `;
      }

    const contentWrapper = drawer.querySelector("div[style*='flex: 1']");
    if (contentWrapper) {
      const existingReturnButton = drawer.querySelector("#return-button");
      if (!existingReturnButton) {
        const returnButton = document.createElement("button");
        returnButton.id = "return-button";
        returnButton.textContent = "Return to Extension";
        returnButton.style.cssText = `
          padding: 12px 20px;
          background-color: #0095f6;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.2s;
          width: 100%;
          margin-top: 8px;
        `;
      returnButton.addEventListener('mouseenter', () => {
        returnButton.style.background = 'var(--accent-hover, #c91c56)';
        returnButton.style.transform = 'translateY(-1px)';
        returnButton.style.boxShadow = '0 4px 12px rgba(225, 48, 108, 0.4)';
      });
      returnButton.addEventListener('mouseleave', () => {
        returnButton.style.background = 'var(--accent-solid, #e1306c)';
        returnButton.style.transform = 'translateY(0)';
        returnButton.style.boxShadow = '0 2px 8px rgba(225, 48, 108, 0.3)';
      });
        returnButton.addEventListener("click", () => {
          chrome.runtime.sendMessage({ action: "RETURN_TO_EXTENSION" });
          // Close the drawer after clicking the return button
          drawer.style.right = "-380px";
        });
        contentWrapper.appendChild(returnButton);
      }
    }
  }
}

function showDrawer(drawer) {
  drawer.style.right = "0";
}

async function fetchSavedPosts(maxId = "") {
  try {
    const response = await fetch(
      `https://i.instagram.com/api/v1/feed/saved/posts/?max_id=${maxId}`,
      {
        method: "GET",
        ...defaultRequest,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    let data = await response.json();
    data.items = data.items.map((item) => item.media);

    return data;
  } catch (error) {
    console.error(`Error fetching saved posts: ${error.message}`);
    throw error;
  }
}

// Media functions removed - we now store URLs directly instead of downloading blobs

async function fetchCollections() {
  let allCollections = [];
  let moreAvailable = true;
  let maxId = "";

  while (moreAvailable) {
    const url = `https://i.instagram.com/api/v1/collections/list/?collection_types=["ALL_MEDIA_AUTO_COLLECTION", "MEDIA"]&include_public_only=1&max_id=${maxId}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        ...defaultRequest,
        redirect: "error",
      });

      if (response.status !== 200) {
        throw new Error(
          `Failed to get collections. Status: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (Array.isArray(data.items)) {
        allCollections = allCollections.concat(data.items);
      }

      moreAvailable = data.more_available;
      maxId = data.next_max_id || "";

      // Optional: Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error fetching collections: ${error.message}`);
      moreAvailable = false;
    }
  }

  return allCollections;
}

async function downloadAndCompressThumbnail(imageUrl, postId) {
  try {
    // Download the image
    const response = await fetch(imageUrl, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }
    
    const blob = await response.blob();
    
    // Create an image element to load and compress
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        // Create canvas for compression
        const canvas = document.createElement('canvas');
        const maxSize = 320;
        const quality = 0.7;
        
        // Calculate new dimensions maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert directly to base64 data URL
        const base64DataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(base64DataUrl);
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(blob);
    });
  } catch (error) {
    console.error(`Error downloading/compressing thumbnail:`, error);
    throw error;
  }
}

async function getInstagramSavedPosts() {
  try {
    isSyncing = true;
    
    // Check for saved progress
    const savedProgress = await new Promise((resolve) => {
      chrome.storage.local.get([SYNC_PROGRESS_KEY], (result) => {
        resolve(result[SYNC_PROGRESS_KEY] || null);
      });
    });

    // Resume from saved progress or start fresh
    syncedCount = savedProgress?.synced || 0;
    failedCount = savedProgress?.failed || 0;
    
    console.log(savedProgress ? `Resuming sync from: ${syncedCount} synced, ${failedCount} failed` : 'Starting fresh sync');

    const collections = await fetchCollections();
    
    // Send collections immediately
    chrome.runtime.sendMessage({
      action: "SAVE_COLLECTIONS",
      collections: collections,
    });
    
    let maxId = savedProgress?.maxId || "";
    let moreAvailable = true;
    let retryCount = 0;
    const maxRetries = 3;
    let batchBuffer = [];
    
    // Update UI with initial state
    updateSyncProgress(syncedCount, failedCount);

    while (moreAvailable && isSyncing) {
      try {
        const savedPosts = await fetchSavedPosts(maxId);
        maxId = savedPosts.next_max_id;

        for (const post of savedPosts.items) {
          try {
            // Use permanent Instagram post URL (permalink)
            const url = `https://www.instagram.com/p/${post.code}/`;
            const postId = post.id || `${post.user.username}-${post.code}`;
            
            // Get thumbnail URL
            const thumbnailUrl = post.image_versions2?.candidates?.[0]?.url || null;
            
            // Download and compress thumbnail, convert to base64
            let thumbnailBase64 = null;
            if (thumbnailUrl) {
              try {
                thumbnailBase64 = await downloadAndCompressThumbnail(thumbnailUrl, postId);
              } catch (thumbError) {
                console.error(`Error processing thumbnail for ${postId}:`, thumbError);
                // Continue without thumbnail
              }
            }
            
            const element = {
              id: postId,
              url, // Permanent Instagram post permalink
              thumbnail: thumbnailBase64, // Base64 data URL stored directly
              title: post.caption?.text ?? `${post.user.username} post`,
              username: post.user.username,
              collectionIds: post.saved_collection_ids || [],
              isVideo: post.media_type === 2,
              videoUrl: null, // Don't store duplicate permalink, use url field instead
              timestamp: post.taken_at || Date.now(), // Store timestamp for sorting
            };
            
            batchBuffer.push(element);
            
            // Save batch when buffer is full
            if (batchBuffer.length >= BATCH_SIZE) {
              await saveBatch(batchBuffer);
              syncedCount += batchBuffer.length;
              batchBuffer = [];
              
              // Save progress
              await saveProgress(maxId, syncedCount, failedCount);
              updateSyncProgress(syncedCount, failedCount);
            }
          } catch (postError) {
            console.error(`Error processing post ${post.code}:`, postError);
            failedCount++;
            updateSyncProgress(syncedCount, failedCount);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        moreAvailable = savedPosts.more_available;
        retryCount = 0;
      } catch (error) {
        console.error(`Error in fetch loop: ${error.message}`);
        retryCount++;
        if (retryCount > maxRetries) {
          moreAvailable = false;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    // Save remaining posts in buffer
    if (batchBuffer.length > 0) {
      await saveBatch(batchBuffer);
      syncedCount += batchBuffer.length;
      updateSyncProgress(syncedCount, failedCount);
    }

    // Clear progress on completion
    await clearProgress();
    
    isSyncing = false;
    return { syncedCount, failedCount };
  } catch (error) {
    isSyncing = false;
    console.error(`Error syncing Instagram data: ${error.message}`);
    throw error;
  }
}

async function saveBatch(posts) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: "SAVE_POSTS_BATCH",
      posts: posts,
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function saveProgress(maxId, synced, failed) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [SYNC_PROGRESS_KEY]: {
        maxId,
        synced,
        failed,
        timestamp: Date.now(),
      }
    }, resolve);
  });
}

async function clearProgress() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([SYNC_PROGRESS_KEY], resolve);
  });
}

function updateSyncProgress(synced, failed) {
  const drawer = document.getElementById("instagram-sync-drawer");
  if (drawer) {
    const progressElement = drawer.querySelector("#sync-progress");
    if (progressElement) {
      progressElement.textContent = `Processing posts...`;
    }
    
    const statsElement = drawer.querySelector("#sync-stats");
    if (statsElement) {
      statsElement.innerHTML = `
        <div style="color: var(--success, #42c767); margin-bottom: 8px;"><strong>✓ Synced:</strong> ${synced}</div>
        <div style="color: ${failed > 0 ? 'var(--error, #ed4956)' : 'var(--text-secondary, #a8a8a8)'}"><strong>✗ Failed:</strong> ${failed}</div>
      `;
    }
  }
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "SHOW_SYNC_DRAWER") {
    // Check if drawer already exists
    let drawer = document.getElementById("instagram-sync-drawer");
    if (!drawer) {
      drawer = createSyncDrawer();
    }
    setTimeout(() => showDrawer(drawer), 1000);
  } else if (request.action === "SYNC_COMPLETE") {
    updateSyncDrawer(request.syncedCount, request.failedCount, false);
  } else if (request.action === "IMPORT_INSTAGRAM_POSTS") {
    try {
      const result = await getInstagramSavedPosts();
      
      if (!isSyncing) {
        // Sync was stopped
        updateSyncDrawer(result.syncedCount, result.failedCount, true);
      } else {
        // Sync completed normally
        chrome.runtime.sendMessage({
          action: "SYNC_FINISHED",
          syncedCount: result.syncedCount,
          failedCount: result.failedCount,
        });
      }
    } catch (error) {
      console.error(`Error during import: ${error.message}`);
      chrome.runtime.sendMessage({
        action: "IMPORT_FAILED",
        error: error.message,
      });
      
      // Show error in drawer
      const drawer = document.getElementById("instagram-sync-drawer");
      if (drawer) {
        const progressElement = drawer.querySelector("#sync-progress");
        if (progressElement) {
          progressElement.textContent = `Error: ${error.message}`;
          progressElement.style.color = "var(--error, #ed4956)";
        }
        
        const syncButton = drawer.querySelector("#sync-button");
        if (syncButton) {
          syncButton.textContent = "Sync Failed";
          syncButton.disabled = false;
        }
        
        const stopButton = drawer.querySelector("#stop-sync-button");
        if (stopButton) {
          stopButton.remove();
        }
      }
    }
  } else if (request.action === "STOP_SYNC") {
    isSyncing = false;
    
    // Update UI to show stopping
    const drawer = document.getElementById("instagram-sync-drawer");
    if (drawer) {
      const progressElement = drawer.querySelector("#sync-progress");
      if (progressElement) {
        progressElement.textContent = `Stopping sync... (${syncedCount} synced, ${failedCount} failed so far)`;
      }
    }
  }
});

(function () {
  if (window.location.hostname === "www.instagram.com") {
    console.log("Instagram page detected. Ready for sync.");
    
    // Check for saved progress on page load
    chrome.storage.local.get([SYNC_PROGRESS_KEY], (result) => {
      if (result[SYNC_PROGRESS_KEY]) {
        // Small delay to ensure page is fully loaded
        setTimeout(() => {
          // Check if drawer already exists
          let drawer = document.getElementById("instagram-sync-drawer");
          if (!drawer) {
            drawer = createSyncDrawer();
          }
          setTimeout(() => showDrawer(drawer), 500);
        }, 1000);
      }
    });
  }
})();
