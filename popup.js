// Popup script
document.addEventListener('DOMContentLoaded', () => {
  initializePopup();
});

function initializePopup() {
  loadStats();
  setupEventListeners();
}

function setupEventListeners() {
  // Open main viewer
  document.getElementById('open-main').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_MAIN_VIEWER' }, () => {
      window.close();
    });
  });

  // Sync now
  document.getElementById('sync-now').addEventListener('click', () => {
    const btn = document.getElementById('sync-now');
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="loading">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="12" stroke-dashoffset="12">
          <animate attributeName="stroke-dasharray" values="0 31.416;31.416 0" dur="1.5s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dashoffset" values="0;-31.416" dur="1.5s" repeatCount="indefinite"/>
        </circle>
      </svg>
      Syncing...
    `;
    
    chrome.runtime.sendMessage({ action: 'SYNC_WITH_INSTAGRAM' }, () => {
      showStatus('Syncing started. Opening Instagram...', 'syncing');
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1V7H14M14 9V15H8M2 7H8V1M8 9V15H2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Sync Now
        `;
        window.close();
      }, 1000);
    });
  });

  // Clear storage
  document.getElementById('clear-storage').addEventListener('click', handleClearStorage);
}

function loadStats() {
  // Load post count
  chrome.runtime.sendMessage({ action: 'GET_INSTAGRAM_POSTS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading stats:', chrome.runtime.lastError);
      return;
    }

    if (response && response.success) {
      const posts = response.posts || [];
      document.getElementById('total-posts').textContent = posts.length;
    }
  });

  // Load collection count
  chrome.storage.local.get(['instagramCollections'], (result) => {
    let collections = [];
    try {
      collections = result.instagramCollections ? JSON.parse(result.instagramCollections) : [];
    } catch (error) {
      console.error('Error parsing collections:', error);
    }
    document.getElementById('total-collections').textContent = collections.length;
  });
}

function handleClearStorage() {
  const confirmMessage = `Clear all stored data?\n\nThis will delete:\n• All posts\n• All media\n• All collections\n\nThis cannot be undone!`;
  
  if (confirm(confirmMessage)) {
    const btn = document.getElementById('clear-storage');
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="loading">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="12" stroke-dashoffset="12">
          <animate attributeName="stroke-dasharray" values="0 31.416;31.416 0" dur="1.5s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dashoffset" values="0;-31.416" dur="1.5s" repeatCount="indefinite"/>
        </circle>
      </svg>
      Clearing...
    `;
    
    // Clear chrome.storage.local
    chrome.storage.local.clear(() => {
      // Clear IndexedDB
      clearIndexedDB().then(() => {
        showStatus('Storage cleared successfully!', 'success');
        loadStats();
        
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Clear Storage
        `;
        
        setTimeout(() => {
          hideStatus();
        }, 3000);
      }).catch((error) => {
        console.error('Error clearing IndexedDB:', error);
        showStatus('Error clearing storage', 'error');
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Clear Storage
        `;
        setTimeout(() => {
          hideStatus();
        }, 3000);
      });
    });
  }
}

function clearIndexedDB() {
  return new Promise((resolve, reject) => {
    const DB_NAME = 'instagram_media_db';
    
    const request = indexedDB.deleteDatabase(DB_NAME);
    
    request.onsuccess = () => {
      console.log('IndexedDB cleared successfully');
      resolve();
    };
    
    request.onerror = () => {
      console.error('Error clearing IndexedDB:', request.error);
      reject(request.error);
    };
    
    request.onblocked = () => {
      setTimeout(() => {
        const retryRequest = indexedDB.deleteDatabase(DB_NAME);
        retryRequest.onsuccess = () => resolve();
        retryRequest.onerror = () => reject(retryRequest.error);
      }, 1000);
    };
  });
}

function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('popup-status');
  statusEl.textContent = message;
  statusEl.className = `popup-status status ${type} show`;
}

function hideStatus() {
  const statusEl = document.getElementById('popup-status');
  statusEl.className = 'popup-status hidden';
}
