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
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="spin">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="12" stroke-dashoffset="12">
          <animate attributeName="stroke-dasharray" values="0 31.416;31.416 0" dur="1.5s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dashoffset" values="0;-31.416" dur="1.5s" repeatCount="indefinite"/>
        </circle>
      </svg>
      Syncing...
    `;
    
    chrome.runtime.sendMessage({ action: 'SYNC_WITH_INSTAGRAM' }, () => {
      showStatus('Syncing started!', 'syncing');
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.3"/>
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
  // Load post count using the fast count endpoint
  chrome.runtime.sendMessage({ action: 'GET_POSTS_COUNT' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading stats:', chrome.runtime.lastError);
      document.getElementById('total-posts').textContent = '0';
      return;
    }

    document.getElementById('total-posts').textContent = response?.count || 0;
  });

  // Load collection count
  chrome.runtime.sendMessage({ action: 'GET_COLLECTIONS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading collections:', chrome.runtime.lastError);
      document.getElementById('total-collections').textContent = '0';
      return;
    }
    document.getElementById('total-collections').textContent = response?.collections?.length || 0;
  });
}

function handleClearStorage() {
  const confirmMessage = `Clear all stored data?\n\n• All posts\n• All media\n• All collections\n\nThis cannot be undone!`;
  
  if (confirm(confirmMessage)) {
    const btn = document.getElementById('clear-storage');
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="spin">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="12" stroke-dashoffset="12">
          <animate attributeName="stroke-dasharray" values="0 31.416;31.416 0" dur="1.5s" repeatCount="indefinite"/>
          <animate attributeName="stroke-dashoffset" values="0;-31.416" dur="1.5s" repeatCount="indefinite"/>
        </circle>
      </svg>
      Clearing...
    `;
    
    // Use the background script's CLEAR_STORAGE action
    chrome.runtime.sendMessage({ action: 'CLEAR_STORAGE' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        console.error('Error clearing storage:', chrome.runtime.lastError || response?.error);
        showStatus('Error clearing storage', 'error');
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Clear Storage
        `;
        return;
      }
      
      showStatus('Storage cleared!', 'success');
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
    });
  }
}

function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('popup-status');
  statusEl.textContent = message;
  statusEl.className = `popup-status ${type}`;
  statusEl.style.display = 'block';
}

function hideStatus() {
  const statusEl = document.getElementById('popup-status');
  statusEl.style.display = 'none';
}
