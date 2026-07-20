let syncedCount = 0;
let failedCount = 0;
let isSyncing = false;
let totalSavedCount = 0;

const defaultRequest = {
  headers: {
    accept: '*/*',
    'sec-ch-ua-mobile': '?0',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'sec-gpc': '1',
    'x-ig-app-id': '936619743392459',
    'x-asbd-id': '198387',
    'x-requested-with': 'XMLHttpRequest'
  },
  referrer: 'https://www.instagram.com/',
  credentials: 'include',
  mode: 'cors'
};

const BATCH_SIZE = 21;
const SYNC_PROGRESS_KEY = 'instagram_sync_progress';
const NOSTALGIA_COLLECTION_NAME = 'nostalgia';
const SYNC_LOGIN_REQUIRED_STATUS = 'login_required';

// eslint-disable-next-line no-unused-vars
function _createSyncDrawer() {
  const drawer = document.createElement('div');
  drawer.id = 'instagram-sync-drawer';
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
  const header = document.createElement('div');
  header.style.cssText = `
    background: linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%);
    color: white;
    padding: 28px 24px;
    position: relative;
  `;

  const heading = document.createElement('h2');
  heading.textContent = 'Sync Saved Posts';
  heading.style.cssText = `
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    color: white;
    letter-spacing: -0.5px;
  `;

  const subtitle = document.createElement('p');
  subtitle.textContent = 'Import your Instagram saved posts';
  subtitle.style.cssText = `
    margin: 6px 0 0 0;
    font-size: 13px;
    opacity: 0.9;
    font-weight: 400;
  `;

  header.appendChild(heading);
  header.appendChild(subtitle);

  const contentWrapper = document.createElement('div');
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
      const resumeInfo = document.createElement('div');
      resumeInfo.id = 'resume-info';
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

      const clearButton = document.createElement('button');
      clearButton.id = 'clear-progress-button';
      clearButton.textContent = 'Clear & Start Fresh';
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
      clearButton.addEventListener('click', () => {
        if (confirm('Clear saved progress and start fresh?')) {
          chrome.storage.local.remove([SYNC_PROGRESS_KEY], () => {
            resumeInfo.remove();
          });
        }
      });
      resumeInfo.appendChild(clearButton);
    }
  });

  const syncButton = document.createElement('button');
  syncButton.id = 'sync-button';

  chrome.storage.local.get(['instagramSavedPosts', SYNC_PROGRESS_KEY], (result) => {
    let hasExistingPosts = false;
    try {
      const postsData = result.instagramSavedPosts;
      if (postsData) {
        const posts = JSON.parse(postsData);
        hasExistingPosts = Array.isArray(posts) && posts.length > 0;
      }
    } catch (error) { }

    const hasProgress = result[SYNC_PROGRESS_KEY];
    const shouldResume = hasExistingPosts || hasProgress;

    if (shouldResume) {
      syncButton.textContent = 'Resume Sync';
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
      syncButton.textContent = 'Start Sync';
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

  syncButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'START_SYNC' });
    syncButton.textContent = 'Syncing...';
    syncButton.disabled = true;
    syncButton.style.opacity = '0.7';
    syncButton.style.cursor = 'not-allowed';

    const stopButton = document.createElement('button');
    stopButton.id = 'stop-sync-button';
    stopButton.textContent = 'Stop Sync';
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
    stopButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'STOP_SYNC' });
      stopButton.disabled = true;
      stopButton.textContent = 'Stopping...';
      stopButton.style.opacity = '0.5';
    });
    syncButton.insertAdjacentElement('afterend', stopButton);
  });

  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
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
  closeButton.addEventListener('click', () => {
    drawer.style.right = '-400px';
  });

  // Progress section
  const progressSection = document.createElement('div');
  progressSection.style.cssText = `
    background: rgba(255,255,255,0.05);
    border-radius: 16px;
    padding: 20px;
    border: 1px solid rgba(255,255,255,0.1);
  `;

  const progressElement = document.createElement('div');
  progressElement.id = 'sync-progress';
  progressElement.style.cssText = `
    font-size: 14px;
    color: rgba(255,255,255,0.9);
    font-weight: 500;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  `;
  progressElement.innerHTML = '<span style="opacity: 0.6;">Ready to sync</span>';

  // Progress bar
  const progressBarContainer = document.createElement('div');
  progressBarContainer.id = 'progress-bar-container';
  progressBarContainer.style.cssText = `
    width: 100%;
    height: 6px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 16px;
    display: none;
  `;

  const progressBar = document.createElement('div');
  progressBar.id = 'progress-bar';
  progressBar.style.cssText = `
    width: 0%;
    height: 100%;
    background: linear-gradient(90deg, #833ab4, #fd1d1d, #fcb045);
    border-radius: 3px;
    transition: width 0.3s ease;
  `;
  progressBarContainer.appendChild(progressBar);

  const statsElement = document.createElement('div');
  statsElement.id = 'sync-stats';
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
  const clearStorageButton = document.createElement('button');
  clearStorageButton.id = 'clear-storage-button';
  clearStorageButton.textContent = 'Clear All Storage';
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
  clearStorageButton.addEventListener('click', () => {
    const confirmMessage = 'Clear all stored data?\n\n• All saved posts\n• All images and videos\n• All collections\n\nThis cannot be undone!';

    if (confirm(confirmMessage)) {
      clearStorageButton.disabled = true;
      clearStorageButton.textContent = 'Clearing...';

      chrome.runtime.sendMessage({ action: 'CLEAR_STORAGE' }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          clearStorageButton.disabled = false;
          clearStorageButton.textContent = 'Clear All Storage';
          showErrorMessage(drawer, 'Error clearing storage.');
          return;
        }

        clearStorageButton.textContent = 'Cleared!';
        clearStorageButton.style.borderColor = '#2ed573';
        clearStorageButton.style.color = '#2ed573';

        const syncBtn = drawer.querySelector('#sync-button');
        if (syncBtn) {
          syncBtn.textContent = 'Start Sync';
        }

        const resumeInfo = drawer.querySelector('#resume-info');
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
  const drawer = document.getElementById('instagram-sync-drawer');
  if (!drawer) return;

  const syncButton = drawer.querySelector('#sync-button');
  if (syncButton) {
    if (wasStopped) {
      syncButton.textContent = 'Resume Sync';
      syncButton.disabled = false;
      syncButton.style.opacity = '1';
      syncButton.style.cursor = 'pointer';
      syncButton.style.background = 'linear-gradient(135deg, #fcb045 0%, #fd1d1d 100%)';

      const newSyncButton = syncButton.cloneNode(true);
      syncButton.parentNode.replaceChild(newSyncButton, syncButton);
      newSyncButton.id = 'sync-button';

      newSyncButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'START_SYNC' });
        newSyncButton.textContent = 'Syncing...';
        newSyncButton.disabled = true;
        newSyncButton.style.opacity = '0.7';
      });
    } else {
      syncButton.textContent = 'Sync Complete ✓';
      syncButton.disabled = true;
      syncButton.style.background = 'linear-gradient(135deg, #2ed573 0%, #1e90ff 100%)';
    }
  }

  const stopButton = drawer.querySelector('#stop-sync-button');
  if (stopButton) stopButton.remove();

  const progressElement = drawer.querySelector('#sync-progress');
  if (progressElement) {
    const totalCount = syncedCount + failedCount;
    if (wasStopped) {
      progressElement.innerHTML = `<span style="color: #fcb045;">⏸️ Paused</span> <span style="opacity: 0.6;">${totalCount} posts processed</span>`;
    } else {
      progressElement.innerHTML = `<span style="color: #2ed573;">✓ Complete!</span> <span style="opacity: 0.6;">${totalCount} posts processed</span>`;
    }
  }

  const progressBarContainer = drawer.querySelector('#progress-bar-container');
  if (progressBarContainer) {
    progressBarContainer.style.display = 'none';
  }

  updateStatsDisplay(syncedCount, failedCount);

  const contentWrapper = drawer.querySelector("div[style*='flex: 1']");
  if (contentWrapper) {
    const existingReturnButton = drawer.querySelector('#return-button');
    if (!existingReturnButton) {
      const returnButton = document.createElement('button');
      returnButton.id = 'return-button';
      returnButton.textContent = 'View Your Posts →';
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
      returnButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'RETURN_TO_EXTENSION' });
        drawer.style.right = '-400px';
      });

      const syncBtn = drawer.querySelector('#sync-button');
      if (syncBtn) {
        syncBtn.insertAdjacentElement('afterend', returnButton);
      } else {
        contentWrapper.appendChild(returnButton);
      }
    }
  }
}

// eslint-disable-next-line no-unused-vars
function _showDrawer(drawer) {
  drawer.style.right = '0';
}

function showErrorMessage(drawer, message) {
  const existingError = drawer.querySelector('.error-message');
  if (existingError) existingError.remove();

  const errorMsg = document.createElement('div');
  errorMsg.className = 'error-message';
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
  const syncButton = drawer.querySelector('#sync-button');
  if (contentWrapper && syncButton) {
    syncButton.insertAdjacentElement('afterend', errorMsg);
  }

  setTimeout(() => {
    if (errorMsg.parentNode) errorMsg.remove();
  }, 5000);
}

function updateStatsDisplay(synced, failed) {
  const syncedEl = document.getElementById('synced-count');
  const failedEl = document.getElementById('failed-count');

  if (syncedEl) syncedEl.textContent = synced;
  if (failedEl) failedEl.textContent = failed;
}

async function fetchSavedPosts(maxId = '') {
  try {
    // Add timeout to prevent hanging on slow/unresponsive requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(
      `https://i.instagram.com/api/v1/feed/saved/posts/?max_id=${maxId}`,
      {
        method: 'GET',
        ...defaultRequest,
        redirect: 'error',
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);

    // Check for authentication errors
    if (response.status === 401 || response.status === 403) {
      throw new Error('Not logged in to Instagram. Please log in and try again.');
    }

    if (!response.ok) {
      // Try to get more specific error message
      let errorMsg = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.message) {
          errorMsg = errorData.message;
        } else if (errorData.error) {
          errorMsg = errorData.error;
        }
      } catch (e) {
        // Couldn't parse error response, use default message
      }
      throw new Error(errorMsg);
    }

    let data = await response.json();

    // Check if response indicates login required
    if (data.message && (data.message.includes('login') || data.message.includes('Login'))) {
      throw new Error('Not logged in to Instagram. Please log in and try again.');
    }

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
  let maxId = '';

  while (moreAvailable) {
    const url = `https://i.instagram.com/api/v1/collections/list/?collection_types=["ALL_MEDIA_AUTO_COLLECTION", "MEDIA"]&include_public_only=1&max_id=${maxId}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        ...defaultRequest,
        redirect: 'error'
      });

      if (response.status !== 200) {
        throw new Error(`Failed to get collections. Status: ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data.items)) {
        allCollections = allCollections.concat(data.items);
      }

      moreAvailable = data.more_available;
      maxId = data.next_max_id || '';

      // Only pace between pages -- no need to wait after the final page (that
      // 1s was pure latency on every collection action).
      if (moreAvailable) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error fetching collections: ${error.message}`);
      moreAvailable = false;
    }
  }

  return allCollections;
}

function getCsrfToken() {
  const cookieMatch = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
  return cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
}

async function instagramApiRequest(url, options = {}) {
  const headers = {
    ...defaultRequest.headers,
    ...options.headers
  };

  const requestOptions = {
    ...defaultRequest,
    ...options,
    headers
  };

  if ((requestOptions.method || 'GET') !== 'GET') {
    headers['x-csrftoken'] = headers['x-csrftoken'] || getCsrfToken();
  }

  const response = await fetch(url, requestOptions);
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

function normalizeCollection(item) {
  return item?.collection ? item.collection : item;
}

// Create the "nostalgia" collection. The www /api/v1/collections/create/ path
// 404s; the private-API host (i.instagram.com) is the one that serves it -- the
// same host the sync already GETs collections from. Try it first, fall back to
// www, and surface the failing endpoint in the error.
async function createNostalgiaCollection() {
  const headers = { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' };
  const body = new URLSearchParams({
    collection_name: NOSTALGIA_COLLECTION_NAME,
    added_media_ids: '[]'
  }).toString();

  const attempts = [
    'https://i.instagram.com/api/v1/collections/create/',
    'https://www.instagram.com/api/v1/collections/create/'
  ];

  let lastError = null;
  for (const url of attempts) {
    try {
      return await instagramApiRequest(url, { method: 'POST', headers, body, redirect: 'error' });
    } catch (error) {
      const host = url.includes('//i.') ? 'i.instagram' : 'www';
      lastError = new Error(`create collection failed (${host}): ${error.message}`);
    }
  }
  throw lastError;
}

async function ensureNostalgiaCollection() {
  const collections = await fetchCollections();
  const existingCollection = collections
    .map(normalizeCollection)
    .find((collection) => collection?.collection_name?.toLowerCase() === NOSTALGIA_COLLECTION_NAME);

  if (existingCollection) {
    return { collection: existingCollection, collections };
  }

  const created = await createNostalgiaCollection();

  const updatedCollections = await fetchCollections();

  // Prefer the freshly-listed collection (has a stable id); fall back to the
  // create response.
  const listed = updatedCollections
    .map(normalizeCollection)
    .find((collection) => collection?.collection_name?.toLowerCase() === NOSTALGIA_COLLECTION_NAME);

  return {
    collection: listed || normalizeCollection(created),
    collections: updatedCollections
  };
}

// Instagram media ids come as "<pk>_<userPk>"; the web save endpoints want the
// bare pk.
function extractMediaPk(mediaId) {
  return String(mediaId || '').split('_')[0];
}

// POST to Instagram's save/unsave endpoints. Primary path is the `web/save`
// namespace that instagram.com's own client calls from this same origin (takes
// the bare pk); falls back to the `media/` namespace with the full id for
// accounts/sessions where the web route isn't available. Throws the LAST
// error with endpoint context so failures are actually diagnosable.
async function postSaveAction(mediaId, action, params = {}) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' };
  const body = new URLSearchParams({
    radio_type: 'wifi-none',
    module_name: 'nostalgia_extension',
    ...params
  }).toString();

  const attempts = [
    `https://www.instagram.com/api/v1/web/save/${extractMediaPk(mediaId)}/${action}/`,
    `https://www.instagram.com/api/v1/media/${mediaId}/${action}/`
  ];

  let lastError = null;
  for (const url of attempts) {
    try {
      return await instagramApiRequest(url, { method: 'POST', headers, body, redirect: 'error' });
    } catch (error) {
      lastError = new Error(`${action} failed (${url.includes('/web/') ? 'web' : 'media'} endpoint): ${error.message}`);
    }
  }
  throw lastError;
}

async function addPostToCollection(post, collectionId) {
  return postSaveAction(post.id, 'save', {
    added_collection_ids: JSON.stringify([String(collectionId)])
  });
}

async function addPostToNostalgiaCollection(post) {
  const { collection, collections } = await ensureNostalgiaCollection();
  const collectionId = collection?.collection_id || collection?.collection_pk || collection?.id;

  if (!collectionId) {
    throw new Error('Could not determine nostalgia collection id');
  }

  await addPostToCollection(post, collectionId);

  return {
    success: true,
    collectionId,
    collectionName: collection.collection_name || NOSTALGIA_COLLECTION_NAME,
    message: `Saved to ${collection.collection_name || NOSTALGIA_COLLECTION_NAME}`,
    updatedCollections: collections
  };
}

// Get total saved posts count - try user info endpoint first, then estimate from collections
async function fetchTotalSavedCount() {
  try {
    // Try to get from the saved feed count endpoint
    const countUrl = 'https://i.instagram.com/api/v1/feed/saved/all/count/';

    try {
      const countResponse = await fetch(countUrl, {
        method: 'GET',
        ...defaultRequest,
        redirect: 'error'
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
    const url = 'https://i.instagram.com/api/v1/collections/list/?collection_types=["ALL_MEDIA_AUTO_COLLECTION","MEDIA"]&include_public_only=0';

    const response = await fetch(url, {
      method: 'GET',
      ...defaultRequest,
      redirect: 'error'
    });

    if (response.status !== 200) {
      return 0;
    }

    const data = await response.json();

    if (data.items && data.items.length > 0) {
      // Look for ALL_MEDIA_AUTO_COLLECTION first (the "All Posts" collection)
      const allPostsCollection = data.items.find(
        item => item.collection_type === 'ALL_MEDIA_AUTO_COLLECTION' ||
          item.collection_name === 'All Posts'
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

function createPostElement(post, postId, url, thumbnailBase64, carouselMedia = null, savedOrder = 0) {
  // media_type: 1 = photo, 2 = video, 8 = carousel
  const isCarousel = post.media_type === 8;
  const isVideo = post.media_type === 2;

  // Convert taken_at to milliseconds if it's in seconds
  let takenAt = post.taken_at || 0;
  if (takenAt && takenAt < 10000000000) {
    takenAt = takenAt * 1000;
  }
  if (!takenAt) {
    takenAt = Date.now();
  }

  return {
    id: postId,
    link: url,
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
    takenAt: takenAt,
    savedOrder: savedOrder // Track API order for "newest saved" / "oldest saved" sorting
  };
}

async function processPost(post, savedOrder = 0) {
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
        // Note: video URLs are fetched live (FETCH_CAROUSEL_VIDEO) when played,
        // not persisted here — Instagram's video_versions URLs expire and were
        // never read back, so storing them only bloated the database.
        width: item.original_width || item.image_versions2?.candidates?.[0]?.width || 0,
        height: item.original_height || item.image_versions2?.candidates?.[0]?.height || 0
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
      // Silently fail - post will still be saved without thumbnail
      // This prevents slow thumbnails from blocking sync
      console.warn(`Thumbnail failed for ${postId}, continuing without it`);
    }
  }

  return createPostElement(post, postId, url, thumbnailBase64, carouselMedia, savedOrder);
}

const PROGRESS_SAVE_INTERVAL = 5000; // Throttle persistence of progress/cursor state

// Resumable two-phase sync state (survives completion; only cleared by "Clear All Data").
const SYNC_CURSOR_KEY = 'nostalgia_sync_cursor';

function loadSyncCursor() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SYNC_CURSOR_KEY], (result) => {
      const state = result[SYNC_CURSOR_KEY];
      if (state && typeof state === 'object') {
        resolve({
          backfillCursor: state.backfillCursor || '',
          backfillComplete: !!state.backfillComplete
        });
      } else {
        resolve({ backfillCursor: '', backfillComplete: false });
      }
    });
  });
}

function saveSyncCursor(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SYNC_CURSOR_KEY]: state }, resolve);
  });
}

// Resolve when sync is stopped or after `ms`, whichever comes first.
// Event-driven: STOP_SYNC calls notifySyncStopped() which releases every
// pending delay immediately (no 100ms polling).
const syncStopWaiters = [];

function notifySyncStopped() {
  syncStopWaiters.splice(0).forEach((release) => release());
}

function syncDelay(ms) {
  return new Promise((resolve) => {
    if (!isSyncing) {
      resolve();
      return;
    }

    let timer = null;
    const release = () => {
      if (timer) clearTimeout(timer);
      const index = syncStopWaiters.indexOf(release);
      if (index !== -1) syncStopWaiters.splice(index, 1);
      resolve();
    };

    syncStopWaiters.push(release);
    timer = setTimeout(release, ms);
  });
}

// Batch existence check against the local DB for a page of API items.
async function checkExistenceBatch(items, maxAttempts = 3) {
  const postIds = items.map((p) => p.id || `${p.user?.username}-${p.code}`);
  const links = items.map((p) => `https://www.instagram.com/p/${p.code}/`);

  const askOnce = () => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'CHECK_POSTS_BATCH_EXISTS',
      postIds,
      links
    }, (response) => {
      if (chrome.runtime.lastError || !response || !Array.isArray(response.results)) {
        resolve(null);
      } else {
        resolve(response.results);
      }
    });
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const results = await askOnce();
    if (results) return results;
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  // Throw rather than default to "nothing exists": that default made the sync
  // treat the entire library as new (full re-walk of the feed) and produced
  // false order-drift detections. The phase loops catch this and back off.
  throw new Error('Could not check saved-post existence against the local library');
}

function getSyncOrdering() {
  if (typeof self !== 'undefined' && self.NostalgiaSyncOrdering) {
    return self.NostalgiaSyncOrdering;
  }
  // eslint-disable-next-line no-undef
  return NostalgiaSyncOrdering;
}

async function downloadAndCompressThumbnail(imageUrl) {
  const TIMEOUT = 5000; // 5 second timeout for thumbnail download

  try {
    // Add timeout to fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

    const response = await fetch(imageUrl, {
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const timeout = setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Thumbnail processing timeout'));
      }, TIMEOUT);

      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(objectUrl);
        try {
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
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };

      img.src = objectUrl;
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Thumbnail download timeout');
    }
    throw error;
  }
}

async function checkLoggedIn() {
  try {
    // Check if user is logged in by making a HEAD request or checking a lightweight endpoint
    // Use the collections endpoint as it's lightweight and requires authentication
    const response = await fetch('https://i.instagram.com/api/v1/collections/list/?collection_types=["ALL_MEDIA_AUTO_COLLECTION"]&include_public_only=0', {
      method: 'GET',
      ...defaultRequest,
      redirect: 'error'
    });

    // If we get redirected to login or get 401/403, user is not logged in
    if (response.status === 401 || response.status === 403) {
      return false;
    }

    // If we get a 200 or other success status, user is logged in
    if (response.ok) {
      // Don't consume the response body - just check status
      return true;
    }

    // For other status codes, try to parse response to check for login requirement
    try {
      const data = await response.json();
      // Instagram API often returns login_required in error messages
      if (data.message && (data.message.includes('login') || data.message.includes('Login'))) {
        return false;
      }
    } catch (e) {
      // If we can't parse JSON, assume not logged in if status is not OK
      return response.ok;
    }

    return response.ok;
  } catch (error) {
    // If fetch fails (network error, CORS, etc.), assume not logged in
    console.error('Error checking login status:', error);
    return false;
  }
}

// Read the library's postsCount + savedOrder bounds from the background DB with
// retries. Returns null only when the state genuinely can't be determined --
// callers must then abort the sync rather than treat the library as empty.
async function readLibraryStateReliably(maxAttempts = 4) {
  const ask = (message) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError || !response || response.error) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      resolve(null);
    }
  });

  let lastState = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const [countRes, boundsRes] = await Promise.all([
      ask({ action: 'GET_POSTS_COUNT' }),
      ask({ action: 'GET_DB_BOUNDS' })
    ]);

    const postsCount = (countRes && typeof countRes.count === 'number') ? countRes.count : null;
    const dbBounds = boundsRes || null;

    // Cross-check: a zero count alongside real savedOrder bounds means the
    // cached count is stale/corrupt, not that the library is empty.
    const inconsistent = postsCount === 0 &&
      dbBounds && dbBounds.max !== null && dbBounds.max !== undefined;

    if (postsCount !== null && dbBounds && !inconsistent) {
      return { postsCount, dbBounds };
    }

    if (postsCount !== null && dbBounds) {
      lastState = { postsCount, dbBounds };
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  // Messaging worked but count/bounds stayed contradictory: the bounds prove
  // posts exist, so treat the library as NON-empty (protects it from a
  // from-scratch re-download) and let the count catch up later. Only give up
  // entirely (null) when the background never answered at all.
  if (lastState) {
    return { postsCount: Math.max(lastState.postsCount, 1), dbBounds: lastState.dbBounds };
  }

  return null;
}

async function getInstagramSavedPosts() {
  try {
    isSyncing = true;

    // Check if user is logged in before starting sync
    const isLoggedIn = await checkLoggedIn();
    if (!isLoggedIn) {
      const errorMsg = 'You are not logged in to Instagram. Please log in and try again.';
      console.error(errorMsg);
      chrome.runtime.sendMessage({
        action: 'SYNC_LOGIN_REQUIRED',
        error: errorMsg
      });
      isSyncing = false;
      return { syncedCount: 0, failedCount: 0, completed: false, status: SYNC_LOGIN_REQUIRED_STATUS };
    }

    const ordering = getSyncOrdering();

    // Snapshot the DB extents and size. savedOrder anchors are derived from the
    // DB itself every run (no drifting counters): new saves go ABOVE max,
    // historical backfill goes BELOW min.
    //
    // CRITICAL: if this state can't be read (cold service worker at browser
    // startup, DB error), the sync must ABORT -- not assume the DB is empty.
    // Assuming empty made an auto-sync at startup "forget" the whole downloaded
    // library and start again from scratch.
    const libraryState = await readLibraryStateReliably();
    if (!libraryState) {
      isSyncing = false;
      throw new Error('Could not read the local library state (extension database not ready). Sync aborted; please try again in a moment.');
    }

    const dbBounds = libraryState.dbBounds;
    const postsCount = libraryState.postsCount;

    const dbEmpty = postsCount === 0;
    let topMax = (dbBounds && dbBounds.max !== null && dbBounds.max !== undefined) ? dbBounds.max : 0;
    let bottomMin = (dbBounds && dbBounds.min !== null && dbBounds.min !== undefined) ? dbBounds.min : 0;

    // syncedCount reflects total posts in the DB (existing + newly added this run).
    syncedCount = dbEmpty ? 0 : postsCount;
    failedCount = 0;

    // Fetch total saved posts count from Instagram API
    totalSavedCount = await fetchTotalSavedCount();
    console.log(`Total saved posts from Instagram: ${totalSavedCount}`);

    // Show progress bar
    const progressBarContainer = document.getElementById('progress-bar-container');
    if (progressBarContainer) {
      progressBarContainer.style.display = 'block';
    }

    const collections = await fetchCollections();
    chrome.runtime.sendMessage({ action: 'SAVE_COLLECTIONS', collections });

    const cursorState = await loadSyncCursor();
    const phases = ordering.decideSyncPhase({ dbEmpty, backfillComplete: cursorState.backfillComplete });

    const batchBuffer = [];
    let lastPersistAt = 0;

    const flushBatch = async (force) => {
      if (batchBuffer.length === 0) return;
      if (!force && batchBuffer.length < BATCH_SIZE) return;
      const toSave = batchBuffer.splice(0, batchBuffer.length);
      const result = await saveBatch(toSave);
      const added = (result && typeof result.added === 'number') ? result.added : toSave.length;
      syncedCount += added;
      updateSyncProgress(syncedCount, failedCount, totalSavedCount);
    };

    const processAndBuffer = async (post, savedOrder) => {
      try {
        const element = await processPost(post, savedOrder);
        batchBuffer.push(element);
        await flushBatch(false);
      } catch (error) {
        console.error('Error processing post:', error);
        failedCount++;
        updateSyncProgress(syncedCount, failedCount, totalSavedCount);
      }
    };

    updateSyncProgress(syncedCount, failedCount, totalSavedCount);

    // ---------------- Phase A: TOP (saves added since last sync) -------------
    // Walk from the newest until we reconnect with a post already in the DB,
    // then slot the new saves above the current max (newest = highest), with no
    // cross-batch inversion. Skipped when the DB is empty (nothing to reconnect).
    let orderDriftDetected = false;
    if (phases.runTop && isSyncing) {
      const newTop = [];
      let cursor = '';
      let moreAvailable = true;
      let reachedKnown = false;
      let retryCount = 0;

      while (moreAvailable && isSyncing && !reachedKnown) {
        try {
          const page = await fetchSavedPosts(cursor);
          if (!isSyncing) break;

          const items = page.items || [];
          if (items.length === 0) {
            moreAvailable = page.more_available;
            break;
          }

          const exists = await checkExistenceBatch(items);
          const collected = ordering.collectLeadingUnknown(items, exists);
          newTop.push(...collected.newOnes);
          reachedKnown = collected.reachedKnown;
          moreAvailable = page.more_available;
          cursor = page.next_max_id || '';
          retryCount = 0;

          if (reachedKnown) break;
          await syncDelay(500);
        } catch (error) {
          if (!isSyncing) break;
          console.error(`Error in top-phase fetch: ${error.message}`);
          retryCount++;
          if (retryCount > 6) break;
          // Back off harder each attempt: Instagram rate limits (HTTP 572) last
          // minutes, and giving up after ~15s made big syncs "stop" midway.
          await syncDelay(Math.min(60000, 5000 * retryCount));
        }
      }

      if (newTop.length > 0 && isSyncing) {
        const assigned = ordering.assignTopOrders(newTop, topMax);
        topMax += newTop.length;
        for (const entry of assigned) {
          if (!isSyncing) break;
          await processAndBuffer(entry.post, entry.savedOrder);
        }
      }

      // Drift check: the TOP phase assumes everything below the first "known"
      // post it hits is already in the DB (that's what stopped the walk). That
      // only holds once the full history has been backfilled at least once —
      // otherwise "unknown below a known post" is just normal, unfinished
      // backfill. If backfill IS complete and the very next page still has an
      // unknown post, a previously-saved post was likely unsaved and re-saved
      // (jumping to the top on Instagram without carrying its neighbors with
      // it), which the incremental TOP/BACKFILL scheme can't repair on its
      // own. One cheap peek page is enough to catch it without walking the
      // whole feed here; the full repair happens via rebuildSavedOrder().
      if (reachedKnown && moreAvailable && isSyncing && cursorState.backfillComplete) {
        try {
          const peekPage = await fetchSavedPosts(cursor);
          const peekItems = peekPage.items || [];
          if (peekItems.length > 0) {
            const peekExists = await checkExistenceBatch(peekItems);
            orderDriftDetected = peekExists.some((exists) => !exists);
          }
        } catch (error) {
          // Non-critical: skip drift detection on a transient failure.
        }
      }
    }

    // ---------------- Phase B: BACKFILL (historical, resumable) --------------
    // Continue the deep history from the persisted cursor, assigning values
    // below the current min. Resumes across stop/restart until the API reports
    // no more pages (more_available === false), which marks backfill complete.
    if (phases.runBackfill && isSyncing) {
      let cursor = dbEmpty ? '' : (cursorState.backfillCursor || '');
      let moreAvailable = true;
      let retryCount = 0;

      while (moreAvailable && isSyncing) {
        try {
          const page = await fetchSavedPosts(cursor);
          if (!isSyncing) break;

          const items = page.items || [];
          moreAvailable = page.more_available;

          if (items.length > 0) {
            const exists = await checkExistenceBatch(items);
            const newOnes = items.filter((_, i) => !exists[i]);

            if (newOnes.length > 0) {
              const assigned = ordering.assignBackfillOrders(newOnes, bottomMin);
              bottomMin -= newOnes.length;
              for (const entry of assigned) {
                if (!isSyncing) break;
                await processAndBuffer(entry.post, entry.savedOrder);
              }
            }
          }

          cursor = page.next_max_id || '';
          cursorState.backfillCursor = cursor;
          if (!moreAvailable) {
            cursorState.backfillComplete = true;
          }

          const now = Date.now();
          if (now - lastPersistAt >= PROGRESS_SAVE_INTERVAL || !moreAvailable) {
            await saveSyncCursor(cursorState);
            await saveProgress('', '', syncedCount, failedCount, totalSavedCount);
            lastPersistAt = now;
          }

          if (!moreAvailable) break;
          await syncDelay(500);
          retryCount = 0;
        } catch (error) {
          if (!isSyncing) break;
          console.error(`Error in backfill-phase fetch: ${error.message}`);
          retryCount++;
          if (retryCount > 6) break;
          // Back off harder each attempt: Instagram rate limits (HTTP 572) last
          // minutes, and giving up after ~15s made big syncs "stop" midway.
          await syncDelay(Math.min(60000, 5000 * retryCount));
        }
      }
    }

    // Flush whatever remains (even if stopped, persist what we have).
    await flushBatch(true);

    const userStopped = !isSyncing;
    const completed = !userStopped && cursorState.backfillComplete === true;

    // The feed has been fully walked: the real total is what we actually
    // processed. Instagram's estimate over-counts (deleted/private posts), so
    // replace it -- this lets the progress bar reach 100% honestly instead of
    // stalling at the estimate-derived percentage.
    if (completed) {
      totalSavedCount = syncedCount + failedCount;
    }

    // Always persist cursor + counters so a stop/restart resumes cleanly.
    await saveSyncCursor(cursorState);
    await saveProgress('', '', syncedCount, failedCount, totalSavedCount);
    updateSyncProgress(syncedCount, failedCount, totalSavedCount);

    // Clear the UI resume marker only when the whole backfill is finished.
    if (completed) {
      await clearProgress();
    }

    isSyncing = false;
    return { syncedCount, failedCount, completed, orderDriftDetected };
  } catch (error) {
    isSyncing = false;
    console.error(`Error syncing Instagram data: ${error.message}`);
    throw error;
  }
}

// Resumable state for the "Rebuild saved order" maintenance tool.
const REBUILD_STATE_KEY = 'nostalgia_rebuild_state';

function loadRebuildState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([REBUILD_STATE_KEY], (result) => {
      const state = result[REBUILD_STATE_KEY];
      if (state && typeof state === 'object' && Number.isFinite(state.nextOrder)) {
        resolve({ cursor: state.cursor || '', nextOrder: state.nextOrder });
      } else {
        resolve(null);
      }
    });
  });
}

function saveRebuildState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [REBUILD_STATE_KEY]: state }, resolve);
  });
}

function clearRebuildState() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([REBUILD_STATE_KEY], resolve);
  });
}

function updatePostsSavedOrder(updates) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'REBUILD_SAVED_ORDER_BATCH', updates }, (response) => {
      resolve(response || { success: false });
    });
  });
}

// Walk the entire saved feed top-to-bottom and reassign a fresh, strictly
// descending savedOrder to existing posts (newest = highest), repairing order
// that earlier sync bugs may have corrupted. Does NOT re-download thumbnails.
async function rebuildSavedOrder() {
  try {
    isSyncing = true;

    const isLoggedIn = await checkLoggedIn();
    if (!isLoggedIn) {
      chrome.runtime.sendMessage({
        action: 'SYNC_LOGIN_REQUIRED',
        error: 'You are not logged in to Instagram. Please log in and try again.'
      });
      isSyncing = false;
      return { completed: false, status: SYNC_LOGIN_REQUIRED_STATUS };
    }

    totalSavedCount = await fetchTotalSavedCount();

    const progressBarContainer = document.getElementById('progress-bar-container');
    if (progressBarContainer) {
      progressBarContainer.style.display = 'block';
    }

    const resume = await loadRebuildState();
    // Newest gets the highest value; we count down as we walk older. The range
    // must start ABOVE everything already in the DB: posts that are no longer
    // in the feed (deleted/private) keep their old savedOrder, and if the
    // rebuilt range started lower (e.g. at Instagram's total), those dead posts
    // would float to the top of "Newest Saved" -- scrambled-looking order.
    const bounds = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'GET_DB_BOUNDS' }, (response) => {
        resolve((response && !response.error) ? response : { min: null, max: null });
      });
    });
    const dbMax = (bounds && typeof bounds.max === 'number') ? bounds.max : 0;
    const span = Math.max(totalSavedCount, 1000000);
    let nextOrder = resume ? resume.nextOrder : Math.max(dbMax, 0) + span;
    let cursor = resume ? resume.cursor : '';
    let processed = 0;
    let moreAvailable = true;
    let retryCount = 0;
    let lastPersistAt = 0;

    updateSyncProgress(processed, 0, totalSavedCount);

    while (moreAvailable && isSyncing) {
      try {
        const page = await fetchSavedPosts(cursor);
        if (!isSyncing) break;

        const items = page.items || [];
        if (items.length > 0) {
          const updates = items.map((p) => ({
            id: p.id || `${p.user?.username}-${p.code}`,
            link: `https://www.instagram.com/p/${p.code}/`,
            savedOrder: nextOrder--
          }));
          await updatePostsSavedOrder(updates);
          processed += items.length;
          updateSyncProgress(processed, 0, totalSavedCount);
        }

        cursor = page.next_max_id || '';
        moreAvailable = page.more_available;

        const now = Date.now();
        if (now - lastPersistAt >= PROGRESS_SAVE_INTERVAL || !moreAvailable) {
          await saveRebuildState({ cursor, nextOrder });
          lastPersistAt = now;
        }

        if (!moreAvailable) break;
        await syncDelay(500);
        retryCount = 0;
      } catch (error) {
        if (!isSyncing) break;
        console.error(`Error in rebuild fetch: ${error.message}`);
        retryCount++;
        if (retryCount > 6) break;
        // Back off harder each attempt: Instagram rate limits (HTTP 572) last
        // minutes, and giving up after ~15s made big syncs "stop" midway.
        await syncDelay(Math.min(60000, 5000 * retryCount));
      }
    }

    const userStopped = !isSyncing;
    const completed = !userStopped && !moreAvailable;

    if (completed) {
      // We walked the whole feed: order is now authoritative and backfill is done.
      await clearRebuildState();
      await saveSyncCursor({ backfillCursor: '', backfillComplete: true });
      await clearProgress();
    } else {
      await saveRebuildState({ cursor, nextOrder });
    }

    isSyncing = false;
    return { completed, processed };
  } catch (error) {
    isSyncing = false;
    console.error(`Error rebuilding saved order: ${error.message}`);
    throw error;
  }
}

async function saveBatch(posts) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'SAVE_POSTS_BATCH',
      posts: posts
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function saveProgress(minId, maxId, synced, failed, total = 0) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [SYNC_PROGRESS_KEY]: {
        minId: minId || '',
        maxId: maxId || '',
        synced,
        failed,
        total,
        timestamp: Date.now()
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
    action: 'SYNC_PROGRESS_UPDATE',
    synced: synced,
    failed: failed,
    total: total
  });

  const drawer = document.getElementById('instagram-sync-drawer');
  if (!drawer) return;

  const progressElement = drawer.querySelector('#sync-progress');
  if (progressElement) {
    const processed = synced + failed;
    if (total > 0) {
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
  const progressBar = document.getElementById('progress-bar');
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

// If the sync detected saved-order drift (see getInstagramSavedPosts), silently
// run the full rebuild in this same tab before reporting the sync as finished.
// Broadcasts mirror the manual rebuild flow so the UI shows the same progress.
async function runAutoRebuildIfDrifted(result) {
  if (!result || !result.completed || !result.orderDriftDetected) return;

  chrome.runtime.sendMessage({ action: 'REBUILD_STARTED' });
  try {
    const rebuildResult = await rebuildSavedOrder();
    chrome.runtime.sendMessage({
      action: rebuildResult.completed ? 'REBUILD_FINISHED' : 'REBUILD_STOPPED',
      processed: rebuildResult.processed || 0
    });
  } catch (error) {
    console.error(`Error during auto-rebuild: ${error.message}`);
    chrome.runtime.sendMessage({ action: 'REBUILD_STOPPED', processed: 0 });
  }
}

// NOTE: this listener must NOT be declared `async`. An async listener returns a
// Promise, which recent Chrome treats as "this listener will respond
// asynchronously" and then resolves it to `undefined`. Because a second
// onMessage listener below actually answers BUMP_POST_TO_TOP /
// ADD_POST_TO_NOSTALGIA_COLLECTION via sendResponse, the two race and the caller
// often receives `undefined` first -> "No response from Instagram tab". Keeping
// this one synchronous (delegating to a fire-and-forget async helper) leaves the
// response channel entirely to the second listener.
chrome.runtime.onMessage.addListener((request) => {
  handleContentScriptSyncMessage(request);
  // Synchronous return: this listener never uses sendResponse.
  return false;
});

async function handleContentScriptSyncMessage(request) {
  if (request.action === 'SHOW_SYNC_DRAWER') {
    // Sync drawer removed - sync is now handled entirely in the main app
    // No drawer should be shown on Instagram pages
  } else if (request.action === 'START_BACKGROUND_SYNC') {
    // Background sync - no drawer, just start syncing immediately
    try {
      const result = await getInstagramSavedPosts();

      if (result?.status === SYNC_LOGIN_REQUIRED_STATUS) {
        return;
      }

      if (result.completed) {
        await runAutoRebuildIfDrifted(result);
        chrome.runtime.sendMessage({
          action: 'SYNC_FINISHED',
          syncedCount: result.syncedCount,
          failedCount: result.failedCount
        });
      } else {
        // Stopped by the user, or paused mid-backfill — resume is available.
        chrome.runtime.sendMessage({
          action: 'SYNC_STOPPED',
          syncedCount: result.syncedCount,
          failedCount: result.failedCount
        });
      }
    } catch (error) {
      console.error(`Error during background sync: ${error.message}`);
      chrome.runtime.sendMessage({
        action: 'IMPORT_FAILED',
        error: error.message
      });
    }
  } else if (request.action === 'SYNC_COMPLETE') {
    updateSyncDrawer(request.syncedCount, request.failedCount, false);
  } else if (request.action === 'IMPORT_INSTAGRAM_POSTS') {
    try {
      const result = await getInstagramSavedPosts();

      if (!result.completed) {
        updateSyncDrawer(result.syncedCount, result.failedCount, true);
      } else {
        await runAutoRebuildIfDrifted(result);
        chrome.runtime.sendMessage({
          action: 'SYNC_FINISHED',
          syncedCount: result.syncedCount,
          failedCount: result.failedCount
        });
      }
    } catch (error) {
      console.error(`Error during import: ${error.message}`);
      chrome.runtime.sendMessage({
        action: 'IMPORT_FAILED',
        error: error.message
      });

      const drawer = document.getElementById('instagram-sync-drawer');
      if (drawer) {
        const progressElement = drawer.querySelector('#sync-progress');
        if (progressElement) {
          progressElement.innerHTML = `<span style="color: #ff4757;">✗ Error: ${error.message}</span>`;
        }

        const syncButton = drawer.querySelector('#sync-button');
        if (syncButton) {
          syncButton.textContent = 'Retry Sync';
          syncButton.disabled = false;
          syncButton.style.opacity = '1';
        }

        const stopButton = drawer.querySelector('#stop-sync-button');
        if (stopButton) stopButton.remove();
      }
    }
  } else if (request.action === 'STOP_SYNC') {
    isSyncing = false;
    notifySyncStopped();

    const drawer = document.getElementById('instagram-sync-drawer');
    if (drawer) {
      const progressElement = drawer.querySelector('#sync-progress');
      if (progressElement) {
        progressElement.innerHTML = `<span style="color: #fcb045;">Stopping...</span> <span style="opacity: 0.6;">(${syncedCount} synced, ${failedCount} failed)</span>`;
      }
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CS_PING') {
    // Liveness probe: lets the background verify this tab runs a CURRENT
    // content script before dispatching work to it (tabs opened before an
    // extension update run stale scripts that can't respond).
    sendResponse({ pong: true });
    return false;
  }

  if (request.action === 'ADD_POST_TO_NOSTALGIA_COLLECTION') {
    addPostToNostalgiaCollection(request.post)
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.error('Error adding post to nostalgia collection:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'BUMP_POST_TO_TOP') {
    bumpPostOnInstagram(request.post)
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.error('Error bumping post on Instagram:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === 'FETCH_MEDIA_VIDEO') {
    fetchMediaVideoUrl(request.mediaId, request.carouselIndex)
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  return false;
});

// Resolve a post's video URL straight from Instagram's private media-info API,
// reusing this already-authenticated tab. This replaces the old approach of
// spawning (and immediately closing) a throwaway Instagram tab per video, which
// made tabs visibly flash in and out during autoplay/preload.
async function fetchMediaVideoUrl(mediaId, carouselIndex = null) {
  if (!mediaId) {
    return { success: false, error: 'No media id provided' };
  }

  const pickVideoUrl = (node) => {
    const versions = node?.video_versions;
    if (!Array.isArray(versions) || versions.length === 0) return null;
    const withUrl = versions.find(
      (v) => v && typeof v.url === 'string' && v.url.startsWith('http')
    );
    return withUrl?.url || null;
  };

  const data = await instagramApiRequest(
    `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
    { method: 'GET' }
  );
  const media = data?.items?.[0];
  if (!media) {
    return { success: false, error: 'Media info not available' };
  }

  let url = null;
  if (carouselIndex !== null && carouselIndex !== undefined && Array.isArray(media.carousel_media)) {
    url = pickVideoUrl(media.carousel_media[carouselIndex]);
  } else {
    url = pickVideoUrl(media);
    if (!url && Array.isArray(media.carousel_media)) {
      for (const child of media.carousel_media) {
        url = pickVideoUrl(child);
        if (url) break;
      }
    }
  }

  if (url) {
    return { success: true, videoUrl: url };
  }
  return { success: false, error: 'No video found for this media' };
}

// Unsave then immediately re-save a post so Instagram re-sorts it to the top of
// the saved feed (that's how the feed orders: most recently saved first). This
// is what makes it reappear at the top on the user's phone. Note: unsaving also
// drops it from any custom collections; it comes back only to the main saved
// feed.
async function bumpPostOnInstagram(post) {
  if (!post || !post.id) {
    throw new Error('Post metadata is incomplete');
  }

  await postSaveAction(post.id, 'unsave');
  await new Promise((resolve) => setTimeout(resolve, 500));
  await postSaveAction(post.id, 'save');

  return { success: true };
}

// Sync drawer removed - sync is now handled entirely in the main app
// No drawer should be shown on Instagram pages
