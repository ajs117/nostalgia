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

  // Load collection count from IndexedDB
  chrome.runtime.sendMessage({ action: 'GET_COLLECTIONS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading collections:', chrome.runtime.lastError);
      document.getElementById('total-collections').textContent = '0';
      return;
    }
    if (response && response.success) {
      document.getElementById('total-collections').textContent = response.collections.length;
    } else {
      document.getElementById('total-collections').textContent = '0';
    }
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
    
    // Clear IndexedDB (which now contains everything)
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
    
    // First, clear all data from stores, then delete database
    const openRequest = indexedDB.open(DB_NAME);
    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const stores = ['media', 'posts', 'collections'];
      let cleared = 0;
      
      stores.forEach(storeName => {
        if (db.objectStoreNames.contains(storeName)) {
          const transaction = db.transaction([storeName], 'readwrite');
          const store = transaction.objectStore(storeName);
          const clearRequest = store.clear();
          clearRequest.onsuccess = () => {
            cleared++;
            if (cleared === stores.length) {
              db.close();
              // Now delete the database
              const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
              deleteRequest.onsuccess = () => {
                console.log('IndexedDB cleared successfully');
                resolve();
              };
              deleteRequest.onerror = () => {
                console.error('Error deleting IndexedDB:', deleteRequest.error);
                reject(deleteRequest.error);
              };
            }
          };
          clearRequest.onerror = () => {
            cleared++;
            if (cleared === stores.length) {
              db.close();
              const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
              deleteRequest.onsuccess = () => resolve();
              deleteRequest.onerror = () => reject(deleteRequest.error);
            }
          };
        } else {
          cleared++;
          if (cleared === stores.length) {
            db.close();
            const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = () => reject(deleteRequest.error);
          }
        }
      });
    };
    openRequest.onerror = () => {
      // If DB doesn't exist, that's fine
      resolve();
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
