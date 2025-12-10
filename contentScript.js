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

const BATCH_SIZE = 21;
const SYNC_PROGRESS_KEY = "instagram_sync_progress";

function createSyncDrawer() {
  const drawer = document.createElement("div");
  drawer.id = "instagram-sync-drawer";
  drawer.style.cssText = `
    position: fixed;
    top: 0;
    right: -400px;
    width: 400px;
    height: 100%;
    background: linear-gradient(180deg, #0d0d0d 0%, #1a1a1a 100%);
    color: #ffffff;
    box-shadow: -8px 0 32px rgba(0,0,0,0.6);
    transition: right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 10000;
    padding: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    border-left: 1px solid rgba(255,255,255,0.1);
  `;

  // Header with gradient
  const header = document.createElement("div");
  header.style.cssText = `
    background: linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%);
    color: white;
    padding: 28px 24px;
    position: relative;
  `;
  
  const heading = document.createElement("h2");
  heading.textContent = "Sync Saved Posts";
  heading.style.cssText = `
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    color: white;
    letter-spacing: -0.5px;
  `;
  
  const subtitle = document.createElement("p");
  subtitle.textContent = "Import your Instagram saved posts";
  subtitle.style.cssText = `
    margin: 6px 0 0 0;
    font-size: 13px;
    opacity: 0.9;
    font-weight: 400;
  `;
  
  header.appendChild(heading);
  header.appendChild(subtitle);
  
  const contentWrapper = document.createElement("div");
  contentWrapper.style.cssText = `
    flex: 1;
    padding: 24px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  `;

  // Check for saved progress
  chrome.storage.local.get([SYNC_PROGRESS_KEY], (result) => {
    if (result[SYNC_PROGRESS_KEY]) {
      const progress = result[SYNC_PROGRESS_KEY];
      const resumeInfo = document.createElement("div");
      resumeInfo.id = "resume-info";
      resumeInfo.style.cssText = `
        padding: 16px;
        background: linear-gradient(135deg, rgba(252,176,69,0.15) 0%, rgba(253,29,29,0.1) 100%);
        border: 1px solid rgba(252,176,69,0.3);
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.6;
      `;
      resumeInfo.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 18px;">⏸️</span>
          <strong style="color: #fcb045;">Resume available</strong>
        </div>
        <div style="color: rgba(255,255,255,0.8);">
          Previous sync: <strong>${progress.synced}</strong> synced, <strong>${progress.failed}</strong> failed
        </div>
        <div style="font-size: 11px; opacity: 0.6; margin-top: 4px;">${new Date(progress.timestamp).toLocaleString()}</div>
      `;
      contentWrapper.insertBefore(resumeInfo, contentWrapper.firstChild);
      
      const clearButton = document.createElement("button");
      clearButton.id = "clear-progress-button";
      clearButton.textContent = "Clear & Start Fresh";
      clearButton.style.cssText = `
        padding: 8px 14px;
        background: transparent;
        color: rgba(255,255,255,0.7);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        cursor: pointer;
        margin-top: 12px;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
      `;
      clearButton.addEventListener('mouseenter', () => {
        clearButton.style.background = 'rgba(255,255,255,0.1)';
        clearButton.style.borderColor = 'rgba(255,255,255,0.3)';
      });
      clearButton.addEventListener('mouseleave', () => {
        clearButton.style.background = 'transparent';
        clearButton.style.borderColor = 'rgba(255,255,255,0.2)';
      });
      clearButton.addEventListener("click", () => {
        if (confirm("Clear saved progress and start fresh?")) {
          chrome.storage.local.remove([SYNC_PROGRESS_KEY], () => {
            resumeInfo.remove();
          });
        }
      });
      resumeInfo.appendChild(clearButton);
    }
  });

  const syncButton = document.createElement("button");
  syncButton.id = "sync-button";
  
  chrome.storage.local.get(["instagramSavedPosts", SYNC_PROGRESS_KEY], (result) => {
    let hasExistingPosts = false;
    try {
      const postsData = result.instagramSavedPosts;
      if (postsData) {
        const posts = JSON.parse(postsData);
        hasExistingPosts = Array.isArray(posts) && posts.length > 0;
      }
    } catch (error) {}
    
    const hasProgress = result[SYNC_PROGRESS_KEY];
    const shouldResume = hasExistingPosts || hasProgress;
    
    if (shouldResume) {
      syncButton.textContent = "Resume Sync";
      syncButton.style.cssText = `
        padding: 16px 24px;
        background: linear-gradient(135deg, #fcb045 0%, #fd1d1d 100%);
        color: white;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        font-size: 15px;
        font-weight: 600;
        transition: all 0.3s;
        width: 100%;
        box-shadow: 0 4px 20px rgba(252,176,69,0.4);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
    } else {
      syncButton.textContent = "Start Sync";
      syncButton.style.cssText = `
        padding: 16px 24px;
        background: linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%);
        color: white;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        font-size: 15px;
        font-weight: 600;
        transition: all 0.3s;
        width: 100%;
        box-shadow: 0 4px 20px rgba(131,58,180,0.4);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
    }
  });
  
  syncButton.addEventListener('mouseenter', () => {
    if (!syncButton.disabled) {
      syncButton.style.transform = 'translateY(-2px)';
      syncButton.style.boxShadow = '0 8px 30px rgba(131,58,180,0.5)';
    }
  });
  syncButton.addEventListener('mouseleave', () => {
    if (!syncButton.disabled) {
      syncButton.style.transform = 'translateY(0)';
      syncButton.style.boxShadow = '0 4px 20px rgba(131,58,180,0.4)';
    }
  });

  syncButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "START_SYNC" });
    syncButton.textContent = "Syncing...";
    syncButton.disabled = true;
    syncButton.style.opacity = '0.7';
    syncButton.style.cursor = 'not-allowed';
    
    const stopButton = document.createElement("button");
    stopButton.id = "stop-sync-button";
    stopButton.textContent = "Stop Sync";
    stopButton.style.cssText = `
      padding: 14px 24px;
      background: transparent;
      color: #ff4757;
      border: 2px solid #ff4757;
      border-radius: 12px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
      width: 100%;
      margin-top: 12px;
    `;
    stopButton.addEventListener('mouseenter', () => {
      if (!stopButton.disabled) {
        stopButton.style.background = 'rgba(255,71,87,0.1)';
      }
    });
    stopButton.addEventListener('mouseleave', () => {
      if (!stopButton.disabled) {
        stopButton.style.background = 'transparent';
      }
    });
    stopButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "STOP_SYNC" });
      stopButton.disabled = true;
      stopButton.textContent = "Stopping...";
      stopButton.style.opacity = '0.5';
    });
    syncButton.insertAdjacentElement('afterend', stopButton);
  });

  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.style.cssText = `
    position: absolute;
    top: 16px;
    right: 16px;
    width: 36px;
    height: 36px;
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(10px);
    border: none;
    border-radius: 50%;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  `;
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.background = 'rgba(0, 0, 0, 0.5)';
    closeButton.style.transform = 'scale(1.1)';
  });
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.background = 'rgba(0, 0, 0, 0.3)';
    closeButton.style.transform = 'scale(1)';
  });
  closeButton.addEventListener("click", () => {
    drawer.style.right = "-400px";
  });

  // Progress section
  const progressSection = document.createElement("div");
  progressSection.style.cssText = `
    background: rgba(255,255,255,0.05);
    border-radius: 16px;
    padding: 20px;
    border: 1px solid rgba(255,255,255,0.1);
  `;

  const progressElement = document.createElement("div");
  progressElement.id = "sync-progress";
  progressElement.style.cssText = `
    font-size: 14px;
    color: rgba(255,255,255,0.9);
    font-weight: 500;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  `;
  progressElement.innerHTML = `<span style="opacity: 0.6;">Ready to sync</span>`;

  // Progress bar
  const progressBarContainer = document.createElement("div");
  progressBarContainer.id = "progress-bar-container";
  progressBarContainer.style.cssText = `
    width: 100%;
    height: 6px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 16px;
    display: none;
  `;
  
  const progressBar = document.createElement("div");
  progressBar.id = "progress-bar";
  progressBar.style.cssText = `
    width: 0%;
    height: 100%;
    background: linear-gradient(90deg, #833ab4, #fd1d1d, #fcb045);
    border-radius: 3px;
    transition: width 0.3s ease;
  `;
  progressBarContainer.appendChild(progressBar);

  const statsElement = document.createElement("div");
  statsElement.id = "sync-stats";
  statsElement.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  `;
  statsElement.innerHTML = `
    <div style="background: rgba(46,213,115,0.1); padding: 14px; border-radius: 10px; text-align: center; border: 1px solid rgba(46,213,115,0.2);">
      <div style="font-size: 24px; font-weight: 700; color: #2ed573;" id="synced-count">0</div>
      <div style="font-size: 11px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.5px;">Synced</div>
    </div>
    <div style="background: rgba(255,71,87,0.1); padding: 14px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,71,87,0.2);">
      <div style="font-size: 24px; font-weight: 700; color: #ff4757;" id="failed-count">0</div>
      <div style="font-size: 11px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.5px;">Failed</div>
    </div>
  `;

  progressSection.appendChild(progressElement);
  progressSection.appendChild(progressBarContainer);
  progressSection.appendChild(statsElement);

  // Clear Storage button
  const clearStorageButton = document.createElement("button");
  clearStorageButton.id = "clear-storage-button";
  clearStorageButton.textContent = "Clear All Storage";
  clearStorageButton.style.cssText = `
    padding: 12px 20px;
    background: transparent;
    color: rgba(255,71,87,0.8);
    border: 1px solid rgba(255,71,87,0.3);
    border-radius: 10px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
    width: 100%;
    margin-top: auto;
  `;
  clearStorageButton.addEventListener('mouseenter', () => {
    if (!clearStorageButton.disabled) {
      clearStorageButton.style.background = 'rgba(255,71,87,0.1)';
      clearStorageButton.style.borderColor = 'rgba(255,71,87,0.5)';
    }
  });
  clearStorageButton.addEventListener('mouseleave', () => {
    if (!clearStorageButton.disabled) {
      clearStorageButton.style.background = 'transparent';
      clearStorageButton.style.borderColor = 'rgba(255,71,87,0.3)';
    }
  });
  clearStorageButton.addEventListener("click", () => {
    const confirmMessage = `Clear all stored data?\n\n• All saved posts\n• All images and videos\n• All collections\n\nThis cannot be undone!`;
    
    if (confirm(confirmMessage)) {
      clearStorageButton.disabled = true;
      clearStorageButton.textContent = 'Clearing...';
      
      chrome.runtime.sendMessage({ action: "CLEAR_STORAGE" }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          clearStorageButton.disabled = false;
          clearStorageButton.textContent = 'Clear All Storage';
          showErrorMessage(drawer, 'Error clearing storage.');
          return;
        }
        
        clearStorageButton.textContent = 'Cleared!';
        clearStorageButton.style.borderColor = '#2ed573';
        clearStorageButton.style.color = '#2ed573';
        
        const syncBtn = drawer.querySelector("#sync-button");
        if (syncBtn) {
          syncBtn.textContent = "Start Sync";
        }
        
        const resumeInfo = drawer.querySelector("#resume-info");
        if (resumeInfo) resumeInfo.remove();
        
        setTimeout(() => {
          clearStorageButton.disabled = false;
          clearStorageButton.textContent = 'Clear All Storage';
          clearStorageButton.style.borderColor = 'rgba(255,71,87,0.3)';
          clearStorageButton.style.color = 'rgba(255,71,87,0.8)';
        }, 2000);
      });
    }
  });

  drawer.appendChild(header);
  header.appendChild(closeButton);
  drawer.appendChild(contentWrapper);
  contentWrapper.appendChild(syncButton);
  contentWrapper.appendChild(progressSection);
  contentWrapper.appendChild(clearStorageButton);
  document.body.appendChild(drawer);

  return drawer;
}

function updateSyncDrawer(syncedCount, failedCount, wasStopped = false) {
  const drawer = document.getElementById("instagram-sync-drawer");
  if (!drawer) return;
  
  const syncButton = drawer.querySelector("#sync-button");
  if (syncButton) {
    if (wasStopped) {
      syncButton.textContent = "Resume Sync";
      syncButton.disabled = false;
      syncButton.style.opacity = '1';
      syncButton.style.cursor = 'pointer';
      syncButton.style.background = 'linear-gradient(135deg, #fcb045 0%, #fd1d1d 100%)';
      
      const newSyncButton = syncButton.cloneNode(true);
      syncButton.parentNode.replaceChild(newSyncButton, syncButton);
      newSyncButton.id = "sync-button";
      
      newSyncButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "START_SYNC" });
        newSyncButton.textContent = "Syncing...";
        newSyncButton.disabled = true;
        newSyncButton.style.opacity = '0.7';
      });
    } else {
      syncButton.textContent = "Sync Complete ✓";
      syncButton.disabled = true;
      syncButton.style.background = 'linear-gradient(135deg, #2ed573 0%, #1e90ff 100%)';
    }
  }

  const stopButton = drawer.querySelector("#stop-sync-button");
  if (stopButton) stopButton.remove();

  const progressElement = drawer.querySelector("#sync-progress");
  if (progressElement) {
    const totalCount = syncedCount + failedCount;
    if (wasStopped) {
      progressElement.innerHTML = `<span style="color: #fcb045;">⏸️ Paused</span> <span style="opacity: 0.6;">${totalCount} posts processed</span>`;
    } else {
      progressElement.innerHTML = `<span style="color: #2ed573;">✓ Complete!</span> <span style="opacity: 0.6;">${totalCount} posts processed</span>`;
    }
  }

  const progressBarContainer = drawer.querySelector("#progress-bar-container");
  if (progressBarContainer) {
    progressBarContainer.style.display = 'none';
  }

  updateStatsDisplay(syncedCount, failedCount);

  const contentWrapper = drawer.querySelector("div[style*='flex: 1']");
  if (contentWrapper) {
    const existingReturnButton = drawer.querySelector("#return-button");
    if (!existingReturnButton) {
      const returnButton = document.createElement("button");
      returnButton.id = "return-button";
      returnButton.textContent = "View Your Posts →";
      returnButton.style.cssText = `
        padding: 16px 24px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        font-size: 15px;
        font-weight: 600;
        transition: all 0.3s;
        width: 100%;
        margin-top: 12px;
        box-shadow: 0 4px 20px rgba(102,126,234,0.4);
      `;
      returnButton.addEventListener('mouseenter', () => {
        returnButton.style.transform = 'translateY(-2px)';
        returnButton.style.boxShadow = '0 8px 30px rgba(102,126,234,0.5)';
      });
      returnButton.addEventListener('mouseleave', () => {
        returnButton.style.transform = 'translateY(0)';
        returnButton.style.boxShadow = '0 4px 20px rgba(102,126,234,0.4)';
      });
      returnButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "RETURN_TO_EXTENSION" });
        drawer.style.right = "-400px";
      });
      
      const syncBtn = drawer.querySelector("#sync-button");
      if (syncBtn) {
        syncBtn.insertAdjacentElement('afterend', returnButton);
      } else {
        contentWrapper.appendChild(returnButton);
      }
    }
  }
}

function showDrawer(drawer) {
  drawer.style.right = "0";
}

function showErrorMessage(drawer, message) {
  const existingError = drawer.querySelector(".error-message");
  if (existingError) existingError.remove();
  
  const errorMsg = document.createElement("div");
  errorMsg.className = "error-message";
  errorMsg.textContent = message;
  errorMsg.style.cssText = `
    padding: 14px 18px;
    background: rgba(255,71,87,0.1);
    border: 1px solid rgba(255,71,87,0.3);
    border-radius: 10px;
    color: #ff4757;
    font-size: 14px;
    margin-top: 12px;
  `;
  
  const contentWrapper = drawer.querySelector("div[style*='flex: 1']");
  const syncButton = drawer.querySelector("#sync-button");
  if (contentWrapper && syncButton) {
    syncButton.insertAdjacentElement('afterend', errorMsg);
  }
  
  setTimeout(() => {
    if (errorMsg.parentNode) errorMsg.remove();
  }, 5000);
}

function updateStatsDisplay(synced, failed) {
  const syncedEl = document.getElementById("synced-count");
  const failedEl = document.getElementById("failed-count");
  
  if (syncedEl) syncedEl.textContent = synced;
  if (failedEl) failedEl.textContent = failed;
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
        throw new Error(`Failed to get collections. Status: ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data.items)) {
        allCollections = allCollections.concat(data.items);
      }

      moreAvailable = data.more_available;
      maxId = data.next_max_id || "";

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error fetching collections: ${error.message}`);
      moreAvailable = false;
    }
  }

  return allCollections;
}

// Get total saved posts count - try user info endpoint first, then estimate from collections
async function fetchTotalSavedCount() {
  try {
    // Try to get from the saved feed count endpoint
    const countUrl = `https://i.instagram.com/api/v1/feed/saved/all/count/`;
    
    try {
      const countResponse = await fetch(countUrl, {
        method: "GET",
        ...defaultRequest,
        redirect: "error",
      });
      
      if (countResponse.status === 200) {
        const countData = await countResponse.json();
        if (countData.count) {
          return countData.count;
        }
      }
    } catch (e) {
      // Endpoint might not exist, continue to fallback
    }
    
    // Fallback: estimate from collections
    const url = `https://i.instagram.com/api/v1/collections/list/?collection_types=["ALL_MEDIA_AUTO_COLLECTION","MEDIA"]&include_public_only=0`;
    
    const response = await fetch(url, {
      method: "GET",
      ...defaultRequest,
      redirect: "error",
    });

    if (response.status !== 200) {
      return 0;
    }

    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      // Look for ALL_MEDIA_AUTO_COLLECTION first (the "All Posts" collection)
      const allPostsCollection = data.items.find(
        item => item.collection_type === "ALL_MEDIA_AUTO_COLLECTION" || 
                item.collection_name === "All Posts"
      );
      
      if (allPostsCollection) {
        const count = allPostsCollection.collection_media_count || allPostsCollection.media_count;
        if (count) return count;
      }
      
      // Fallback: find the largest collection_media_count as a rough estimate
      // (posts might not be in collections, so this is just a minimum estimate)
      let maxCount = 0;
      for (const item of data.items) {
        const count = item.collection_media_count || item.media_count || 0;
        if (count > maxCount) {
          maxCount = count;
        }
      }
      
      // Return 0 if we can't get a reliable count - progress bar will use fallback mode
      return 0;
    }
    
    return 0;
  } catch (error) {
    console.error(`Error fetching total saved count: ${error.message}`);
    return 0;
  }
}

function getSavedTimestamp(post) {
  let savedTimestamp = post.saved_at || post.savedAt || post.saved_timestamp;
  
  if (!savedTimestamp) {
    savedTimestamp = post.taken_at;
  }
  
  if (savedTimestamp && savedTimestamp < 10000000000) {
    savedTimestamp = savedTimestamp * 1000;
  }
  
  return savedTimestamp || Date.now();
}

function createPostElement(post, postId, url, thumbnailBase64, carouselMedia = null) {
  // media_type: 1 = photo, 2 = video, 8 = carousel
  const isCarousel = post.media_type === 8;
  const isVideo = post.media_type === 2;
  
  return {
    id: postId,
    url,
    thumbnail: thumbnailBase64,
    title: post.caption?.text ?? `${post.user.username} post`,
    username: post.user.username,
    collectionIds: post.saved_collection_ids || [],
    isVideo: isVideo,
    isCarousel: isCarousel,
    carouselMedia: carouselMedia,
    carouselCount: isCarousel && carouselMedia ? carouselMedia.length : 0,
    videoUrl: null,
    timestamp: getSavedTimestamp(post),
    takenAt: post.taken_at || Date.now(),
  };
}

async function processPost(post) {
  const url = `https://www.instagram.com/p/${post.code}/`;
  const postId = post.id || `${post.user.username}-${post.code}`;
  
  // Check if this is a carousel post (media_type === 8)
  const isCarousel = post.media_type === 8;
  let carouselMedia = null;
  let thumbnailUrl = null;
  
  if (isCarousel && post.carousel_media && post.carousel_media.length > 0) {
    // Process carousel items
    carouselMedia = post.carousel_media.map((item, index) => {
      const itemIsVideo = item.media_type === 2;
      return {
        id: item.id || `${postId}-${index}`,
        index: index,
        isVideo: itemIsVideo,
        // Get the best quality image for the thumbnail
        imageUrl: item.image_versions2?.candidates?.[0]?.url || null,
        // For videos, also store video info
        videoVersions: itemIsVideo ? (item.video_versions || []) : null,
        width: item.original_width || item.image_versions2?.candidates?.[0]?.width || 0,
        height: item.original_height || item.image_versions2?.candidates?.[0]?.height || 0,
      };
    });
    
    // Use first carousel item as the main thumbnail
    thumbnailUrl = carouselMedia[0]?.imageUrl || null;
  } else {
    // Single image or video post
    thumbnailUrl = post.image_versions2?.candidates?.[0]?.url || null;
  }
  
  let thumbnailBase64 = null;
  if (thumbnailUrl) {
    try {
      thumbnailBase64 = await downloadAndCompressThumbnail(thumbnailUrl, postId);
    } catch (thumbError) {
      console.error(`Error processing thumbnail for ${postId}:`, thumbError);
    }
  }
  
  return createPostElement(post, postId, url, thumbnailBase64, carouselMedia);
}

async function saveBatchIfFull(batchBuffer, syncedCount, failedCount, currentMinId, savedMinId, savedMaxId, maxId, total = 0) {
  if (batchBuffer.length >= BATCH_SIZE) {
    const result = await saveBatch(batchBuffer);
    const addedCount = result?.added || batchBuffer.length;
    syncedCount += addedCount;
    batchBuffer.length = 0;
    await saveProgress(currentMinId || savedMinId || "", maxId || savedMaxId || "", syncedCount, failedCount);
    updateSyncProgress(syncedCount, failedCount, total);
    return syncedCount;
  }
  return syncedCount;
}

async function downloadAndCompressThumbnail(imageUrl, postId) {
  try {
    const response = await fetch(imageUrl, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }
    
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 280;
        const quality = 0.65;
        
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
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
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
    
    const savedProgress = await new Promise((resolve) => {
      chrome.storage.local.get([SYNC_PROGRESS_KEY], (result) => {
        resolve(result[SYNC_PROGRESS_KEY] || null);
      });
    });

    // Get existing post info for duplicate checking
    const existingPostsInfo = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "GET_POSTS_INFO" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ count: 0, ids: [], links: [] });
        } else {
          resolve(response || { count: 0, ids: [], links: [] });
        }
      });
    });
    
    // Use Sets for O(1) lookup
    const existingPostIds = new Set(existingPostsInfo.ids || []);
    const existingPostLinks = new Set(existingPostsInfo.links || []);
    
    if (savedProgress) {
      syncedCount = savedProgress.synced || 0;
      failedCount = savedProgress.failed || 0;
    } else if (existingPostsInfo.count > 0) {
      syncedCount = existingPostsInfo.count;
      failedCount = 0;
    } else {
      syncedCount = 0;
      failedCount = 0;
    }

    // Fetch total saved posts count from Instagram API
    totalSavedCount = await fetchTotalSavedCount();
    console.log(`Total saved posts from Instagram: ${totalSavedCount}`);

    // Show progress bar
    const progressBarContainer = document.getElementById("progress-bar-container");
    if (progressBarContainer) {
      progressBarContainer.style.display = 'block';
    }

    const collections = await fetchCollections();
    
    chrome.runtime.sendMessage({
      action: "SAVE_COLLECTIONS",
      collections: collections,
    });
    
    let savedMinId = savedProgress?.minId || "";
    let savedMaxId = savedProgress?.maxId || "";
    let currentMinId = "";
    let maxId = "";
    let moreAvailable = true;
    let retryCount = 0;
    const maxRetries = 3;
    let batchBuffer = [];
    let checkingNewPosts = !!savedMinId;
    
    updateSyncProgress(syncedCount, failedCount, totalSavedCount);
    maxId = "";

    while (moreAvailable && isSyncing) {
      try {
        const savedPosts = await fetchSavedPosts(maxId);
        
        if (savedPosts.items && savedPosts.items.length > 0 && maxId === "") {
          const firstPost = savedPosts.items[0];
          if (firstPost && firstPost.id) {
            currentMinId = firstPost.id;
          }
          
          // Estimate total for progress
          totalPostsFound = savedPosts.items.length;
        }
        
        // Skip posts that already exist
        const newPostsInBatch = savedPosts.items.filter(post => {
          const postId = post.id || `${post.user?.username}-${post.code}`;
          const postUrl = `https://www.instagram.com/p/${post.code}/`;
          return !existingPostIds.has(postId) && !existingPostLinks.has(postUrl);
        });
        
        // Check if we've caught up with existing posts
        if (checkingNewPosts && savedMinId && savedPosts.items.length > 0) {
          const foundSavedPostIndex = savedPosts.items.findIndex(p => {
            const postId = p.id || `${p.user?.username}-${p.code}`;
            return postId === savedMinId;
          });
          
          if (foundSavedPostIndex >= 0) {
            const newPostsBeforeSaved = savedPosts.items.slice(0, foundSavedPostIndex);
            
            for (const post of newPostsBeforeSaved) {
              try {
                const element = await processPost(post);
                batchBuffer.push(element);
                
                // Add to our local tracking
                existingPostIds.add(element.id);
                existingPostLinks.add(element.url);
                
                syncedCount = await saveBatchIfFull(batchBuffer, syncedCount, failedCount, currentMinId, savedMinId, savedMaxId, maxId, totalSavedCount);
              } catch (postError) {
                console.error(`Error processing post ${post.code}:`, postError);
                failedCount++;
                updateSyncProgress(syncedCount, failedCount, totalSavedCount);
              }
            }
            
            checkingNewPosts = false;
            if (savedMaxId) {
              maxId = savedMaxId;
              savedMinId = "";
              continue;
            } else {
              savedMinId = "";
            }
          }
        }
        
        if (checkingNewPosts || !savedMinId) {
          maxId = savedPosts.next_max_id;
          
          for (const post of newPostsInBatch) {
            try {
              const element = await processPost(post);
              batchBuffer.push(element);
              
              // Add to our local tracking
              existingPostIds.add(element.id);
              existingPostLinks.add(element.url);
              
              syncedCount = await saveBatchIfFull(batchBuffer, syncedCount, failedCount, currentMinId, savedMinId, savedMaxId, maxId, totalSavedCount);
            } catch (postError) {
              console.error(`Error processing post ${post.code}:`, postError);
              failedCount++;
              updateSyncProgress(syncedCount, failedCount, totalSavedCount);
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
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

    // Save remaining posts
    if (batchBuffer.length > 0) {
      await saveBatch(batchBuffer);
      syncedCount += batchBuffer.length;
      await saveProgress(currentMinId || savedMinId || "", maxId || savedMaxId || "", syncedCount, failedCount);
      updateSyncProgress(syncedCount, failedCount, totalSavedCount);
    }

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

async function saveProgress(minId, maxId, synced, failed) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [SYNC_PROGRESS_KEY]: {
        minId: minId || "",
        maxId: maxId || "",
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

function updateSyncProgress(synced, failed, total = 0) {
  // Send progress update to background script for forwarding to extension page
  chrome.runtime.sendMessage({
    action: "SYNC_PROGRESS_UPDATE",
    synced: synced,
    failed: failed,
    total: total,
  });
  
  const drawer = document.getElementById("instagram-sync-drawer");
  if (!drawer) return;
  
  const progressElement = drawer.querySelector("#sync-progress");
  if (progressElement) {
    const processed = synced + failed;
    if (total > 0) {
      const percent = Math.min(100, Math.round((processed / total) * 100));
      progressElement.innerHTML = `
        <span class="pulse-dot" style="width: 8px; height: 8px; background: #2ed573; border-radius: 50%; animation: pulse 1.5s infinite;"></span>
        <span style="opacity: 0.6; margin-left: auto;">${processed} / ${total}</span>
      `;
    } else {
      progressElement.innerHTML = `
        <span class="pulse-dot" style="width: 8px; height: 8px; background: #2ed573; border-radius: 50%; animation: pulse 1.5s infinite;"></span>
      `;
    }
  }
  
  // Update progress bar
  const progressBar = document.getElementById("progress-bar");
  if (progressBar && total > 0) {
    const processed = synced + failed;
    const percent = Math.min(100, Math.round((processed / total) * 100));
    progressBar.style.width = `${percent}%`;
  }
  
  // Add pulse animation if not exists
  if (!document.getElementById('pulse-animation')) {
    const style = document.createElement('style');
    style.id = 'pulse-animation';
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.8); }
      }
    `;
    document.head.appendChild(style);
  }
  
  updateStatsDisplay(synced, failed);
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "SHOW_SYNC_DRAWER") {
    let drawer = document.getElementById("instagram-sync-drawer");
    if (!drawer) {
      drawer = createSyncDrawer();
    }
    setTimeout(() => showDrawer(drawer), 500);
  } else if (request.action === "START_BACKGROUND_SYNC") {
    // Background sync - no drawer, just start syncing immediately
    try {
      const result = await getInstagramSavedPosts();
      
      if (isSyncing) {
        chrome.runtime.sendMessage({
          action: "SYNC_FINISHED",
          syncedCount: result.syncedCount,
          failedCount: result.failedCount,
        });
      } else {
        // Sync was stopped
        chrome.runtime.sendMessage({
          action: "SYNC_STOPPED",
          syncedCount: result.syncedCount,
          failedCount: result.failedCount,
        });
      }
    } catch (error) {
      console.error(`Error during background sync: ${error.message}`);
      chrome.runtime.sendMessage({
        action: "IMPORT_FAILED",
        error: error.message,
      });
    }
  } else if (request.action === "SYNC_COMPLETE") {
    updateSyncDrawer(request.syncedCount, request.failedCount, false);
  } else if (request.action === "IMPORT_INSTAGRAM_POSTS") {
    try {
      const result = await getInstagramSavedPosts();
      
      if (!isSyncing) {
        updateSyncDrawer(result.syncedCount, result.failedCount, true);
      } else {
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
      
      const drawer = document.getElementById("instagram-sync-drawer");
      if (drawer) {
        const progressElement = drawer.querySelector("#sync-progress");
        if (progressElement) {
          progressElement.innerHTML = `<span style="color: #ff4757;">✗ Error: ${error.message}</span>`;
        }
        
        const syncButton = drawer.querySelector("#sync-button");
        if (syncButton) {
          syncButton.textContent = "Retry Sync";
          syncButton.disabled = false;
          syncButton.style.opacity = '1';
        }
        
        const stopButton = drawer.querySelector("#stop-sync-button");
        if (stopButton) stopButton.remove();
      }
    }
  } else if (request.action === "STOP_SYNC") {
    isSyncing = false;
    
    const drawer = document.getElementById("instagram-sync-drawer");
    if (drawer) {
      const progressElement = drawer.querySelector("#sync-progress");
      if (progressElement) {
        progressElement.innerHTML = `<span style="color: #fcb045;">Stopping...</span> <span style="opacity: 0.6;">(${syncedCount} synced, ${failedCount} failed)</span>`;
      }
    }
    
    // Send stopped notification
    chrome.runtime.sendMessage({
      action: "SYNC_STOPPED",
      syncedCount: syncedCount,
      failedCount: failedCount,
    });
  }
});

(function () {
  if (window.location.hostname === "www.instagram.com") {
    chrome.storage.local.get([SYNC_PROGRESS_KEY], (result) => {
      if (result[SYNC_PROGRESS_KEY]) {
        setTimeout(() => {
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
