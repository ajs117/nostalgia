// App state
let allPosts = [];
let filteredPosts = [];
let displayedPosts = [];
let currentPage = 1;
let postsPerPage = 24;
let currentSort = 'newest';
let currentTypeFilter = 'all';
let currentHashtagFilter = null;
let currentSearchQuery = '';
let randomSeed = Date.now();
let currentModalIndex = -1;

// Helper functions for creating media elements
function createVideoElement(src, useCrossOrigin = false) {
  const video = document.createElement('video');
  video.src = src;
  video.preload = 'metadata';
  video.muted = true;
  video.style.width = '100%';
  video.style.height = '280px';
  video.style.objectFit = 'cover';
  if (useCrossOrigin) {
    video.crossOrigin = 'anonymous';
  }
  video.onerror = () => {
    console.error(`Video playback error:`, src);
    video.parentElement.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Video failed to load</div>';
  };
  return video;
}

function createImageElement(src, useCrossOrigin = false) {
  const img = document.createElement('img');
  const placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="280" height="280"%3E%3Crect fill="%23ddd" width="280" height="280"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-family="Arial"%3EImage not available%3C/text%3E%3C/svg%3E';
  
  // Validate and set image source
  if (!src) {
    console.warn('Image source is null or undefined');
    img.src = placeholder;
  } else if (typeof src === 'string' && src.startsWith('data:')) {
    // Valid base64 data URL
    img.src = src;
    img.alt = 'Instagram post';
    img.loading = 'lazy';
    img.style.width = '100%';
    img.style.height = '280px';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    img.onerror = () => {
      console.error(`Image load error for data URL (first 100 chars):`, src.substring(0, 100));
      img.src = placeholder;
    };
  } else {
    // Invalid source - not a data URL
    console.warn(`Invalid image source (expected data: URL):`, src ? src.substring(0, 100) : 'null');
    img.src = placeholder;
  }
  
  return img;
}

function createPlaceholder(container, message, isError = false) {
  const placeholder = document.createElement('div');
  placeholder.style.cssText = `padding: 20px; text-align: center; color: ${isError ? 'var(--error)' : 'var(--text-secondary)'}; background: var(--bg-secondary); height: 280px; display: flex; align-items: center; justify-content: center;`;
  placeholder.textContent = message;
  container.appendChild(placeholder);
}

// IndexedDB helper function for client-side conversion (legacy support)
function convertIndexedDBKeyToDataURL(key) {
  return new Promise((resolve) => {
    const DB_NAME = 'instagram_media_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'media';
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(key);
      
      getRequest.onsuccess = () => {
        const blob = getRequest.result;
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => {
            console.log(`✓ Converted ${key} to data URL (${(blob.size / 1024).toFixed(2)} KB)`);
            resolve(reader.result);
          };
          reader.onerror = () => {
            console.error(`✗ FileReader error for ${key}`);
            resolve(null);
          };
          reader.readAsDataURL(blob);
        } else {
          console.warn(`✗ No blob found for key: ${key}`);
          resolve(null);
        }
        db.close();
      };
      
      getRequest.onerror = () => {
        console.error('Error retrieving from IndexedDB:', key);
        resolve(null);
        db.close();
      };
    };
    
    request.onerror = () => {
      console.error('Error opening IndexedDB');
      resolve(null);
    };
    
    request.onupgradeneeded = () => {
      // DB doesn't exist yet
      resolve(null);
    };
  });
}

// Show DB Info in modal
function showDbInfo() {
  const modal = document.getElementById('db-modal');
  const content = document.getElementById('db-info-content');
  
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  
  content.innerHTML = `
    <div class="loading-placeholder">
      <div class="spinner"></div>
      <p>Loading database info...</p>
    </div>
  `;
  
  // Get IndexedDB data (which now contains everything)
  chrome.runtime.sendMessage({ action: 'DEBUG_INDEXEDDB' }, (response) => {
    if (chrome.runtime.lastError) {
      content.innerHTML = `
        <div class="error-message">
          <p>Error accessing IndexedDB: ${chrome.runtime.lastError.message}</p>
        </div>
      `;
      return;
    }
    
    if (response && response.success) {
      const data = response.data;
      const posts = data.posts?.data || [];
      const collections = data.collections?.data || [];
      
      // Prepare data for display
      const displayData = {
        indexedDB: {
          media: {
            totalKeys: data.totalKeys,
            imageKeys: data.imageKeys,
            videoKeys: data.videoKeys,
            keys: data.keys,
            sampleData: data.sampleData
          },
          posts: {
            count: posts.length,
            data: posts
          },
          collections: {
            count: collections.length,
            data: collections
          }
        }
      };
      
      const jsonOutput = JSON.stringify(displayData, null, 2);
      
      content.innerHTML = `
        <div class="db-stats">
          <div class="db-stat-item">
            <span class="db-stat-label">Posts (IndexedDB):</span>
            <span class="db-stat-value">${posts.length}</span>
          </div>
          <div class="db-stat-item">
            <span class="db-stat-label">Collections:</span>
            <span class="db-stat-value">${collections.length}</span>
          </div>
          <div class="db-stat-item">
            <span class="db-stat-label">Media Keys:</span>
            <span class="db-stat-value">${data.totalKeys || 0}</span>
          </div>
        </div>
        <div class="db-storage-info">
          <h3>Storage Location</h3>
          <div class="storage-location">
            <strong>IndexedDB:</strong> All data (posts, collections, and media) is stored here
          </div>
        </div>
        <div class="db-raw-data">
          <div class="db-raw-header">
            <h3>Raw Database Data (JSON)</h3>
            <button id="copy-db-data" class="btn btn-secondary btn-small">Copy JSON</button>
          </div>
          <pre id="db-json-output" class="db-json">${escapeHtml(jsonOutput)}</pre>
        </div>
      `;
    
    // Add copy functionality
    document.getElementById('copy-db-data').addEventListener('click', () => {
      const textarea = document.createElement('textarea');
      textarea.value = jsonOutput;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      
      const btn = document.getElementById('copy-db-data');
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    });
    } else {
      content.innerHTML = `
        <div class="error-message">
          <p>Failed to get IndexedDB info: ${response?.error || 'Unknown error'}</p>
        </div>
      `;
    }
  });
}

function closeDbModal() {
  const modal = document.getElementById('db-modal');
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  loadPosts();
  setupMessageListener();
});

// Event listeners
function initializeEventListeners() {
  document.getElementById('search-input').addEventListener('input', handleSearch);
  document.getElementById('sort-select').addEventListener('change', handleSortChange);
  document.getElementById('type-filter').addEventListener('change', handleTypeFilterChange);
  document.getElementById('sync-btn').addEventListener('click', handleSync);
  document.getElementById('clear-btn').addEventListener('click', handleClearStorage);
  document.getElementById('db-info-btn').addEventListener('click', showDbInfo);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('db-modal-close').addEventListener('click', closeDbModal);
  document.getElementById('modal-prev').addEventListener('click', () => navigateModal(-1));
  document.getElementById('modal-next').addEventListener('click', () => navigateModal(1));
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  document.getElementById('db-modal').addEventListener('click', (e) => {
    if (e.target.id === 'db-modal') closeDbModal();
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (currentModalIndex >= 0) {
        closeModal();
      } else if (document.getElementById('db-modal').classList.contains('active')) {
        closeDbModal();
      }
    }
    if (currentModalIndex >= 0) {
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'ArrowRight') navigateModal(1);
    }
  });
}

// Load posts from storage
function loadPosts() {
  chrome.runtime.sendMessage({ action: 'GET_INSTAGRAM_POSTS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading posts:', chrome.runtime.lastError);
      showError('Failed to load posts');
      return;
    }

    if (response && response.success) {
      allPosts = response.posts || [];
      updateStats();
      applyFilters();
    } else {
      showError('No posts found');
      allPosts = [];
      applyFilters();
    }
  });
}

// Message listener for live updates
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'UPDATE_ITEMS') {
      // Immediately reload posts when update is received
      loadPosts();
    }
    return true; // Keep channel open for async response
  });
}

// Search handler
function handleSearch(e) {
  currentSearchQuery = e.target.value.toLowerCase().trim();
  currentPage = 1;
  applyFilters();
}

// Sort handler
function handleSortChange(e) {
  currentSort = e.target.value;
  currentPage = 1;
  if (currentSort === 'random') {
    randomSeed = Date.now();
  }
  applyFilters();
}

// Type filter handler
function handleTypeFilterChange(e) {
  currentTypeFilter = e.target.value;
  currentPage = 1;
  applyFilters();
}

// Hashtag filter handler
function handleHashtagClick(hashtag) {
  if (currentHashtagFilter === hashtag) {
    currentHashtagFilter = null;
  } else {
    currentHashtagFilter = hashtag;
  }
  currentPage = 1;
  applyFilters();
  updateHashtagChips();
}

// Apply all filters
function applyFilters() {
  // Search filter
  let filtered = allPosts.filter(post => {
    if (currentSearchQuery) {
      const searchText = (post.title || '').toLowerCase();
      const username = (post.username || '').toLowerCase();
      return searchText.includes(currentSearchQuery) || username.includes(currentSearchQuery);
    }
    return true;
  });

  // Type filter
  if (currentTypeFilter === 'photo') {
    filtered = filtered.filter(post => !post.isVideo);
  } else if (currentTypeFilter === 'video') {
    filtered = filtered.filter(post => post.isVideo);
  }

  // Hashtag filter
  if (currentHashtagFilter) {
    filtered = filtered.filter(post => {
      const caption = post.title || '';
      const hashtags = extractHashtags(caption);
      return hashtags.includes(currentHashtagFilter);
    });
  }

  // Sort
  filtered = sortPosts(filtered, currentSort);

  filteredPosts = filtered;
  updatePagination();
  renderPosts();
  updateStats();
}

// Sort posts
function sortPosts(posts, sortType) {
  const sorted = [...posts];
  
  if (sortType === 'newest') {
    // Assuming posts are already in order, but we can sort by ID if needed
    return sorted;
  } else if (sortType === 'oldest') {
    return sorted.reverse();
  } else if (sortType === 'random') {
    // Use seeded random for consistent results during same session
    return shuffledArray(sorted, randomSeed);
  }
  
  return sorted;
}

// Fisher-Yates shuffle with seed
function shuffledArray(array, seed) {
  const shuffled = [...array];
  let random = seedGenerator(seed);
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Simple seeded random number generator
function seedGenerator(seed) {
  let value = seed;
  return function() {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

// Extract hashtags from text
function extractHashtags(text) {
  const hashtagRegex = /#[\w]+/g;
  const matches = text.match(hashtagRegex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

// Get all unique hashtags with counts
function getAllHashtags() {
  const hashtagCounts = new Map();
  allPosts.forEach(post => {
    const caption = post.title || '';
    extractHashtags(caption).forEach(tag => {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
    });
  });
  // Convert to array of objects with tag and count, sorted by count descending
  return Array.from(hashtagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .map(item => item.tag); // Return just the tags for backward compatibility
}

// Get hashtags with counts
function getHashtagsWithCounts() {
  const hashtagCounts = new Map();
  allPosts.forEach(post => {
    const caption = post.title || '';
    extractHashtags(caption).forEach(tag => {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
    });
  });
  // Return array sorted by count descending
  return Array.from(hashtagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

// Update hashtag chips
function updateHashtagChips() {
  const container = document.getElementById('hashtag-chips');
  const hashtagsWithCounts = getHashtagsWithCounts();
  
  container.innerHTML = '';
  
  if (hashtagsWithCounts.length === 0) {
    container.innerHTML = '<span style="color: var(--text-secondary); font-size: 12px;">No hashtags found</span>';
    return;
  }

  // Show top 30 hashtags with counts
  hashtagsWithCounts.slice(0, 30).forEach(({ tag, count }) => {
    const chip = document.createElement('span');
    chip.className = `hashtag-chip ${currentHashtagFilter === tag ? 'active' : ''}`;
    chip.innerHTML = `${tag} <span class="hashtag-count">${count}</span>`;
    chip.addEventListener('click', () => handleHashtagClick(tag));
    container.appendChild(chip);
  });
}

// Update pagination
function updatePagination() {
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / postsPerPage));
  // Ensure currentPage is valid
  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * postsPerPage;
  const end = start + postsPerPage;
  displayedPosts = filteredPosts.slice(start, end);

  renderPagination(totalPages);
  updateStats(); // Update stats after pagination changes
}

// Render pagination controls
function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';
  
  // Previous button
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '‹ Previous';
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      updatePagination(); // This now calls updateStats internally
      renderPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  container.appendChild(prevBtn);

  // Page numbers
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = i === currentPage ? 'active' : '';
    btn.addEventListener('click', () => {
      currentPage = i;
      updatePagination(); // This now calls updateStats internally
      renderPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    container.appendChild(btn);
  }

  // Page number input
  const pageInputWrapper = document.createElement('div');
  pageInputWrapper.className = 'page-input-wrapper';
  pageInputWrapper.innerHTML = `
    <span>Go to:</span>
    <input type="number" id="page-input" min="1" max="${totalPages}" value="${currentPage}" />
    <span>of ${totalPages}</span>
  `;
  
  const pageInput = pageInputWrapper.querySelector('#page-input');
  pageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const pageNum = parseInt(pageInput.value, 10);
      if (pageNum >= 1 && pageNum <= totalPages) {
        currentPage = pageNum;
        updatePagination(); // This now calls updateStats internally
        renderPosts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        pageInput.value = currentPage;
      }
    }
  });
  
  pageInput.addEventListener('blur', () => {
    const pageNum = parseInt(pageInput.value, 10);
    if (pageNum >= 1 && pageNum <= totalPages) {
      if (pageNum !== currentPage) {
        currentPage = pageNum;
        updatePagination(); // This now calls updateStats internally
        renderPosts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else {
      pageInput.value = currentPage;
    }
  });
  
  container.appendChild(pageInputWrapper);

  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next ›';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      updatePagination(); // This now calls updateStats internally
      renderPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  container.appendChild(nextBtn);
}

// Render posts with minimal flickering
function renderPosts() {
  const container = document.getElementById('posts-container');
  
  if (displayedPosts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No posts found${currentSearchQuery ? ` matching "${currentSearchQuery}"` : ''}</p>
      </div>
    `;
    return;
  }

  // Get existing post IDs to check what's already rendered
  const existingCards = Array.from(container.querySelectorAll('.post-card'));
  const existingPostIds = new Set(
    existingCards.map(card => card.dataset.postId).filter(Boolean)
  );
  
  // Get displayed post IDs
  const displayedPostIds = new Set(displayedPosts.map(p => p.id));
  
  // Check if we can skip re-rendering (all posts already displayed and in same order)
  const allExist = displayedPosts.every(p => existingPostIds.has(p.id));
  const sameCount = existingCards.length === displayedPosts.length;
  
  if (allExist && sameCount) {
    // All posts already exist, just update indices if needed
    displayedPosts.forEach((post, index) => {
      const card = container.querySelector(`[data-post-id="${post.id}"]`);
      if (card) {
        card.dataset.index = index;
      }
    });
    return;
  }
  
  // Need to re-render, use DocumentFragment to batch DOM updates and prevent flickering
  const fragment = document.createDocumentFragment();
  
  displayedPosts.forEach((post, index) => {
    const card = createPostCard(post, index);
    fragment.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
}

// Create post card element
function createPostCard(post, index) {
  const card = document.createElement('div');
  card.className = 'post-card';
  card.dataset.index = index;
  card.dataset.postId = post.id;

  const mediaContainer = document.createElement('div');
  mediaContainer.style.position = 'relative';

  // Display thumbnail (base64 data URL stored directly in post.image)
  if (post.image && typeof post.image === 'string' && post.image.startsWith('data:')) {
    // Valid base64 data URL - display it
    const img = createImageElement(post.image);
    mediaContainer.appendChild(img);
    
    // Add video indicator if it's a video
    if (post.isVideo) {
      const indicator = document.createElement('div');
      indicator.className = 'video-indicator';
      indicator.innerHTML = '▶ Video';
      mediaContainer.appendChild(indicator);
    }
  } else {
    // No valid image - show placeholder
    const message = post.isVideo ? 'Video thumbnail not available' : 'Image not available';
    createPlaceholder(mediaContainer, message);
    console.warn(`Post ${post.id} has invalid image:`, post.image ? post.image.substring(0, 50) : 'null');
  }

  const overlay = document.createElement('div');
  overlay.className = 'post-overlay';
  overlay.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="10" stroke-width="2"/>
      <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
    </svg>
  `;
  mediaContainer.appendChild(overlay);

  card.appendChild(mediaContainer);

  const info = document.createElement('div');
  info.className = 'post-info';
  
  const title = document.createElement('div');
  title.className = 'post-title';
  title.textContent = post.title || 'Untitled';
  info.appendChild(title);

  const username = document.createElement('div');
  username.className = 'post-username';
  username.textContent = `@${post.username || 'unknown'}`;
  info.appendChild(username);

  const hashtags = extractHashtags(post.title || '');
  if (hashtags.length > 0) {
    const hashtagDiv = document.createElement('div');
    hashtagDiv.className = 'post-hashtags';
    hashtags.slice(0, 3).forEach(tag => {
      const span = document.createElement('span');
      span.className = 'hashtag';
      span.textContent = tag;
      hashtagDiv.appendChild(span);
    });
    if (hashtags.length > 3) {
      hashtagDiv.innerHTML += ` <span style="color: var(--text-secondary);">+${hashtags.length - 3}</span>`;
    }
    info.appendChild(hashtagDiv);
  }

  card.appendChild(info);

  card.addEventListener('click', () => openModal(index));

  return card;
}

// Open modal
function openModal(index) {
  if (index < 0 || index >= displayedPosts.length) return;
  
  const modal = document.getElementById('modal');
  const mediaContainer = document.getElementById('modal-media');
  
  // Stop any currently playing videos before switching
  if (currentModalIndex >= 0 && mediaContainer) {
    const currentVideos = mediaContainer.querySelectorAll('video');
    currentVideos.forEach(video => {
      video.pause();
      video.currentTime = 0;
      video.src = ''; // Clear src to stop loading
    });
  }
  
  currentModalIndex = index;
  const post = displayedPosts[index];
  
  if (!post) return;

  const titleEl = document.getElementById('modal-title');
  const captionEl = document.getElementById('modal-caption');
  const usernameEl = document.getElementById('modal-username');
  const linkEl = document.getElementById('modal-link');
  const hashtagsEl = document.getElementById('modal-hashtags');

  // Clear previous content (this will also remove any remaining video elements)
  mediaContainer.innerHTML = '';

  // Handle videos differently - fetch CDN link from Instagram
  if (post.isVideo) {
    // Show loading state
    mediaContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; color: var(--text-secondary);">
        <div class="spinner" style="margin-bottom: 20px;"></div>
        <p>Loading video...</p>
      </div>
    `;
    
    console.log('Fetching video for post:', post.id, 'link:', post.link);
    
    if (!post.link) {
      console.error('Post has no link field:', post);
      mediaContainer.innerHTML = `
        <p style="color: var(--error); padding: 20px;">Post has no link. Post data: ${JSON.stringify(post).substring(0, 200)}</p>
      `;
      return;
    }
    
    // Request video CDN link from background script
    chrome.runtime.sendMessage({
      action: 'FETCH_VIDEO_CDN',
      permalink: post.link,
      postId: post.id
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error fetching video:', chrome.runtime.lastError);
        mediaContainer.innerHTML = `
          <p style="color: var(--error); padding: 20px;">Failed to load video. <a href="${post.link}" target="_blank" style="color: var(--accent);">View on Instagram</a></p>
        `;
        return;
      }
      
      if (response && response.success && response.videoUrl) {
        // Play the video
        const video = createVideoElement(response.videoUrl, true);
        video.controls = true;
        video.style.maxHeight = '90vh';
        video.style.maxWidth = '100%';
        video.style.width = 'auto';
        video.style.height = 'auto';
        mediaContainer.innerHTML = '';
        mediaContainer.appendChild(video);
      } else {
        // Failed to get video URL
        const errorMsg = response?.error || 'Unknown error';
        console.error('Failed to fetch video URL:', errorMsg);
        mediaContainer.innerHTML = `
          <p style="color: var(--error); padding: 20px;">Failed to load video: ${errorMsg}. <a href="${post.link}" target="_blank" style="color: var(--accent);">View on Instagram</a></p>
        `;
      }
    });
  } else if (post.image && typeof post.image === 'string' && post.image.startsWith('data:')) {
    // Display image for photos
    const img = document.createElement('img');
    img.src = post.image;
    img.alt = post.title || 'Instagram post';
    img.style.maxHeight = '70vh';
    img.style.width = 'auto';
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    img.style.margin = '0 auto';
    img.onerror = () => {
      console.error(`Modal image error for post ${post.id}:`, post.image ? post.image.substring(0, 100) : 'null');
      mediaContainer.innerHTML = '<p style="color: var(--error); padding: 20px;">Image failed to load</p>';
    };
    mediaContainer.appendChild(img);
  } else {
    // No valid image - show message
    mediaContainer.innerHTML = '<p style="color: var(--text-secondary); padding: 20px;">Image not available</p>';
    console.warn(`Modal: Post ${post.id} has invalid image:`, post.image ? post.image.substring(0, 50) : 'null');
  }

  titleEl.textContent = post.title || 'Untitled';
  captionEl.textContent = post.title || '';
  usernameEl.textContent = `@${post.username || 'unknown'}`;
  linkEl.href = post.link || '#';

  const hashtags = extractHashtags(post.title || '');
  hashtagsEl.innerHTML = '';
  if (hashtags.length > 0) {
    hashtags.forEach(tag => {
      const span = document.createElement('span');
      span.className = 'hashtag';
      span.textContent = tag;
      hashtagsEl.appendChild(span);
    });
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Update nav buttons
  document.getElementById('modal-prev').style.display = index > 0 ? 'flex' : 'none';
  document.getElementById('modal-next').style.display = index < displayedPosts.length - 1 ? 'flex' : 'none';
}

// Close modal
function closeModal() {
  const modal = document.getElementById('modal');
  
  // Stop any playing videos
  const mediaContainer = modal.querySelector('#modal-media') || modal.querySelector('.modal-media');
  if (mediaContainer) {
    const videos = mediaContainer.querySelectorAll('video');
    videos.forEach(video => {
      video.pause();
      video.currentTime = 0;
      video.src = ''; // Clear src to stop loading
    });
  }
  
  modal.classList.remove('active');
  document.body.style.overflow = '';
  currentModalIndex = -1;
}

// Navigate modal
function navigateModal(direction) {
  const newIndex = currentModalIndex + direction;
  if (newIndex >= 0 && newIndex < displayedPosts.length) {
    openModal(newIndex);
  }
}

// Update stats
function updateStats() {
  document.getElementById('total-count').textContent = `${allPosts.length} posts`;
  
  // Calculate current page range
  const startIndex = (currentPage - 1) * postsPerPage;
  const endIndex = Math.min(startIndex + postsPerPage, filteredPosts.length);
  const pageCount = endIndex > startIndex ? endIndex - startIndex : 0;
  
  document.getElementById('filtered-count').textContent = pageCount > 0 ? `Showing ${startIndex + 1}-${endIndex} of ${filteredPosts.length}` : 'Showing 0';
  const totalPages = Math.ceil(filteredPosts.length / postsPerPage);
  document.getElementById('page-info').textContent = totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : 'Page 1';
  
  // Update hashtag chips
  updateHashtagChips();
}

// Handle sync
function handleSync() {
  chrome.runtime.sendMessage({ action: 'SYNC_WITH_INSTAGRAM' });
  updateSyncStatus('syncing', 'Syncing with Instagram...');
  
  // Listen for sync completion
  chrome.runtime.onMessage.addListener(function listener(request) {
    if (request.action === 'SYNC_COMPLETE') {
      updateSyncStatus('success', `Sync complete! ${request.syncedCount} posts synced`);
      loadPosts();
      setTimeout(() => {
        updateSyncStatus('', '');
      }, 3000);
      chrome.runtime.onMessage.removeListener(listener);
    } else if (request.action === 'IMPORT_FAILED') {
      updateSyncStatus('error', 'Sync failed. Please try again.');
      setTimeout(() => {
        updateSyncStatus('', '');
      }, 3000);
      chrome.runtime.onMessage.removeListener(listener);
    }
  });
}

// Update sync status
function updateSyncStatus(status, message) {
  const statusEl = document.getElementById('sync-status');
  statusEl.className = `sync-status ${status}`;
  statusEl.textContent = message;
  statusEl.style.display = message ? 'block' : 'none';
}

// Handle clear storage
function handleClearStorage() {
  const confirmMessage = `Are you sure you want to clear all stored posts and media?\n\nThis will delete:\n• All saved Instagram posts\n• All images and videos\n• All collections\n\nThis action cannot be undone!`;
  
  if (confirm(confirmMessage)) {
    const clearBtn = document.getElementById('clear-btn');
    clearBtn.disabled = true;
    clearBtn.textContent = 'Clearing...';
    
    // Clear chrome.storage.local
    chrome.storage.local.clear(() => {
      // Clear IndexedDB
      clearIndexedDB().then(() => {
        allPosts = [];
        filteredPosts = [];
        displayedPosts = [];
        currentPage = 1;
        
        updateSyncStatus('success', 'Storage cleared successfully');
        applyFilters();
        renderPosts();
        
        clearBtn.disabled = false;
        clearBtn.textContent = 'Clear Storage';
        
        setTimeout(() => {
          updateSyncStatus('', '');
        }, 3000);
      }).catch((error) => {
        console.error('Error clearing IndexedDB:', error);
        updateSyncStatus('error', 'Error clearing storage');
        clearBtn.disabled = false;
        clearBtn.textContent = 'Clear Storage';
        setTimeout(() => {
          updateSyncStatus('', '');
        }, 3000);
      });
    });
  }
}

// Clear IndexedDB
function clearIndexedDB() {
  return new Promise((resolve, reject) => {
    const DB_NAME = 'instagram_media_db';
    const DB_VERSION = 1;
    
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
      console.warn('IndexedDB delete blocked');
      // Try again after a short delay
      setTimeout(() => {
        const retryRequest = indexedDB.deleteDatabase(DB_NAME);
        retryRequest.onsuccess = () => resolve();
        retryRequest.onerror = () => reject(retryRequest.error);
      }, 1000);
    };
  });
}

// Show error
function showError(message) {
  const container = document.getElementById('posts-container');
  container.innerHTML = `
    <div class="empty-state">
      <p style="color: var(--error);">${message}</p>
    </div>
  `;
}

