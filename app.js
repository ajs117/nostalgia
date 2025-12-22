// App state
let allPosts = [];
let displayedPosts = [];
let currentPage = 1;
let postsPerPage = 20; // Will be adjusted for complete rows
let currentSort = 'newest-saved';
let currentTypeFilter = 'all';
let currentHashtagFilter = null;
let currentSearchQuery = '';
let currentModalIndex = -1;
let currentCarouselIndex = 0; // Track which item in a carousel is being viewed
let isLoading = false;
let totalPosts = 0;
let isSyncing = false;

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Helper functions for creating media elements
function createVideoElement(src) {
  const video = document.createElement('video');
  video.src = src;
  video.preload = 'metadata';
  video.muted = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  video.onerror = () => {
    console.error('Video playback error:', src);
    video.parentElement.innerHTML = '<div class="media-error">Video failed to load</div>';
  };
  return video;
}

function createImageElement(src) {
  const img = document.createElement('img');
  const placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="280" height="280"%3E%3Crect fill="%231a1a1a" width="280" height="280"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23666" font-family="system-ui"%3ENo image%3C/text%3E%3C/svg%3E';

  if (!src) {
    img.src = placeholder;
  } else if (typeof src === 'string' && src.startsWith('data:')) {
    img.src = src;
    img.alt = 'Instagram post';
    img.loading = 'lazy';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    img.onerror = () => {
      img.src = placeholder;
    };
  } else {
    img.src = placeholder;
  }

  return img;
}

function createPlaceholder(container, message, isError = false) {
  const placeholder = document.createElement('div');
  placeholder.className = 'media-placeholder';
  placeholder.textContent = message;
  if (isError) placeholder.classList.add('error');
  container.appendChild(placeholder);
}

// Get number of grid columns based on screen width
function getGridColumns() {
  const width = window.innerWidth;
  if (width <= 480) return 2;
  if (width <= 768) return 2;
  if (width <= 1024) return 3;
  if (width <= 1200) return 4;
  return 5;
}

// Calculate posts per page for complete rows
function calculatePostsPerPage() {
  const cols = getGridColumns();
  const rows = 4; // Show 4 complete rows
  return cols * rows;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  postsPerPage = calculatePostsPerPage();
  initializeEventListeners();
  loadPosts(false, true); // Load posts and fetch hashtags after posts load successfully
  setupMessageListener();
  setupMobileFilters();
  setupSyncPanel();

  // Clear any stale sync status on fresh page load
  // The status will be updated if there's an active sync via messages
  updateSyncStatus('', '');

  // Recalculate on resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const newPostsPerPage = calculatePostsPerPage();
      if (newPostsPerPage !== postsPerPage) {
        postsPerPage = newPostsPerPage;
        loadPosts();
      }
    }, 250);
  });
});

// Event listeners
function initializeEventListeners() {
  // Desktop search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(handleSearch, 300));
  }

  // Desktop filters
  const sortSelect = document.getElementById('sort-select');
  const typeFilter = document.getElementById('type-filter');
  if (sortSelect) sortSelect.addEventListener('change', handleSortChange);
  if (typeFilter) typeFilter.addEventListener('change', handleTypeFilterChange);

  // Mobile search
  const searchInputMobile = document.getElementById('search-input-mobile');
  if (searchInputMobile) {
    searchInputMobile.addEventListener('input', debounce(handleSearchMobile, 300));
  }

  // Mobile filters
  const sortSelectMobile = document.getElementById('sort-select-mobile');
  const typeFilterMobile = document.getElementById('type-filter-mobile');
  if (sortSelectMobile) sortSelectMobile.addEventListener('change', handleSortChangeMobile);
  if (typeFilterMobile) typeFilterMobile.addEventListener('change', handleTypeFilterChangeMobile);

  // Sync button - now opens sync panel
  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', openSyncPanel);

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  document.getElementById('modal-prev').addEventListener('click', () => navigateModal(-1));
  document.getElementById('modal-next').addEventListener('click', () => navigateModal(1));

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentModalIndex >= 0) {
      closeModal();
    }
    if (currentModalIndex >= 0) {
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'ArrowRight') navigateModal(1);
    }
  });
}

// Mobile filters drawer
function setupMobileFilters() {
  const toggle = document.getElementById('mobile-filters-toggle');
  const drawer = document.getElementById('mobile-filters-drawer');
  const overlay = document.getElementById('drawer-overlay');
  const closeBtn = document.getElementById('close-filters');

  if (!toggle || !drawer || !overlay) return;

  toggle.addEventListener('click', () => {
    drawer.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  });

  const closeDrawer = () => {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
}

// Load posts with pagination from background
function loadPosts(append = false, fetchHashtagsAfter = false) {
  if (isLoading) return;

  isLoading = true;
  showLoadingState();

  chrome.runtime.sendMessage({
    action: 'GET_INSTAGRAM_POSTS',
    page: currentPage,
    limit: postsPerPage,
    sortBy: currentSort,
    filterType: currentTypeFilter,
    searchQuery: currentSearchQuery,
    hashtagFilter: currentHashtagFilter
  }, (response) => {
    isLoading = false;
    hideLoadingState();

    if (chrome.runtime.lastError) {
      console.error('Error loading posts:', chrome.runtime.lastError);
      showError('Failed to load posts');
      return;
    }

    if (response && response.success) {
      if (append) {
        allPosts = [...allPosts, ...(response.posts || [])];
      } else {
        allPosts = response.posts || [];
      }
      totalPosts = response.total || 0;

      // Apply local filters (like hashtag) after loading
      applyLocalFilters();
      renderPagination();

      // Show hashtags from current page immediately (fallback)
      if (allHashtagsCache.length === 0 && allPosts.length > 0) {
        updateHashtagsFromCurrentPosts();
      }

      // Fetch hashtags after posts are loaded (service worker is ready)
      if (fetchHashtagsAfter) {
        fetchAllHashtags();
      } else if (allHashtagsCache.length === 0) {
        // If hashtags cache is empty, try to fetch from database
        fetchAllHashtags();
      }
    } else {
      showError('No posts found. Click "Sync Posts" to import your Instagram saved posts.');
      allPosts = [];
      totalPosts = 0;
      renderPosts();

      // Still try to fetch hashtags even if no posts on this page
      if (fetchHashtagsAfter) {
        fetchAllHashtags();
      }
    }
  });
}

// Show loading state
function showLoadingState() {
  const container = document.getElementById('posts-container');

  if (container.children.length === 0) {
    container.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'post-card skeleton';
      skeleton.innerHTML = `
        <div class="skeleton-image"></div>
        <div class="skeleton-info">
          <div class="skeleton-title"></div>
          <div class="skeleton-username"></div>
        </div>
      `;
      container.appendChild(skeleton);
    }
  }
}

function hideLoadingState() {
  const skeletons = document.querySelectorAll('.post-card.skeleton');
  skeletons.forEach(s => s.remove());
}

// Message listener for live updates
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'UPDATE_ITEMS') {
      // Don't reset page during sync - preserve user's current page position
      loadPosts();
      fetchAllHashtags(); // Refresh hashtags when posts are updated
    } else if (request.action === 'SYNC_STARTED') {
      handleSyncStarted();
    } else if (request.action === 'SYNC_PROGRESS') {
      updateSyncPanelProgress(request.synced, request.failed, request.total);
    } else if (request.action === 'SYNC_COMPLETE') {
      handleSyncComplete(request.syncedCount, request.failedCount);
      currentPage = 1;
      loadPosts();
      fetchAllHashtags(); // Refresh hashtags after sync
    } else if (request.action === 'IMPORT_FAILED') {
      handleSyncError(request.error || 'Sync failed. Please try again.');
    } else if (request.action === 'SYNC_STOPPED') {
      handleSyncStopped(request.syncedCount, request.failedCount);
    }
    return true;
  });
}

// Search handlers
function handleSearch(e) {
  currentSearchQuery = e.target.value.toLowerCase().trim();
  // Sync with mobile
  const mobileInput = document.getElementById('search-input-mobile');
  if (mobileInput) mobileInput.value = e.target.value;
  currentPage = 1;
  loadPosts();
}

function handleSearchMobile(e) {
  currentSearchQuery = e.target.value.toLowerCase().trim();
  // Sync with desktop
  const desktopInput = document.getElementById('search-input');
  if (desktopInput) desktopInput.value = e.target.value;
  currentPage = 1;
  loadPosts();
}

// Sort handlers
function handleSortChange(e) {
  currentSort = e.target.value;
  // Sync with mobile
  const mobileSelect = document.getElementById('sort-select-mobile');
  if (mobileSelect) mobileSelect.value = e.target.value;
  currentPage = 1;
  loadPosts();
}

function handleSortChangeMobile(e) {
  currentSort = e.target.value;
  // Sync with desktop
  const desktopSelect = document.getElementById('sort-select');
  if (desktopSelect) desktopSelect.value = e.target.value;
  currentPage = 1;
  loadPosts();
}

// Type filter handlers
function handleTypeFilterChange(e) {
  currentTypeFilter = e.target.value;
  // Sync with mobile
  const mobileSelect = document.getElementById('type-filter-mobile');
  if (mobileSelect) mobileSelect.value = e.target.value;
  currentPage = 1;
  loadPosts();
}

function handleTypeFilterChangeMobile(e) {
  currentTypeFilter = e.target.value;
  // Sync with desktop
  const desktopSelect = document.getElementById('type-filter');
  if (desktopSelect) desktopSelect.value = e.target.value;
  currentPage = 1;
  loadPosts();
}

// Hashtag filter handler
function handleHashtagClick(hashtag) {
  if (currentHashtagFilter === hashtag) {
    currentHashtagFilter = null;
  } else {
    currentHashtagFilter = hashtag;
  }
  currentPage = 1;
  loadPosts(); // Reload with new hashtag filter
}

// Apply local filters (all filtering now done server-side in background.js)
function applyLocalFilters() {
  // All filtering (type, search, hashtag) is now done at the database level
  // This function just sets up the display arrays
  displayedPosts = allPosts;
  renderPosts();
  updateStats();
}

// Extract hashtags from text
function extractHashtags(text) {
  const hashtagRegex = /#[\w]+/g;
  const matches = text.match(hashtagRegex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

// Cache for all hashtags from database
let allHashtagsCache = [];

// Fetch all hashtags from database
function fetchAllHashtags() {
  chrome.runtime.sendMessage({ action: 'GET_ALL_HASHTAGS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error fetching hashtags:', chrome.runtime.lastError);
      // Fallback: use hashtags from current page posts
      updateHashtagsFromCurrentPosts();
      return;
    }

    if (response && response.success && Array.isArray(response.hashtags)) {
      allHashtagsCache = response.hashtags;
      updateHashtagChips();
    } else if (response && Array.isArray(response.hashtags)) {
      allHashtagsCache = response.hashtags;
      updateHashtagChips();
    } else {
      // Fallback: use hashtags from current page posts
      updateHashtagsFromCurrentPosts();
    }
  });
}

// Fallback: extract hashtags from currently loaded posts
function updateHashtagsFromCurrentPosts() {
  const hashtagCounts = new Map();
  allPosts.forEach(post => {
    const caption = post.title || '';
    extractHashtags(caption).forEach(tag => {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
    });
  });
  allHashtagsCache = Array.from(hashtagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
  updateHashtagChips();
}

// Get hashtags with counts (uses cached data from database)
function getHashtagsWithCounts() {
  return allHashtagsCache;
}

// Update hashtag chips (both desktop and mobile)
function updateHashtagChips() {
  const containers = [
    document.getElementById('hashtag-chips'),
    document.getElementById('hashtag-chips-mobile')
  ].filter(Boolean);

  const hashtagsWithCounts = getHashtagsWithCounts();

  containers.forEach(container => {
    container.innerHTML = '';

    if (hashtagsWithCounts.length === 0) {
      container.innerHTML = '<span class="no-hashtags">No hashtags found</span>';
      return;
    }

    hashtagsWithCounts.slice(0, 25).forEach(({ tag, count }) => {
      const chip = document.createElement('span');
      chip.className = `hashtag-chip ${currentHashtagFilter === tag ? 'active' : ''}`;
      chip.innerHTML = `${tag} <span class="hashtag-count">${count}</span>`;
      chip.addEventListener('click', () => handleHashtagClick(tag));
      container.appendChild(chip);
    });
  });
}

// Render pagination controls
function renderPagination() {
  const container = document.getElementById('pagination');
  const totalPages = Math.max(1, Math.ceil(totalPosts / postsPerPage));

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';

  // Previous button
  const prevBtn = document.createElement('button');
  prevBtn.innerHTML = '← Prev';
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  container.appendChild(prevBtn);

  // Page numbers
  const maxVisible = 7;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  if (startPage > 1) {
    const firstBtn = document.createElement('button');
    firstBtn.textContent = '1';
    firstBtn.addEventListener('click', () => {
      currentPage = 1;
      loadPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    container.appendChild(firstBtn);

    if (startPage > 2) {
      const ellipsis = document.createElement('span');
      ellipsis.className = 'pagination-ellipsis';
      ellipsis.textContent = '...';
      container.appendChild(ellipsis);
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = i === currentPage ? 'active' : '';
    btn.addEventListener('click', () => {
      currentPage = i;
      loadPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    container.appendChild(btn);
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const ellipsis = document.createElement('span');
      ellipsis.className = 'pagination-ellipsis';
      ellipsis.textContent = '...';
      container.appendChild(ellipsis);
    }

    const lastBtn = document.createElement('button');
    lastBtn.textContent = totalPages;
    lastBtn.addEventListener('click', () => {
      currentPage = totalPages;
      loadPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    container.appendChild(lastBtn);
  }

  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.innerHTML = 'Next →';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      loadPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  container.appendChild(nextBtn);
}

// Render posts
function renderPosts() {
  const container = document.getElementById('posts-container');

  if (displayedPosts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📸</div>
        <p>No posts found${currentSearchQuery ? ` matching "${currentSearchQuery}"` : ''}</p>
        <p class="empty-hint">Try adjusting your filters or sync more posts</p>
      </div>
    `;
    return;
  }

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
  mediaContainer.className = 'post-media';

  // Display thumbnail
  const imgSrc = post.image || post.thumbnail;
  if (imgSrc && typeof imgSrc === 'string' && imgSrc.startsWith('data:')) {
    const img = createImageElement(imgSrc);
    mediaContainer.appendChild(img);

    // Show carousel indicator for multi-item posts
    if (post.isCarousel && post.carouselCount > 1) {
      const indicator = document.createElement('div');
      indicator.className = 'carousel-indicator';
      indicator.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h12V6H6z"/>
          <path d="M9 4V2h12a2 2 0 012 2v12h-2V4H9z" opacity="0.6"/>
        </svg>
        <span>${post.carouselCount}</span>
      `;
      mediaContainer.appendChild(indicator);
    } else if (post.isVideo) {
      const indicator = document.createElement('div');
      indicator.className = 'video-indicator';
      indicator.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <path d="M8 5v14l11-7z"/>
        </svg>
      `;
      mediaContainer.appendChild(indicator);
    }
  } else {
    createPlaceholder(mediaContainer, post.isVideo ? '🎬' : (post.isCarousel ? '📸' : '📷'));
  }

  const overlay = document.createElement('div');
  overlay.className = 'post-overlay';
  overlay.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="32" height="32">
      <circle cx="12" cy="12" r="10" stroke-width="2"/>
      <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
    </svg>
  `;
  mediaContainer.appendChild(overlay);

  card.appendChild(mediaContainer);

  const info = document.createElement('div');
  info.className = 'post-info';

  const username = document.createElement('div');
  username.className = 'post-username';
  username.textContent = `@${post.username || 'unknown'}`;
  info.appendChild(username);

  const title = document.createElement('div');
  title.className = 'post-title';
  title.textContent = truncateText(post.title || '', 50);
  info.appendChild(title);

  const hashtags = extractHashtags(post.title || '');
  if (hashtags.length > 0) {
    const hashtagDiv = document.createElement('div');
    hashtagDiv.className = 'post-hashtags';
    hashtags.slice(0, 2).forEach(tag => {
      const span = document.createElement('span');
      span.className = 'hashtag';
      span.textContent = tag;
      hashtagDiv.appendChild(span);
    });
    if (hashtags.length > 2) {
      const more = document.createElement('span');
      more.className = 'hashtag-more';
      more.textContent = `+${hashtags.length - 2}`;
      hashtagDiv.appendChild(more);
    }
    info.appendChild(hashtagDiv);
  }

  card.appendChild(info);
  card.addEventListener('click', () => openModal(index));

  return card;
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Open modal
function openModal(index, carouselIdx = 0) {
  if (index < 0 || index >= displayedPosts.length) return;

  const modal = document.getElementById('modal');
  const mediaContainer = document.getElementById('modal-media');

  // Stop current videos
  if (currentModalIndex >= 0 && mediaContainer) {
    const currentVideos = mediaContainer.querySelectorAll('video');
    currentVideos.forEach(video => {
      video.pause();
      video.currentTime = 0;
      video.src = '';
    });
  }

  currentModalIndex = index;
  currentCarouselIndex = carouselIdx;
  const post = displayedPosts[index];

  if (!post) return;

  const titleEl = document.getElementById('modal-title');
  const captionEl = document.getElementById('modal-caption');
  const usernameEl = document.getElementById('modal-username');
  const linkEl = document.getElementById('modal-link');
  const hashtagsEl = document.getElementById('modal-hashtags');

  mediaContainer.innerHTML = '';

  // Check if this is a carousel post
  if (post.isCarousel && post.carouselMedia && post.carouselMedia.length > 0) {
    renderCarouselModal(post, mediaContainer, carouselIdx);
  } else if (post.isVideo) {
    renderVideoModal(post, mediaContainer);
  } else {
    renderImageModal(post, mediaContainer);
  }

  titleEl.textContent = post.username ? `@${post.username}` : 'Post';
  captionEl.textContent = post.title || '';
  usernameEl.textContent = `@${post.username || 'unknown'}`;

  linkEl.style.display = post.link ? '' : 'none';
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
}

// Render carousel in modal
function renderCarouselModal(post, container, startIndex = 0) {
  const items = post.carouselMedia;
  currentCarouselIndex = Math.min(startIndex, items.length - 1);

  // Create carousel wrapper
  const carouselWrapper = document.createElement('div');
  carouselWrapper.className = 'carousel-wrapper';

  // Create slides container
  const slidesContainer = document.createElement('div');
  slidesContainer.className = 'carousel-slides';
  slidesContainer.id = 'carousel-slides';

  // Create slides for each item
  items.forEach((item, idx) => {
    const slide = document.createElement('div');
    slide.className = `carousel-slide ${idx === currentCarouselIndex ? 'active' : ''}`;
    slide.dataset.index = idx;

    if (item.isVideo) {
      slide.innerHTML = `
        <div class="loading-video">
          <div class="spinner"></div>
          <p>Loading video...</p>
        </div>
      `;
      // We'll load video content when the slide becomes active
    } else {
      // Show loading placeholder first
      slide.innerHTML = '<div class="loading-video"><div class="spinner"></div></div>';
    }

    slidesContainer.appendChild(slide);
  });

  carouselWrapper.appendChild(slidesContainer);

  // Create navigation arrows
  if (items.length > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.className = 'carousel-nav carousel-prev';
    prevBtn.innerHTML = '‹';
    prevBtn.onclick = () => navigateCarousel(-1, post);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'carousel-nav carousel-next';
    nextBtn.innerHTML = '›';
    nextBtn.onclick = () => navigateCarousel(1, post);

    carouselWrapper.appendChild(prevBtn);
    carouselWrapper.appendChild(nextBtn);

    // Create dots indicator
    const dotsContainer = document.createElement('div');
    dotsContainer.className = 'carousel-dots';
    dotsContainer.id = 'carousel-dots';

    items.forEach((_, idx) => {
      const dot = document.createElement('span');
      dot.className = `carousel-dot ${idx === currentCarouselIndex ? 'active' : ''}`;
      dot.onclick = () => goToCarouselSlide(idx, post);
      dotsContainer.appendChild(dot);
    });

    carouselWrapper.appendChild(dotsContainer);

    // Counter
    const counter = document.createElement('div');
    counter.className = 'carousel-counter';
    counter.id = 'carousel-counter';
    counter.textContent = `${currentCarouselIndex + 1} / ${items.length}`;
    carouselWrapper.appendChild(counter);
  }

  container.appendChild(carouselWrapper);

  // Load the current slide content
  loadCarouselSlide(currentCarouselIndex, post);
}

// Load content for a carousel slide
function loadCarouselSlide(idx, post) {
  const items = post.carouselMedia;
  const item = items[idx];
  const slides = document.querySelectorAll('.carousel-slide');
  const slide = slides[idx];

  if (!slide || !item) return;

  // Check if already loaded
  if (slide.dataset.loaded === 'true') return;

  if (item.isVideo) {
    // Fetch video from Instagram
    chrome.runtime.sendMessage({
      action: 'FETCH_CAROUSEL_VIDEO',
      permalink: post.link,
      postId: post.id,
      carouselIndex: idx
    }, (response) => {
      if (response && response.success && response.videoUrl) {
        const video = createVideoElement(response.videoUrl);
        video.controls = true;
        video.className = 'modal-video';
        video.crossOrigin = 'anonymous';

        video.addEventListener('loadedmetadata', () => {
          const aspectRatio = video.videoWidth / video.videoHeight;
          video.classList.remove('portrait', 'square', 'landscape');
          if (aspectRatio < 0.7) video.classList.add('portrait');
          else if (aspectRatio >= 0.7 && aspectRatio <= 1.3) video.classList.add('square');
          else video.classList.add('landscape');
        });

        slide.innerHTML = '';
        slide.appendChild(video);
        slide.dataset.loaded = 'true';

        // Auto-play if this is the current slide
        if (idx === currentCarouselIndex) {
          video.play().catch(() => { });
        }
      } else {
        // Fallback: show image thumbnail
        if (item.imageUrl) {
          const img = document.createElement('img');
          img.src = item.imageUrl;
          img.className = 'modal-image';
          img.alt = 'Video thumbnail';
          slide.innerHTML = '';
          slide.appendChild(img);

          const playOverlay = document.createElement('div');
          playOverlay.className = 'video-play-overlay';
          playOverlay.innerHTML = '<span>▶</span> Video unavailable';
          slide.appendChild(playOverlay);
        } else {
          slide.innerHTML = '<p class="error-message">Video failed to load</p>';
        }
        slide.dataset.loaded = 'true';
      }
    });
  } else {
    // Load image
    const imageUrl = item.imageUrl;
    if (imageUrl) {
      const img = document.createElement('img');
      img.className = 'modal-image';
      img.alt = 'Instagram post';
      img.onload = () => {
        slide.dataset.loaded = 'true';
      };
      img.onerror = () => {
        slide.innerHTML = '<p class="error-message">Image failed to load</p>';
        slide.dataset.loaded = 'true';
      };
      img.src = imageUrl;
      slide.innerHTML = '';
      slide.appendChild(img);
    } else {
      slide.innerHTML = '<p class="no-media">Image not available</p>';
      slide.dataset.loaded = 'true';
    }
  }
}

// Navigate carousel
function navigateCarousel(direction, post) {
  const items = post.carouselMedia;
  const newIndex = currentCarouselIndex + direction;

  if (newIndex >= 0 && newIndex < items.length) {
    goToCarouselSlide(newIndex, post);
  }
}

// Go to specific carousel slide
function goToCarouselSlide(idx, post) {
  const items = post.carouselMedia;
  if (idx < 0 || idx >= items.length) return;

  // Pause current video if any
  const currentSlide = document.querySelector('.carousel-slide.active');
  if (currentSlide) {
    const video = currentSlide.querySelector('video');
    if (video) {
      video.pause();
    }
  }

  currentCarouselIndex = idx;

  // Update slide visibility
  const slides = document.querySelectorAll('.carousel-slide');
  slides.forEach((slide, i) => {
    slide.classList.toggle('active', i === idx);
  });

  // Update dots
  const dots = document.querySelectorAll('.carousel-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === idx);
  });

  // Update counter
  const counter = document.getElementById('carousel-counter');
  if (counter) {
    counter.textContent = `${idx + 1} / ${items.length}`;
  }

  // Load the new slide content if not already loaded
  loadCarouselSlide(idx, post);

  // Play video if the new slide has one
  const newSlide = slides[idx];
  if (newSlide) {
    const video = newSlide.querySelector('video');
    if (video) {
      video.play().catch(() => { });
    }
  }
}

// Render single video in modal
function renderVideoModal(post, container) {
  container.innerHTML = `
    <div class="loading-video">
      <div class="spinner"></div>
      <p>Loading video...</p>
    </div>
  `;

  if (!post.link) {
    container.innerHTML = '<p class="error-message">Post has no link</p>';
    return;
  }

  chrome.runtime.sendMessage({
    action: 'FETCH_VIDEO_CDN',
    permalink: post.link,
    postId: post.id
  }, (response) => {
    if (chrome.runtime.lastError) {
      container.innerHTML = '<p class="error-message">Failed to load video</p>';
      return;
    }

    if (response && response.success && response.videoUrl) {
      const video = createVideoElement(response.videoUrl);
      video.controls = true;
      video.autoplay = true;
      video.className = 'modal-video';
      container.innerHTML = '';
      container.appendChild(video);

      video.addEventListener('loadedmetadata', () => {
        const aspectRatio = video.videoWidth / video.videoHeight;
        video.classList.remove('portrait', 'square', 'landscape');

        if (aspectRatio < 0.7) {
          video.classList.add('portrait');
        } else if (aspectRatio >= 0.7 && aspectRatio <= 1.3) {
          video.classList.add('square');
        } else {
          video.classList.add('landscape');
        }
      });

      video.addEventListener('loadeddata', () => {
        video.play().catch(() => { });
      });
    } else {
      container.innerHTML = `<p class="error-message">Failed to load video: ${response?.error || 'Unknown error'}</p>`;
    }
  });
}

// Render single image in modal
function renderImageModal(post, container) {
  const imgSrc = post.image || post.thumbnail;

  if (imgSrc && typeof imgSrc === 'string') {
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = post.title || 'Instagram post';
    img.className = 'modal-image';
    img.onerror = () => {
      container.innerHTML = '<p class="error-message">Image failed to load</p>';
    };
    container.appendChild(img);

    // Try to fetch full-resolution image from Instagram
    if (post.link) {
      chrome.runtime.sendMessage({
        action: 'FETCH_FULL_IMAGE',
        permalink: post.link,
        postId: post.id
      }, (response) => {
        if (response && response.success && response.imageUrl) {
          const fullResImg = new Image();
          fullResImg.onload = () => {
            img.src = response.imageUrl;
          };
          fullResImg.src = response.imageUrl;
        }
      });
    }
  } else {
    container.innerHTML = '<p class="no-media">Image not available</p>';
  }
}

// Close modal
function closeModal() {
  const modal = document.getElementById('modal');

  const mediaContainer = modal.querySelector('#modal-media');
  if (mediaContainer) {
    const videos = mediaContainer.querySelectorAll('video');
    videos.forEach(video => {
      video.pause();
      video.currentTime = 0;
      video.src = '';
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
  const startIndex = (currentPage - 1) * postsPerPage;
  const endIndex = Math.min(startIndex + displayedPosts.length, totalPosts);

  document.getElementById('filtered-count').textContent = totalPosts > 0
    ? `Showing ${startIndex + 1}–${endIndex} of ${totalPosts}`
    : 'No posts';

  const totalPages = Math.ceil(totalPosts / postsPerPage);
  document.getElementById('page-info').textContent = totalPages > 0
    ? `Page ${currentPage} of ${totalPages}`
    : '';

  updateHashtagChips();
}

// Setup sync panel
function setupSyncPanel() {
  const overlay = document.getElementById('sync-panel-overlay');
  const closeBtn = document.getElementById('sync-panel-close');
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const clearProgressBtn = document.getElementById('sync-clear-progress');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSyncPanel);
  }
  if (overlay) {
    overlay.addEventListener('click', () => {
      if (!isSyncing) closeSyncPanel();
    });
  }
  if (startBtn) {
    startBtn.addEventListener('click', startSync);
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', stopSync);
  }
  if (clearProgressBtn) {
    clearProgressBtn.addEventListener('click', clearSyncProgress);
  }

  const clearAllDataBtn = document.getElementById('clear-all-data-btn');
  if (clearAllDataBtn) {
    clearAllDataBtn.addEventListener('click', clearAllData);
  }

  // Check for saved progress on load
  checkSyncProgress();
}

function openSyncPanel() {
  const panel = document.getElementById('sync-panel');
  const overlay = document.getElementById('sync-panel-overlay');
  if (panel) panel.classList.add('active');
  if (overlay) overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // If currently syncing, restore the syncing UI state
  if (isSyncing) {
    restoreSyncingState();
  } else {
    checkSyncProgress();
  }
}

function restoreSyncingState() {
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const progressSection = document.getElementById('sync-progress-section');
  const completeSection = document.getElementById('sync-complete-section');
  const headerBtn = document.getElementById('sync-btn');
  const resumeInfo = document.getElementById('sync-resume-info');

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" class="spin">
        <circle cx="12" cy="12" r="10"/>
      </svg>
      Syncing...
    `;
    startBtn.classList.add('syncing');
  }
  if (stopBtn) stopBtn.style.display = 'block';
  if (progressSection) progressSection.style.display = 'block';
  if (completeSection) completeSection.style.display = 'none';
  if (headerBtn) headerBtn.classList.add('syncing');
  if (resumeInfo) resumeInfo.style.display = 'none';
}

function closeSyncPanel() {
  const panel = document.getElementById('sync-panel');
  const overlay = document.getElementById('sync-panel-overlay');
  if (panel) panel.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

function checkSyncProgress() {
  chrome.storage.local.get(['instagram_sync_progress'], (result) => {
    const resumeInfo = document.getElementById('sync-resume-info');
    const resumeDetails = document.getElementById('sync-resume-details');
    const startBtn = document.getElementById('sync-start-btn');

    if (result.instagram_sync_progress) {
      const progress = result.instagram_sync_progress;
      if (resumeInfo) {
        resumeInfo.style.display = 'flex';
        resumeDetails.textContent = `${progress.synced} synced, ${progress.failed} failed`;
      }
      if (startBtn) {
        startBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Resume Sync
        `;
      }
      // Update stats display
      updateSyncPanelProgress(progress.synced, progress.failed);
    } else {
      if (resumeInfo) resumeInfo.style.display = 'none';
      if (startBtn) {
        startBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.3"/>
          </svg>
          Start Sync
        `;
      }
    }
  });
}

function clearSyncProgress() {
  chrome.storage.local.remove(['instagram_sync_progress'], () => {
    checkSyncProgress();
    document.getElementById('sync-synced-count').textContent = '0';
    document.getElementById('sync-failed-count').textContent = '0';
  });
}

function clearAllData() {
  if (!confirm('Are you sure you want to delete ALL synced posts? This cannot be undone.')) {
    return;
  }

  const btn = document.getElementById('clear-all-data-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="spin">
        <circle cx="12" cy="12" r="10"/>
      </svg>
      Clearing...
    `;
  }

  chrome.runtime.sendMessage({ action: 'CLEAR_ALL_POSTS' }, (response) => {
    if (response && response.success) {
      // Also clear sync progress
      chrome.storage.local.remove(['instagram_sync_progress'], () => {
        // Reset UI state
        allPosts = [];
        displayedPosts = [];
        allHashtagsCache = []; // Clear hashtags cache
        totalPosts = 0;
        currentPage = 1;
        currentHashtagFilter = null;

        // Update UI
        document.getElementById('sync-synced-count').textContent = '0';
        document.getElementById('sync-failed-count').textContent = '0';
        checkSyncProgress();
        renderPosts();
        updateStats();
        renderPagination();
        updateHashtagChips();


        // Close panel
        closeSyncPanel();
      });
    }

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
        Clear All Data
      `;
    }

    // Clear sync status
    updateSyncStatus('', '');
  });
}

function startSync() {
  isSyncing = true;
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const progressSection = document.getElementById('sync-progress-section');
  const completeSection = document.getElementById('sync-complete-section');
  const headerBtn = document.getElementById('sync-btn');

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" class="spin">
        <circle cx="12" cy="12" r="10"/>
      </svg>
      Syncing...
    `;
    startBtn.classList.add('syncing');
  }
  if (stopBtn) stopBtn.style.display = 'block';
  if (progressSection) progressSection.style.display = 'block';
  if (completeSection) completeSection.style.display = 'none';
  if (headerBtn) headerBtn.classList.add('syncing');

  document.getElementById('sync-progress-bar').style.width = '5%';

  // Start the sync - opens Instagram in background tab
  chrome.runtime.sendMessage({ action: 'SYNC_WITH_INSTAGRAM_BACKGROUND' });

  // Sync runs in a background tab
  updateSyncStatus('syncing', 'Syncing...');
}

function stopSync() {
  chrome.runtime.sendMessage({ action: 'STOP_SYNC' });
  const stopBtn = document.getElementById('sync-stop-btn');
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping...';
  }
}

function handleSyncStarted() {
  document.getElementById('sync-progress-bar').style.width = '10%';
  updateSyncStatus('syncing', 'Preparing...');
}

function updateSyncPanelProgress(synced, failed, total = 0) {
  document.getElementById('sync-synced-count').textContent = synced || 0;
  document.getElementById('sync-failed-count').textContent = failed || 0;
  const totalElement = document.getElementById('sync-total-count');
  if (totalElement) {
    totalElement.textContent = total || 0;
  }

  const progressBar = document.getElementById('sync-progress-bar');
  const processed = (synced || 0) + (failed || 0);

  // Only update main page sync status if actively syncing
  // (not when just displaying saved progress from a previous session)
  if (isSyncing) {
    if (total > 0) {
      const percent = Math.min(99, Math.round((processed / total) * 100));
      updateSyncStatus('syncing', `Syncing... ${percent}%`);
    } else if (processed > 0) {
      updateSyncStatus('syncing', 'Syncing...');
    }
  }

  if (progressBar) {
    if (total > 0) {
      // Real progress based on total
      const percent = Math.min(99, Math.round((processed / total) * 100));
      progressBar.style.width = `${percent}%`;
    } else if (processed > 0) {
      // Fallback: use a log scale for progress since we don't know total
      const progress = Math.min(90, 10 + Math.log10(processed + 1) * 30);
      progressBar.style.width = `${progress}%`;
    }
  }
}

function handleSyncComplete(syncedCount, failedCount) {
  isSyncing = false;
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const completeSection = document.getElementById('sync-complete-section');
  const headerBtn = document.getElementById('sync-btn');
  const progressBar = document.getElementById('sync-progress-bar');

  if (progressBar) progressBar.style.width = '100%';

  updateSyncPanelProgress(syncedCount, failedCount);

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.3"/>
      </svg>
      Sync Again
    `;
    startBtn.classList.remove('syncing');
  }
  if (stopBtn) {
    stopBtn.style.display = 'none';
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop Sync';
  }
  if (completeSection) completeSection.style.display = 'block';
  if (headerBtn) headerBtn.classList.remove('syncing');

  // Hide resume info since we completed
  const resumeInfo = document.getElementById('sync-resume-info');
  if (resumeInfo) resumeInfo.style.display = 'none';

  // Clear sync status
  updateSyncStatus('', '');

}

function handleSyncStopped(syncedCount, failedCount) {
  isSyncing = false;
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const headerBtn = document.getElementById('sync-btn');

  updateSyncPanelProgress(syncedCount, failedCount);

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Resume Sync
    `;
    startBtn.classList.remove('syncing');
  }
  if (stopBtn) {
    stopBtn.style.display = 'none';
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop Sync';
  }
  if (headerBtn) headerBtn.classList.remove('syncing');


  // Show resume info
  checkSyncProgress();

  // Clear sync status
  updateSyncStatus('', '');
}

function handleSyncError(error) {
  isSyncing = false;
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const headerBtn = document.getElementById('sync-btn');

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.3"/>
      </svg>
      Retry Sync
    `;
    startBtn.classList.remove('syncing');
  }
  if (stopBtn) stopBtn.style.display = 'none';
  if (headerBtn) headerBtn.classList.remove('syncing');

  // Show error in sync status
  updateSyncStatus('error', `Error: ${error}`);

  // Clear error after 5 seconds
  setTimeout(() => {
    updateSyncStatus('', '');
  }, 5000);
}


// Update sync status - both in panel and in main content area
function updateSyncStatus(status, message) {
  // Update status in main content (visible when panel is closed)
  const statusEl = document.getElementById('sync-status');
  if (statusEl) {
    statusEl.className = `sync-status ${status}`;
    statusEl.textContent = message;
    statusEl.style.display = message ? 'block' : 'none';
  }

  // Update status inside sync panel (visible when panel is open)
  const progressText = document.getElementById('sync-progress-text');
  if (progressText) {
    progressText.textContent = message;
    progressText.style.display = message ? 'flex' : 'none';
  }
}

// Show error
function showError(message) {
  const container = document.getElementById('posts-container');
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📭</div>
      <p>${message}</p>
      <button class="sync-btn-inline" id="error-sync-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="18" height="18">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Sync Now
      </button>
    </div>
  `;
  // Attach event listener after DOM insertion
  const syncBtn = document.getElementById('error-sync-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', openSyncPanel);
  }
}
