// App state
/** @type {NostalgiaPost[]} */
let allPosts = [];
/** @type {NostalgiaPost[]} */
let displayedPosts = [];
let currentPage = 1;
let postsPerPage = 20; // Will be adjusted for complete rows
let currentSort = 'newest-saved';
let currentTypeFilter = 'all';
let currentHashtagFilter = null;
let currentSearchQuery = '';
let currentModalIndex = -1;
let currentCarouselIndex = 0; // Track which item in a carousel is being viewed
let currentRandomSeed = null;
let currentModalVideoUrl = null;
// Bumped every time the modal opens/closes. Async media callbacks capture the
// value at request time and bail if it no longer matches, so a video that
// resolves after the user has navigated away never gets appended or played
// (this is what caused audio to keep playing in the background after close).
let modalGeneration = 0;
// Timer that advances image posts during autoplay (videos advance on 'ended').
let autoplayImageTimer = null;
const AUTOPLAY_IMAGE_DURATION_MS = 3000;
// Hidden <video> that pre-buffers the next clip's bytes while the current one
// plays, so advancing is instant. Only one is kept alive at a time.
let preloadBufferVideo = null;
let preloadBufferedUrl = null;
const MODAL_MEDIA_CACHE_MAX_ENTRIES = 24;
/** @type {Map<string, ModalCachedMedia>} */
let modalMediaCache = new Map();
let latestLoadRequestId = 0;
let totalPosts = 0;
let isSyncing = false;
let isRebuilding = false;
let lastKnownSyncTotal = 0;
// Once a sync completes the TOTAL tile shows the real synced count; this flag
// stops any late/stray SYNC_PROGRESS message from reverting it to the estimate.
let syncTotalFinalized = false;
let currentTheme = 'dark';
let currentLanguage = 'en';
let currentAutoplayEnabled = true;
let currentLoopEnabled = false;
/** @type {LocalizedSyncStatusState} */
let currentSyncStatusState = { status: '', key: null, params: null };

const THEME_STORAGE_KEY = 'nostalgia_theme';
const LANGUAGE_STORAGE_KEY = 'nostalgia_language';
const AUTOPLAY_STORAGE_KEY = 'nostalgia_autoplay';
const LOOP_STORAGE_KEY = 'nostalgia_loop';
const AUTOSYNC_STORAGE_KEY = 'nostalgia_autosync';
let currentAutoSyncEnabled = false;

function getI18nApi() {
  /** @type {NostalgiaI18nApi} */
  return window.NostalgiaI18n || {
    detectLanguage: () => 'en',
    getLanguages: () => ({ en: { label: 'English', lang: 'en', dir: 'ltr' } }),
    getLanguage: () => 'en',
    setLanguage: () => 'en',
    applyTranslations: () => { },
    t: (key, params = {}) => Object.keys(params).length > 0 ? `${key} ${JSON.stringify(params)}` : key
  };
}

function t(key, params = {}) {
  return getI18nApi().t(key, params);
}

function buildButtonMarkup(label, iconMarkup = '') {
  return `${iconMarkup}<span>${label}</span>`;
}

function getSyncIconMarkup(spinning = false) {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"${spinning ? ' class="spin"' : ''}>
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.3"/>
    </svg>
  `;
}

function getPlayIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  `;
}

function getSpinnerIconMarkup(size = 18) {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="${size}" height="${size}" class="spin">
      <circle cx="12" cy="12" r="10"/>
    </svg>
  `;
}

function getTrashIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>
  `;
}

function getExportIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  `;
}

function getImportIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  `;
}

function applyTheme(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = currentTheme;
  localStorage.setItem(THEME_STORAGE_KEY, currentTheme);

  const themeSelect = document.getElementById('theme-select');
  if (themeSelect && themeSelect.value !== currentTheme) {
    themeSelect.value = currentTheme;
  }
}

function isModalAutoplayCapable(post) {
  if (!post) return false;
  if (post.isVideo) return true;
  return !!(post.isCarousel && post.carouselMedia && post.carouselMedia.some((item) => item?.isVideo));
}

function getAutoplayButtonLabel() {
  return currentAutoplayEnabled ? t('autoplayOn') : t('autoplayOff');
}

function updateModalAutoplayButton(post = getCurrentModalPost()) {
  const autoplayBtn = document.getElementById('modal-autoplay-btn');
  if (!autoplayBtn) return;

  const shouldShow = isModalAutoplayCapable(post);
  autoplayBtn.style.display = shouldShow ? '' : 'none';
  autoplayBtn.textContent = getAutoplayButtonLabel();
  autoplayBtn.setAttribute('aria-pressed', currentAutoplayEnabled ? 'true' : 'false');
}

function applyAutoplayPreference(enabled) {
  currentAutoplayEnabled = enabled !== false;
  localStorage.setItem(AUTOPLAY_STORAGE_KEY, currentAutoplayEnabled ? 'true' : 'false');
  updateModalAutoplayButton();
}

function toggleModalAutoplay() {
  applyAutoplayPreference(!currentAutoplayEnabled);

  if (!currentAutoplayEnabled) {
    clearAutoplayImageTimer();
    return;
  }

  const activeVideo = document.querySelector('#modal-media video');
  if (activeVideo) {
    activeVideo.play().catch(() => { });
  } else {
    // No video on screen means we're on an image -> (re)start the hold timer so
    // autoplay resumes advancing.
    const post = getCurrentModalPost();
    if (post && post.isCarousel) {
      scheduleAutoplayCarouselImageAdvance(post, currentCarouselIndex);
    } else {
      scheduleAutoplayImageAdvance();
    }
  }

  preloadUpcomingModalMedia();
}

function hasNextModalPost() {
  if (currentModalIndex < 0) return false;
  if (currentModalIndex + 1 < displayedPosts.length) return true;
  const totalPages = Math.max(1, Math.ceil(totalPosts / postsPerPage));
  return currentPage < totalPages;
}

function updateModalSkipButton() {
  const skipBtn = document.getElementById('modal-skip-btn');
  if (!skipBtn) return;
  skipBtn.disabled = !hasNextModalPost();
}

// Manual "skip" -> jump straight to the next post (rolling to the next page if
// needed), cancelling any pending image-autoplay hold.
function skipToNextModalPost() {
  clearAutoplayImageTimer();
  advanceModalToNext();
}

// Flip a post's `unavailable` state in memory, in the DB, and on its grid tile.
function setPostUnavailableState(post, unavailable) {
  if (!post || !!post.unavailable === unavailable) return;

  if (unavailable) post.unavailable = true; else delete post.unavailable;

  chrome.runtime.sendMessage({
    action: 'SET_POST_UNAVAILABLE',
    postId: post.id,
    unavailable
  });

  const card = document.querySelector(`.post-card[data-post-id="${post.id}"]`);
  if (card) {
    card.classList.toggle('unavailable', unavailable);
    const media = card.querySelector('.post-media');
    const existing = card.querySelector('.post-unavailable-badge');
    if (unavailable && media && !existing) {
      const badge = document.createElement('div');
      badge.className = 'post-unavailable-badge';
      badge.textContent = t('unavailableBadge');
      media.appendChild(badge);
    } else if (!unavailable && existing) {
      existing.remove();
    }
  }
}

// Shown in the modal media area when Instagram has deleted the post. Offers a
// one-click removal from the local library (the only destructive path -- no
// auto-delete).
function renderUnavailableState(container, post, options = {}) {
  const { message = t('postUnavailable'), unavailable = true } = options;
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'modal-unavailable';

  const icon = document.createElement('div');
  icon.className = 'modal-unavailable-icon';
  icon.textContent = unavailable ? '🚫' : '⚠️';
  wrap.appendChild(icon);

  const msg = document.createElement('p');
  msg.className = 'modal-unavailable-text';
  msg.textContent = message;
  wrap.appendChild(msg);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'modal-unavailable-remove';
  removeBtn.textContent = t('removeFromLibrary');
  removeBtn.addEventListener('click', () => removePostFromLibrary(post, removeBtn));
  wrap.appendChild(removeBtn);

  container.appendChild(wrap);
}

function removePostFromLibrary(post, btn) {
  if (!post || !post.id) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('removing');
  }

  chrome.runtime.sendMessage({ action: 'DELETE_SINGLE_POST', postId: post.id }, (response) => {
    if (response && response.success) {
      allPosts = allPosts.filter((p) => p.id !== post.id);
      totalPosts = Math.max(0, totalPosts - 1);
      closeModal();
      loadPosts();
      updateStats();
    } else if (btn) {
      btn.disabled = false;
      btn.textContent = t('removeFromLibrary');
      alert(response?.error || t('removeFailed'));
    }
  });
}

function getLoopButtonLabel() {
  return currentLoopEnabled ? t('loopOn') : t('loopOff');
}

function updateModalLoopButton(post = getCurrentModalPost()) {
  const loopBtn = document.getElementById('modal-loop-btn');
  if (!loopBtn) return;

  const shouldShow = isModalAutoplayCapable(post);
  loopBtn.style.display = shouldShow ? '' : 'none';
  loopBtn.textContent = getLoopButtonLabel();
  loopBtn.setAttribute('aria-pressed', currentLoopEnabled ? 'true' : 'false');
}

function applyLoopPreference(enabled) {
  currentLoopEnabled = enabled === true;
  localStorage.setItem(LOOP_STORAGE_KEY, currentLoopEnabled ? 'true' : 'false');
  updateModalLoopButton();

  document.querySelectorAll('#modal-media video').forEach((video) => {
    video.loop = currentLoopEnabled;
  });
}

function toggleModalLoop() {
  applyLoopPreference(!currentLoopEnabled);
}

function getResumeDetailsText(progress) {
  const params = {
    synced: progress.synced || 0,
    failed: progress.failed || 0,
    total: progress.total || 0
  };

  return (typeof progress.total === 'number' && progress.total > 0)
    ? t('resumeDetailsWithTotal', params)
    : t('resumeDetailsWithoutTotal', params);
}

function updateLocalizedSyncStatus(status, key, params = {}) {
  currentSyncStatusState = { status, key, params };
  const percent = typeof params.percent === 'number' ? params.percent : null;
  updateSyncStatus(status, key ? t(key, params) : '', percent);
}

function populateLanguageSelect() {
  const languageSelect = document.getElementById('language-select');
  if (!languageSelect) return;

  const languages = getI18nApi().getLanguages();
  languageSelect.innerHTML = '';

  Object.entries(languages).forEach(([value, metadata]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = metadata.label;
    languageSelect.appendChild(option);
  });

  languageSelect.value = currentLanguage;
}

function rerenderLocalizedUi() {
  getI18nApi().applyTranslations(document);
  document.title = t('documentTitle');

  const searchInput = document.getElementById('search-input');
  const searchInputMobile = document.getElementById('search-input-mobile');
  if (searchInput) searchInput.placeholder = t('searchPlaceholder');
  if (searchInputMobile) searchInputMobile.placeholder = t('searchPlaceholder');

  updateHashtagChips();
  renderPosts();
  updateStats();
  renderPagination();
  checkSyncProgress();

  if (isSyncing) {
    restoreSyncingState();
  }

  if (currentSyncStatusState.key) {
    updateLocalizedSyncStatus(currentSyncStatusState.status, currentSyncStatusState.key, currentSyncStatusState.params || {});
  }

  if (currentModalIndex >= 0) {
    const activeModalIndex = currentModalIndex;
    const activeCarouselIndex = currentCarouselIndex;
    openModal(activeModalIndex, activeCarouselIndex);
  }
}

function applyLanguage(language) {
  currentLanguage = getI18nApi().setLanguage(language);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);

  const languageSelect = document.getElementById('language-select');
  if (languageSelect && languageSelect.value !== currentLanguage) {
    languageSelect.value = currentLanguage;
  }

  rerenderLocalizedUi();
}

function initializePreferences() {
  currentLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || getI18nApi().detectLanguage();
  currentTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
  currentAutoplayEnabled = localStorage.getItem(AUTOPLAY_STORAGE_KEY) !== 'false';
  currentLoopEnabled = localStorage.getItem(LOOP_STORAGE_KEY) === 'true';
  currentAutoSyncEnabled = localStorage.getItem(AUTOSYNC_STORAGE_KEY) === 'true';

  populateLanguageSelect();
  applyTheme(currentTheme);
  applyLanguage(currentLanguage);
  applyAutoplayPreference(currentAutoplayEnabled);
  applyLoopPreference(currentLoopEnabled);

  const languageSelect = document.getElementById('language-select');
  const themeSelect = document.getElementById('theme-select');
  const autoSyncToggle = document.getElementById('auto-sync-toggle');

  if (languageSelect) {
    languageSelect.value = currentLanguage;
    languageSelect.addEventListener('change', (event) => applyLanguage(event.target.value));
  }

  if (themeSelect) {
    themeSelect.value = currentTheme;
    themeSelect.addEventListener('change', (event) => applyTheme(event.target.value));
  }

  if (autoSyncToggle) {
    autoSyncToggle.checked = currentAutoSyncEnabled;
    autoSyncToggle.addEventListener('change', (event) => {
      currentAutoSyncEnabled = event.target.checked;
      localStorage.setItem(AUTOSYNC_STORAGE_KEY, currentAutoSyncEnabled ? 'true' : 'false');
    });
  }
}

// When enabled in Settings, kick off a sync shortly after the viewer opens so
// newly saved posts show up without the user pressing Sync. Skipped if a sync is
// already running.
function maybeAutoStartSync() {
  if (!currentAutoSyncEnabled || isSyncing) return;
  setTimeout(() => {
    if (!currentAutoSyncEnabled || isSyncing) return;
    startSync();
  }, 1500);
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const overlay = document.getElementById('settings-modal-overlay');
  const languageSelect = document.getElementById('language-select');
  const themeSelect = document.getElementById('theme-select');

  if (languageSelect) {
    languageSelect.value = currentLanguage;
  }

  if (themeSelect) {
    themeSelect.value = currentTheme;
  }

  if (modal) modal.classList.add('active');
  if (overlay) overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const overlay = document.getElementById('settings-modal-overlay');

  if (modal) modal.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

function setupSettingsModal() {
  const settingsBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('settings-modal-close');
  const overlay = document.getElementById('settings-modal-overlay');

  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettingsModal);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSettingsModal);
  }

  if (overlay) {
    overlay.addEventListener('click', closeSettingsModal);
  }

  const clearAllDataBtn = document.getElementById('clear-all-data-btn');
  if (clearAllDataBtn) {
    clearAllDataBtn.addEventListener('click', clearAllData);
  }

  const exportDataBtn = document.getElementById('export-data-btn');
  if (exportDataBtn) {
    exportDataBtn.addEventListener('click', exportData);
  }

  const importDataBtn = document.getElementById('import-data-btn');
  const importDataInput = document.getElementById('import-data-input');
  if (importDataBtn && importDataInput) {
    importDataBtn.addEventListener('click', () => importDataInput.click());
    importDataInput.addEventListener('change', (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) importData(file);
    });
  }
}

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

// Debounced hashtag fetch to avoid repeated expensive requests during sync
const scheduleFetchAllHashtags = debounce(() => {
  try {
    fetchAllHashtags();
  } catch (e) {
    console.error('Error scheduling hashtag fetch:', e);
  }
}, 1000);

// Helper functions for creating media elements
function createVideoElement(src) {
  const video = document.createElement('video');
  video.src = src;
  video.preload = 'auto';

  // Restore the last volume level, but always start with sound on. Opening the
  // modal is a user gesture, so unmuted autoplay is permitted; attemptPlay()
  // falls back to muted only if the browser still blocks it (e.g. auto-advance
  // outside a gesture). This is what makes reels play at full volume by default.
  const savedVolume = localStorage.getItem('video_volume');
  video.volume = savedVolume !== null ? parseFloat(savedVolume) : 1.0;
  video.muted = false;

  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';

  // Save volume preference
  const saveVolumeState = () => {
    localStorage.setItem('video_volume', video.volume);
    localStorage.setItem('video_muted', video.muted);
  };

  video.addEventListener('volumechange', saveVolumeState);

  video.loop = currentLoopEnabled;

  video.onerror = () => {
    console.error('Video playback error:', src);
    video.parentElement.innerHTML = `<div class="media-error">${t('failedToLoadVideo')}</div>`;
  };
  return video;
}

// Play preferring sound; if the browser blocks unmuted autoplay (no active
// gesture), retry muted so the video still plays rather than freezing.
function attemptPlay(video) {
  if (!video) return;
  video.play().catch(() => {
    video.muted = true;
    video.play().catch(() => { });
  });
}

function createImageElement(src) {
  const img = document.createElement('img');
  const placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="280" height="280"%3E%3Crect fill="%231a1a1a" width="280" height="280"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23666" font-family="system-ui"%3ENo image%3C/text%3E%3C/svg%3E';

  if (!src) {
    img.src = placeholder;
  } else if (typeof src === 'string' && src.startsWith('data:')) {
    img.src = src;
    img.alt = t('postFallbackTitle');
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
  initializePreferences();
  initializeEventListeners();
  updateRandomControlsVisibility();
  loadPosts(false, true); // Load posts and fetch hashtags after posts load successfully
  setupMessageListener();
  setupMobileFilters();
  setupSyncPanel();
  setupSettingsModal();
  maybeAutoStartSync();

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
  const randomRefreshBtn = document.getElementById('random-refresh-btn');
  if (sortSelect) sortSelect.addEventListener('change', handleSortChange);
  if (typeFilter) typeFilter.addEventListener('change', handleTypeFilterChange);
  if (randomRefreshBtn) randomRefreshBtn.addEventListener('click', handleRandomReshuffle);

  // Mobile search
  const searchInputMobile = document.getElementById('search-input-mobile');
  if (searchInputMobile) {
    searchInputMobile.addEventListener('input', debounce(handleSearchMobile, 300));
  }

  // Mobile filters
  const sortSelectMobile = document.getElementById('sort-select-mobile');
  const typeFilterMobile = document.getElementById('type-filter-mobile');
  const randomRefreshBtnMobile = document.getElementById('random-refresh-btn-mobile');
  if (sortSelectMobile) sortSelectMobile.addEventListener('change', handleSortChangeMobile);
  if (typeFilterMobile) typeFilterMobile.addEventListener('change', handleTypeFilterChangeMobile);
  if (randomRefreshBtnMobile) randomRefreshBtnMobile.addEventListener('click', handleRandomReshuffle);

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
  const downloadBtn = document.getElementById('modal-download-btn');
  const collectionBtn = document.getElementById('modal-collection-btn');
  const autoplayBtn = document.getElementById('modal-autoplay-btn');
  const loopBtn = document.getElementById('modal-loop-btn');
  const bumpBtn = document.getElementById('modal-bump-btn');
  const skipBtn = document.getElementById('modal-skip-btn');
  if (downloadBtn) downloadBtn.addEventListener('click', downloadCurrentMedia);
  if (collectionBtn) collectionBtn.addEventListener('click', addCurrentPostToCollection);
  if (autoplayBtn) autoplayBtn.addEventListener('click', toggleModalAutoplay);
  if (loopBtn) loopBtn.addEventListener('click', toggleModalLoop);
  if (bumpBtn) bumpBtn.addEventListener('click', bumpCurrentPostToTop);
  if (skipBtn) skipBtn.addEventListener('click', skipToNextModalPost);

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal && settingsModal.classList.contains('active')) {
        closeSettingsModal();
        return;
      }
    }

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
function loadPosts(append = false, fetchHashtagsAfter = false, onComplete = null) {
  const requestId = ++latestLoadRequestId;
  showLoadingState();

  chrome.runtime.sendMessage({
    action: 'GET_INSTAGRAM_POSTS',
    page: currentPage,
    limit: postsPerPage,
    sortBy: currentSort,
    filterType: currentTypeFilter,
    searchQuery: currentSearchQuery,
    hashtagFilter: currentHashtagFilter,
    randomSeed: currentSort === 'random' ? currentRandomSeed : null
  }, (response) => {
    if (requestId !== latestLoadRequestId) {
      return;
    }

    hideLoadingState();

    if (chrome.runtime.lastError) {
      console.error('Error loading posts:', chrome.runtime.lastError);
      showError(t('loadPostsFailed'));
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

      // Fetch hashtags after posts are loaded (service worker is ready)
      if (fetchHashtagsAfter) {
        scheduleFetchAllHashtags();
      } else if (allHashtagsCache.length === 0) {
        // If hashtags cache is empty, try to fetch from database
        scheduleFetchAllHashtags();
      }
    } else {
      showError(t('noPostsFoundSync'));
      allPosts = [];
      totalPosts = 0;
      renderPosts();

      // Still try to fetch hashtags even if no posts on this page
      if (fetchHashtagsAfter) {
        fetchAllHashtags();
      }
    }

    if (typeof onComplete === 'function') {
      onComplete();
    }
  });
}

// Show loading state
function showLoadingState() {
  const container = document.getElementById('posts-container');
  if (!container) return;

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

function updateRandomControlsVisibility() {
  const isRandomSort = currentSort === 'random';
  [
    document.getElementById('random-refresh-btn'),
    document.getElementById('random-refresh-btn-mobile')
  ].filter(Boolean).forEach((button) => {
    button.classList.toggle('visible', isRandomSort);
  });
}

function handleRandomReshuffle() {
  if (currentSort !== 'random') return;

  currentRandomSeed = Date.now();
  currentPage = 1;
  loadPosts();
}

// Message listener for live updates
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'UPDATE_ITEMS') {
      // While a sync/rebuild is running, posts are being inserted/reordered
      // continuously. Reloading the grid on every update makes items jump
      // between pages, so we keep the view stable and show a banner instead.
      if (isSyncing || isRebuilding) {
        setSyncGridBanner(true);
      } else {
        loadPosts();
        scheduleFetchAllHashtags(); // Refresh hashtags when posts are updated (debounced)
      }
    } else if (request.action === 'SYNC_STARTED') {
      handleSyncStarted();
    } else if (request.action === 'SYNC_PROGRESS') {
      updateSyncPanelProgress(request.synced, request.failed, request.total);
    } else if (request.action === 'SYNC_COMPLETE') {
      handleSyncComplete(request.syncedCount, request.failedCount);
      setSyncGridBanner(false);
      currentPage = 1;
      loadPosts();
      scheduleFetchAllHashtags(); // Refresh hashtags after sync (debounced)
    } else if (request.action === 'SYNC_LOGIN_REQUIRED') {
      handleSyncLoginRequired(request.error || 'Instagram login required.');
    } else if (request.action === 'IMPORT_FAILED') {
      handleSyncError(request.error || 'Sync failed. Please try again.');
    } else if (request.action === 'SYNC_STOPPED') {
      setSyncGridBanner(false);
      handleSyncStopped(request.syncedCount, request.failedCount);
    } else if (request.action === 'REBUILD_STARTED') {
      handleRebuildStarted();
    } else if (request.action === 'REBUILD_COMPLETE') {
      handleRebuildComplete();
    } else if (request.action === 'REBUILD_STOPPED') {
      handleRebuildComplete();
    }
    return true;
  });
}

// Keep the grid stable while a sync/rebuild is mutating order in the background.
function setSyncGridBanner(visible) {
  const banner = document.getElementById('sync-grid-banner');
  if (!banner) return;

  if (visible) {
    if (banner.dataset.active === 'true') return;
    banner.dataset.active = 'true';
    banner.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = isRebuilding ? t('rebuildBannerRunning') : t('syncBannerUpdating');
    banner.appendChild(label);

    const refresh = document.createElement('button');
    refresh.className = 'sync-banner-refresh';
    refresh.textContent = t('showNewPosts');
    refresh.addEventListener('click', () => {
      currentPage = 1;
      loadPosts();
    });
    banner.appendChild(refresh);

    banner.style.display = 'flex';
  } else {
    banner.dataset.active = 'false';
    banner.style.display = 'none';
    banner.innerHTML = '';
  }
}

// The saved-order rebuild is triggered automatically by the background sync
// when it detects drift (see contentScript.js) -- there's no manual entry
// point, but we still surface progress via the same grid banner/status line
// sync uses.
function handleRebuildStarted() {
  isRebuilding = true;
  setSyncGridBanner(true);
  updateLocalizedSyncStatus('syncing', 'rebuilding');
}

function handleRebuildComplete() {
  isRebuilding = false;
  setSyncGridBanner(false);
  updateSyncStatus('', '');
  currentPage = 1;
  loadPosts();
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
  if (currentSort === 'random') {
    currentRandomSeed = Date.now();
  } else {
    currentRandomSeed = null;
  }
  updateRandomControlsVisibility();
  // Sync with mobile
  const mobileSelect = document.getElementById('sort-select-mobile');
  if (mobileSelect) mobileSelect.value = e.target.value;
  currentPage = 1;
  loadPosts();
}

function handleSortChangeMobile(e) {
  currentSort = e.target.value;
  if (currentSort === 'random') {
    currentRandomSeed = Date.now();
  } else {
    currentRandomSeed = null;
  }
  updateRandomControlsVisibility();
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
let isFetchingHashtags = false;
// Keep last rendered hashtag snapshot to avoid unnecessary DOM updates
let lastRenderedHashtags = '';

// Fetch all hashtags from database
function fetchAllHashtags(retryCount = 0) {
  isFetchingHashtags = true;
  updateHashtagChips();

  chrome.runtime.sendMessage({ action: 'GET_ALL_HASHTAGS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error fetching hashtags:', chrome.runtime.lastError);
      if (retryCount < 2) {
        setTimeout(() => fetchAllHashtags(retryCount + 1), 400 * (retryCount + 1));
        return;
      }

      isFetchingHashtags = false;
      updateHashtagChips();
      return;
    }

    if (response && response.success && Array.isArray(response.hashtags)) {
      isFetchingHashtags = false;
      allHashtagsCache = response.hashtags;
      updateHashtagChips();
    } else if (response && Array.isArray(response.hashtags)) {
      isFetchingHashtags = false;
      allHashtagsCache = response.hashtags;
      updateHashtagChips();
    } else {
      if (retryCount < 2) {
        setTimeout(() => fetchAllHashtags(retryCount + 1), 400 * (retryCount + 1));
        return;
      }

      isFetchingHashtags = false;
      updateHashtagChips();
    }
  });
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

  // If we're currently syncing and there are no hashtags available yet,
  // avoid clearing the UI (this prevents flashing while the DB is being
  // updated). We'll refresh once a non-empty set arrives or syncing ends.
  if (isSyncing && (!hashtagsWithCounts || hashtagsWithCounts.length === 0)) {
    return;
  }

  // Serialize current hashtags for quick diffing to avoid re-rendering
  const serialized = `${isFetchingHashtags ? 'loading' : 'ready'}:${(hashtagsWithCounts || []).slice(0, 25).map(h => `${h.tag}:${h.count}`).join(',')}`;
  if (serialized === lastRenderedHashtags) return; // No change, skip DOM updates
  lastRenderedHashtags = serialized;

  containers.forEach(container => {
    container.innerHTML = '';

    if (isFetchingHashtags && hashtagsWithCounts.length === 0) {
      container.innerHTML = `<span class="no-hashtags">${t('loadingHashtags')}</span>`;
      return;
    }

    if (hashtagsWithCounts.length === 0) {
      container.innerHTML = `<span class="no-hashtags">${t('noHashtagsFound')}</span>`;
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
  nextBtn.textContent = t('nextPage');
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      loadPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  container.appendChild(nextBtn);

  // Jump-to-page: type a page number and press Enter (or click Go).
  const jump = document.createElement('div');
  jump.className = 'pagination-jump';

  const jumpLabel = document.createElement('span');
  jumpLabel.className = 'pagination-jump-label';
  jumpLabel.textContent = t('goToPage');
  jump.appendChild(jumpLabel);

  const jumpInput = document.createElement('input');
  jumpInput.type = 'number';
  jumpInput.className = 'pagination-jump-input';
  jumpInput.min = '1';
  jumpInput.max = String(totalPages);
  jumpInput.value = String(currentPage);
  jumpInput.setAttribute('aria-label', t('goToPage'));
  jump.appendChild(jumpInput);

  const jumpTotal = document.createElement('span');
  jumpTotal.className = 'pagination-jump-total';
  jumpTotal.textContent = t('ofPages', { total: totalPages });
  jump.appendChild(jumpTotal);

  const goToTypedPage = () => {
    const target = parseInt(jumpInput.value, 10);
    if (!Number.isFinite(target) || target < 1 || target > totalPages) {
      jumpInput.value = String(currentPage);
      return;
    }
    if (target === currentPage) return;
    currentPage = target;
    loadPosts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  jumpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      goToTypedPage();
    }
  });

  const goBtn = document.createElement('button');
  goBtn.className = 'pagination-jump-go';
  goBtn.textContent = t('go');
  goBtn.addEventListener('click', goToTypedPage);
  jump.appendChild(goBtn);

  container.appendChild(jump);
}

// Render posts
function renderPosts() {
  const container = document.getElementById('posts-container');

  if (displayedPosts.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';

    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = '📸';

    const title = document.createElement('p');
    title.textContent = currentSearchQuery
      ? t('noPostsFoundMatching', { query: currentSearchQuery })
      : t('noPostsFound');

    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = t('emptyHintAdjustFilters');

    emptyState.appendChild(icon);
    emptyState.appendChild(title);
    emptyState.appendChild(hint);

    container.innerHTML = '';
    container.appendChild(emptyState);
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
  if (post.unavailable) card.classList.add('unavailable');

  const mediaContainer = document.createElement('div');
  mediaContainer.className = 'post-media';

  if (post.unavailable) {
    const badge = document.createElement('div');
    badge.className = 'post-unavailable-badge';
    badge.textContent = t('unavailableBadge');
    mediaContainer.appendChild(badge);
  }

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

function getCurrentModalPost() {
  if (currentModalIndex < 0 || currentModalIndex >= displayedPosts.length) return null;
  return displayedPosts[currentModalIndex] || null;
}

function getModalCacheKey(post, carouselIndex = null) {
  return carouselIndex === null ? `${post.id}:primary` : `${post.id}:carousel:${carouselIndex}`;
}

function cacheModalMedia(cacheKey, media) {
  if (!cacheKey || !media || !media.url) return;

  if (modalMediaCache.has(cacheKey)) {
    modalMediaCache.delete(cacheKey);
  }

  modalMediaCache.set(cacheKey, media);

  if (modalMediaCache.size > MODAL_MEDIA_CACHE_MAX_ENTRIES) {
    const oldestKey = modalMediaCache.keys().next().value;
    if (oldestKey) {
      modalMediaCache.delete(oldestKey);
    }
  }
}

function setModalVideoLayoutClass(target, aspectRatio = null) {
  if (!target) return;

  target.classList.remove('portrait', 'square', 'landscape');

  if (typeof aspectRatio !== 'number' || !Number.isFinite(aspectRatio)) {
    target.classList.add('portrait');
    return;
  }

  if (aspectRatio < 0.7) {
    target.classList.add('portrait');
  } else if (aspectRatio <= 1.3) {
    target.classList.add('square');
  } else {
    target.classList.add('landscape');
  }
}

function createModalVideoShell(posterUrl = '') {
  const shell = document.createElement('div');
  shell.className = 'modal-video-shell portrait';

  const loading = document.createElement('div');
  loading.className = 'loading-video';
  if (posterUrl) {
    loading.style.backgroundImage = `url('${posterUrl}')`;
  }
  loading.innerHTML = `
    <div class="spinner"></div>
    <p>Loading video...</p>
  `;

  shell.appendChild(loading);
  return shell;
}

function updateModalActionState(buttonId, label, disabled = false) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  button.textContent = label;
  button.disabled = disabled;
}

/**
 * @param {NostalgiaPost | null} post
 * @returns {{ isVideo: boolean, url: string | null, extension: string } | null}
 */
function getPrimaryMediaForPost(post) {
  if (!post) return null;

  if (post.isCarousel && post.carouselMedia && post.carouselMedia.length > 0) {
    const item = post.carouselMedia[currentCarouselIndex] || post.carouselMedia[0];
    const cacheKey = getModalCacheKey(post, currentCarouselIndex);
    const cachedMedia = modalMediaCache.get(cacheKey);

    return {
      isVideo: !!item?.isVideo,
      url: item?.isVideo ? (cachedMedia?.url || null) : (item?.imageUrl || null),
      extension: item?.isVideo ? 'mp4' : 'jpg'
    };
  }

  if (post.isVideo) {
    return {
      isVideo: true,
      url: currentModalVideoUrl,
      extension: 'mp4'
    };
  }

  // Prefer the full-resolution image fetched on modal open (cached, never stored
  // to IndexedDB) so downloads aren't limited to the compressed thumbnail.
  const cachedMedia = modalMediaCache.get(getModalCacheKey(post));
  return {
    isVideo: false,
    url: cachedMedia?.url || post.image || post.thumbnail || null,
    extension: 'jpg'
  };
}

function buildDownloadFilename(post, media) {
  const username = (post.username || 'instagram').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const baseId = (post.id || 'media').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `nostalgia/${username}-${baseId}.${media.extension || 'bin'}`;
}

function downloadCurrentMedia() {
  const post = getCurrentModalPost();
  if (!post) return;

  const media = getPrimaryMediaForPost(post);
  if (!media?.url) {
    updateModalActionState('modal-download-btn', t('mediaNotReady'), true);
    setTimeout(() => updateModalActionState('modal-download-btn', t('downloadMedia')), 1800);
    return;
  }

  updateModalActionState('modal-download-btn', t('downloadPreparing'), true);
  chrome.runtime.sendMessage({
    action: 'DOWNLOAD_MEDIA',
    url: media.url,
    filename: buildDownloadFilename(post, media)
  }, (response) => {
    if (response && response.success) {
      updateModalActionState('modal-download-btn', t('downloadStarted'));
    } else {
      updateModalActionState('modal-download-btn', response?.error || t('downloadFailed'));
    }

    setTimeout(() => updateModalActionState('modal-download-btn', t('downloadMedia')), 1800);
  });
}

function addCurrentPostToCollection() {
  const post = getCurrentModalPost();
  if (!post) return;

  updateModalActionState('modal-collection-btn', t('savingToInstagram'), true);
  chrome.runtime.sendMessage({
    action: 'ADD_POST_TO_NOSTALGIA_COLLECTION',
    post: {
      id: post.id,
      link: post.link,
      title: post.title,
      username: post.username
    }
  }, (response) => {
    if (response && response.success) {
      updateModalActionState('modal-collection-btn', response.message || t('savedToNostalgia'));
    } else {
      updateModalActionState('modal-collection-btn', response?.error || t('saveFailed'));
    }

    setTimeout(() => updateModalActionState('modal-collection-btn', t('addToCollection')), 2200);
  });
}

function bumpCurrentPostToTop() {
  const post = getCurrentModalPost();
  if (!post) return;

  updateModalActionState('modal-bump-btn', t('bumping'), true);
  chrome.runtime.sendMessage({
    action: 'BUMP_POST_TO_TOP',
    post: { id: post.id, link: post.link }
  }, (response) => {
    if (response && response.success) {
      updateModalActionState('modal-bump-btn', t('bumpedToTop'));
      // Reflect the new order locally without a full reload.
      if (typeof response.savedOrder === 'number') {
        post.savedOrder = response.savedOrder;
      }
    } else {
      updateModalActionState('modal-bump-btn', response?.error || t('bumpFailed'));
    }

    setTimeout(() => updateModalActionState('modal-bump-btn', t('bumpToTop'), false), 2200);
  });
}

// Warm the browser's media cache for the upcoming video so it starts instantly
// when the user advances. A detached-but-attached hidden, muted
// <video preload="auto"> is created off-screen and never played -- that alone
// tells the browser to begin fetching/buffering the bytes, with no sound and no
// visible playback. Only one clip is buffered at a time.
function bufferUpcomingVideo(url) {
  if (!url || url === preloadBufferedUrl) return;
  disposePreloadBuffer();
  preloadBufferedUrl = url;

  const buffer = document.createElement('video');
  buffer.muted = true;
  buffer.preload = 'auto';
  buffer.playsInline = true;
  buffer.setAttribute('aria-hidden', 'true');
  // Off-screen and inert: it buffers but never shows or plays.
  buffer.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  buffer.src = url;
  document.body.appendChild(buffer);
  try { buffer.load(); } catch (e) { /* ignore */ }
  preloadBufferVideo = buffer;
}

function disposePreloadBuffer() {
  if (preloadBufferVideo) {
    try {
      preloadBufferVideo.pause();
      preloadBufferVideo.removeAttribute('src');
      preloadBufferVideo.load();
      preloadBufferVideo.remove();
    } catch (e) { /* ignore */ }
    preloadBufferVideo = null;
  }
  preloadBufferedUrl = null;
}

function preloadPrimaryVideo(post) {
  if (!post || !post.isVideo || !post.link) return;

  const cacheKey = getModalCacheKey(post);
  const cached = modalMediaCache.get(cacheKey);
  if (cached?.url) {
    bufferUpcomingVideo(cached.url);
    return;
  }

  chrome.runtime.sendMessage({
    action: 'FETCH_VIDEO_CDN',
    permalink: post.link,
    postId: post.id
  }, (response) => {
    if (response && response.success && response.videoUrl) {
      cacheModalMedia(cacheKey, { isVideo: true, url: response.videoUrl, extension: 'mp4' });
      bufferUpcomingVideo(response.videoUrl);
    }
  });
}

function preloadCarouselVideo(post, idx) {
  if (!post || !post.carouselMedia || idx < 0 || idx >= post.carouselMedia.length) return;

  const item = post.carouselMedia[idx];
  if (!item?.isVideo || !post.link) return;

  const cacheKey = getModalCacheKey(post, idx);
  const cached = modalMediaCache.get(cacheKey);
  if (cached?.url) {
    bufferUpcomingVideo(cached.url);
    return;
  }

  chrome.runtime.sendMessage({
    action: 'FETCH_CAROUSEL_VIDEO',
    permalink: post.link,
    postId: post.id,
    carouselIndex: idx
  }, (response) => {
    if (response && response.success && response.videoUrl) {
      cacheModalMedia(cacheKey, { isVideo: true, url: response.videoUrl, extension: 'mp4' });
      bufferUpcomingVideo(response.videoUrl);
    }
  });
}

function preloadUpcomingModalMedia(index = currentModalIndex) {
  if (!currentAutoplayEnabled) return;

  const nextPost = displayedPosts[index + 1];
  if (!nextPost) return;

  if (nextPost.isCarousel && nextPost.carouselMedia && nextPost.carouselMedia.length > 0) {
    preloadCarouselVideo(nextPost, 0);
    return;
  }

  preloadPrimaryVideo(nextPost);
}

function attachVideoAutoplay(video, onAdvance = null) {
  if (!video) return;

  video.addEventListener('playing', () => {
    if (currentAutoplayEnabled) {
      preloadUpcomingModalMedia();
    }
  });

  video.addEventListener('ended', () => {
    if (!currentAutoplayEnabled) {
      return;
    }

    if (typeof onAdvance === 'function') {
      onAdvance();
    } else {
      advanceModalToNext();
    }
  });
}

function clearAutoplayImageTimer() {
  if (autoplayImageTimer) {
    clearTimeout(autoplayImageTimer);
    autoplayImageTimer = null;
  }
}

// Autoplay used to stall on image posts (they never fire 'ended'). Hold each
// image for a few seconds, then advance -- but only while the modal is still on
// this same post (generation guard) and autoplay is still on.
function scheduleAutoplayImageAdvance() {
  clearAutoplayImageTimer();
  if (!currentAutoplayEnabled) return;
  const gen = modalGeneration;
  autoplayImageTimer = setTimeout(() => {
    autoplayImageTimer = null;
    if (gen !== modalGeneration || !currentAutoplayEnabled) return;
    advanceModalToNext();
  }, AUTOPLAY_IMAGE_DURATION_MS);
}

// Same idea for an image slide inside a carousel: advance to the next slide, or
// on to the next post once the carousel's last slide has been shown.
function scheduleAutoplayCarouselImageAdvance(post, idx) {
  clearAutoplayImageTimer();
  if (!currentAutoplayEnabled) return;
  const item = post.carouselMedia?.[idx];
  if (!item || item.isVideo) return; // videos advance on their 'ended' event
  const gen = modalGeneration;
  autoplayImageTimer = setTimeout(() => {
    autoplayImageTimer = null;
    if (gen !== modalGeneration || !currentAutoplayEnabled) return;
    if (currentCarouselIndex !== idx) return;
    const nextIdx = idx + 1;
    if (nextIdx < post.carouselMedia.length) {
      goToCarouselSlide(nextIdx, post);
    } else {
      advanceModalToNext();
    }
  }, AUTOPLAY_IMAGE_DURATION_MS);
}

// Advance the modal to the next post. Rolls onto the next page automatically
// when the current page is exhausted, so autoplay/skip keep going instead of
// stopping at the end of a page.
function advanceModalToNext() {
  if (currentModalIndex < 0) return;
  clearAutoplayImageTimer();

  const nextIndex = currentModalIndex + 1;
  if (nextIndex < displayedPosts.length) {
    openModal(nextIndex);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalPosts / postsPerPage));
  if (currentPage >= totalPages) return; // genuinely the last post

  const gen = modalGeneration;
  currentPage++;
  loadPosts(false, false, () => {
    // Bail if the user closed or navigated the modal while the page loaded.
    if (gen !== modalGeneration) return;
    if (displayedPosts.length > 0) {
      window.scrollTo({ top: 0 });
      openModal(0);
    }
  });
}

// Open modal
function openModal(index, carouselIdx = 0) {
  if (index < 0 || index >= displayedPosts.length) return;

  // New media context: invalidate any in-flight fetch callbacks from the post we
  // were just on, and cancel a pending image-autoplay advance.
  modalGeneration++;
  clearAutoplayImageTimer();

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
  currentModalVideoUrl = null;
  const post = displayedPosts[index];

  if (!post) return;

  const titleEl = document.getElementById('modal-title');
  const captionEl = document.getElementById('modal-caption');
  const usernameEl = document.getElementById('modal-username');
  const linkEl = document.getElementById('modal-link');
  const autoplayBtn = document.getElementById('modal-autoplay-btn');
  const loopBtn = document.getElementById('modal-loop-btn');
  const downloadBtn = document.getElementById('modal-download-btn');
  const collectionBtn = document.getElementById('modal-collection-btn');
  const bumpBtn = document.getElementById('modal-bump-btn');
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

  titleEl.textContent = post.username ? `@${post.username}` : t('postFallbackTitle');
  captionEl.textContent = post.title || '';
  usernameEl.textContent = `@${post.username || t('unknownUser')}`;

  linkEl.style.display = post.link ? '' : 'none';
  linkEl.href = post.link || '#';

  if (downloadBtn) {
    downloadBtn.disabled = false;
    downloadBtn.textContent = t('downloadMedia');
  }

  if (autoplayBtn) {
    autoplayBtn.disabled = false;
  }

  if (loopBtn) {
    loopBtn.disabled = false;
  }

  if (collectionBtn) {
    collectionBtn.disabled = false;
    collectionBtn.textContent = t('addToCollection');
  }

  if (bumpBtn) {
    bumpBtn.disabled = false;
    bumpBtn.textContent = t('bumpToTop');
  }

  updateModalAutoplayButton(post);
  updateModalLoopButton(post);

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

  updateModalSkipButton();

  // Keep autoplay moving through standalone image posts (videos advance on
  // their own 'ended' event; carousels are handled per-slide).
  if (currentAutoplayEnabled && !post.isVideo && !isModalAutoplayCapable(post) && !post.isCarousel) {
    scheduleAutoplayImageAdvance();
  }

  preloadUpcomingModalMedia(index);
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
      const bgStyle = item.imageUrl ? `style="background-image: url('${item.imageUrl}')"` : '';
      slide.innerHTML = `
        <div class="loading-video" ${bgStyle}>
          <div class="spinner"></div>
          <p>${t('loadingVideo')}</p>
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
  scheduleAutoplayCarouselImageAdvance(post, currentCarouselIndex);
}

// Load content for a carousel slide
function loadCarouselSlide(idx, post) {
  const gen = modalGeneration;
  const items = post.carouselMedia;
  const item = items[idx];
  const slides = document.querySelectorAll('.carousel-slide');
  const slide = slides[idx];

  if (!slide || !item) return;

  // Check if already loaded
  if (slide.dataset.loaded === 'true') return;

  const cacheKey = getModalCacheKey(post, idx);
  const cachedMedia = modalMediaCache.get(cacheKey);

  if (item.isVideo && cachedMedia?.url) {
    const video = createVideoElement(cachedMedia.url);
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

    attachVideoAutoplay(video, () => {
      const nextIdx = idx + 1;
      if (nextIdx < items.length) {
        goToCarouselSlide(nextIdx, post);
      } else {
        advanceModalToNext();
      }
    });

    slide.innerHTML = '';
    slide.appendChild(video);
    slide.dataset.loaded = 'true';

    // Play as soon as it's the active slide, regardless of the auto-advance
    // preference below -- that setting only controls whether playback
    // continues on to the next item/post once this one ends.
    if (idx === currentCarouselIndex) {
      attemptPlay(video);
    }

    preloadCarouselVideo(post, idx + 1);
    return;
  }

  if (item.isVideo) {
    // Fetch video from Instagram
    chrome.runtime.sendMessage({
      action: 'FETCH_CAROUSEL_VIDEO',
      permalink: post.link,
      postId: post.id,
      carouselIndex: idx
    }, (response) => {
      // Ignore a late resolution once the user has moved on.
      if (gen !== modalGeneration) return;
      if (response && response.success && response.videoUrl) {
        cacheModalMedia(cacheKey, { isVideo: true, url: response.videoUrl, extension: 'mp4' });
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

        attachVideoAutoplay(video, () => {
          const nextIdx = idx + 1;
          if (nextIdx < items.length) {
            goToCarouselSlide(nextIdx, post);
          } else {
            advanceModalToNext();
          }
        });

        // Play as soon as it's the current slide, independent of the
        // auto-advance preference (see the cached-media branch above).
        if (idx === currentCarouselIndex) {
          attemptPlay(video);
        }

        preloadCarouselVideo(post, idx + 1);
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
          playOverlay.innerHTML = `<span>▶</span> ${t('videoUnavailable')}`;
          slide.appendChild(playOverlay);
        } else {
          slide.innerHTML = `<p class="error-message">${t('failedToLoadVideo')}</p>`;
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
      img.alt = t('postFallbackTitle');
      img.onload = () => {
        slide.dataset.loaded = 'true';
      };
      img.onerror = () => {
        slide.innerHTML = `<p class="error-message">${t('imageFailedToLoad')}</p>`;
        slide.dataset.loaded = 'true';
      };
      img.src = imageUrl;
      slide.innerHTML = '';
      slide.appendChild(img);
    } else {
      slide.innerHTML = `<p class="no-media">${t('imageNotAvailable')}</p>`;
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
  if (currentAutoplayEnabled) {
    preloadCarouselVideo(post, idx + 1);
  }

  // Play video if the new slide has one, regardless of the auto-advance
  // preference -- the user explicitly navigated here.
  const newSlide = slides[idx];
  if (newSlide) {
    const video = newSlide.querySelector('video');
    if (video) {
      attemptPlay(video);
    }
  }

  // If this slide is an image, keep autoplay moving after a short hold.
  scheduleAutoplayCarouselImageAdvance(post, idx);
}

// Render single video in modal
function renderVideoModal(post, container) {
  // Capture the modal context this render belongs to; if the user navigates or
  // closes before the async fetch resolves, we must not append/play the video.
  const gen = modalGeneration;
  const posterUrl = post.image || post.thumbnail || '';
  const videoShell = createModalVideoShell(posterUrl);

  container.innerHTML = '';
  container.appendChild(videoShell);

  if (!post.link) {
    container.innerHTML = `<p class="error-message">${t('postHasNoLink')}</p>`;
    return;
  }

  const cacheKey = getModalCacheKey(post);
  const cachedMedia = modalMediaCache.get(cacheKey);

  const applyVideoToContainer = (videoUrl) => {
    if (gen !== modalGeneration) return;
    currentModalVideoUrl = videoUrl;
    // Successful load -> the post is available again; clear any stale flag.
    setPostUnavailableState(post, false);
    cacheModalMedia(cacheKey, { isVideo: true, url: videoUrl, extension: 'mp4' });

    const video = createVideoElement(videoUrl);
    video.controls = true;
    video.autoplay = true;
    video.className = 'modal-video portrait';
    videoShell.innerHTML = '';
    videoShell.appendChild(video);
    container.innerHTML = '';
    container.appendChild(videoShell);

    video.addEventListener('loadedmetadata', () => {
      const aspectRatio = video.videoWidth / video.videoHeight;
      setModalVideoLayoutClass(video, aspectRatio);
      setModalVideoLayoutClass(videoShell, aspectRatio);
    });

    attachVideoAutoplay(video);

    video.addEventListener('loadeddata', () => {
      attemptPlay(video);
    });

    preloadUpcomingModalMedia();
  };

  if (cachedMedia?.url) {
    applyVideoToContainer(cachedMedia.url);
    return;
  }

  chrome.runtime.sendMessage({
    action: 'FETCH_VIDEO_CDN',
    permalink: post.link,
    postId: post.id
  }, (response) => {
    if (gen !== modalGeneration) return;

    if (chrome.runtime.lastError) {
      renderUnavailableState(container, post, { message: t('failedToLoadVideo'), unavailable: false });
      return;
    }

    if (response && response.success && response.videoUrl) {
      applyVideoToContainer(response.videoUrl);
    } else if (response && response.unavailable) {
      // Instagram confirmed the post is gone: flag it (grays out in the grid)
      // and offer a one-click removal.
      setPostUnavailableState(post, true);
      renderUnavailableState(container, post);
    } else {
      // The video wouldn't load and Instagram didn't hand us its explicit
      // "unavailable" page (common for genuinely deleted reels). Don't silently
      // dead-end -- still offer a Remove button so the user can clear the stale
      // post, but leave the grid flag alone since we can't be certain it's gone.
      renderUnavailableState(container, post, {
        message: t('failedToLoadVideoWithReason', { error: response?.error || t('unknownError') }),
        unavailable: false
      });
    }
  });
}

// Render single image in modal
function renderImageModal(post, container) {
  const imgSrc = post.image || post.thumbnail;

  if (imgSrc && typeof imgSrc === 'string') {
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = post.title || t('postFallbackTitle');
    img.className = 'modal-image';
    img.onerror = () => {
      container.innerHTML = `<p class="error-message">${t('imageFailedToLoad')}</p>`;
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
            cacheModalMedia(getModalCacheKey(post), { isVideo: false, url: response.imageUrl, extension: 'jpg' });
          };
          fullResImg.src = response.imageUrl;
        }
      });
    }
  } else {
    container.innerHTML = `<p class="no-media">${t('imageNotAvailable')}</p>`;
  }
}

// Close modal
function closeModal() {
  // Invalidate in-flight media callbacks and stop the image-autoplay timer so
  // nothing gets appended or plays after the modal is gone.
  modalGeneration++;
  clearAutoplayImageTimer();
  disposePreloadBuffer();

  const modal = document.getElementById('modal');

  // Stop every modal video (belt-and-braces: also catch any that slipped
  // outside #modal-media) so audio never keeps playing in the background.
  modal.querySelectorAll('video').forEach(video => {
    video.pause();
    video.currentTime = 0;
    video.removeAttribute('src');
    video.load();
  });

  const mediaContainer = modal.querySelector('#modal-media');
  if (mediaContainer) {
    mediaContainer.innerHTML = '';
  }

  modal.classList.remove('active');
  document.body.style.overflow = '';
  currentModalIndex = -1;
  currentCarouselIndex = 0;
  currentModalVideoUrl = null;
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
    ? t('showingRangeOfTotal', { start: startIndex + 1, end: endIndex, total: totalPosts })
    : t('noPosts');

  const totalPages = Math.ceil(totalPosts / postsPerPage);
  document.getElementById('page-info').textContent = totalPages > 0
    ? t('pageOf', { page: currentPage, totalPages })
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
    startBtn.innerHTML = buildButtonMarkup(t('syncing'), getSpinnerIconMarkup());
    startBtn.classList.add('syncing');
  }
  if (stopBtn) stopBtn.style.display = 'block';
  if (progressSection) progressSection.style.display = 'block';
  if (completeSection) completeSection.style.display = 'none';
  if (headerBtn) headerBtn.classList.add('syncing');
  if (resumeInfo) resumeInfo.style.display = 'none';
  syncTotalFinalized = false;
  setTotalTileEstimated(true);
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
        resumeDetails.textContent = getResumeDetailsText(progress);
      }
      if (startBtn) {
        startBtn.innerHTML = buildButtonMarkup(t('resumeSync'), getPlayIconMarkup());
      }
      // Update stats display
      updateSyncPanelProgress(progress.synced, progress.failed, progress.total);
    } else {
      if (resumeInfo) resumeInfo.style.display = 'none';
      if (startBtn) {
        startBtn.innerHTML = buildButtonMarkup(t('startSync'), getSyncIconMarkup());
      }
    }
  });
}

function clearSyncProgress() {
  chrome.storage.local.remove(['instagram_sync_progress'], () => {
    checkSyncProgress();
    document.getElementById('sync-synced-count').textContent = '0';
    document.getElementById('sync-failed-count').textContent = '0';
    const totalElement = document.getElementById('sync-total-count');
    if (totalElement) totalElement.textContent = '0';
    lastKnownSyncTotal = 0;
  });
}

function clearAllData() {
  if (!confirm(t('clearAllConfirm'))) {
    return;
  }

  const btn = document.getElementById('clear-all-data-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = buildButtonMarkup(t('clearing'), getSpinnerIconMarkup(16));
  }

  chrome.runtime.sendMessage({ action: 'CLEAR_ALL_POSTS' }, (response) => {
    if (response && response.success) {
      // Also clear sync progress and resumable cursor/rebuild state
      chrome.storage.local.remove(['instagram_sync_progress', 'nostalgia_sync_cursor', 'nostalgia_rebuild_state'], () => {
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
        closeSettingsModal();
      });
    }

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = buildButtonMarkup(t('clearAllData'), getTrashIconMarkup());
    }

    // Clear sync status
    updateSyncStatus('', '');
  });
}

function exportData() {
  const btn = document.getElementById('export-data-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = buildButtonMarkup(t('exporting'), getSpinnerIconMarkup(16));
  }

  chrome.runtime.sendMessage({ action: 'EXPORT_DATA' }, (response) => {
    if (response && response.success) {
      const json = JSON.stringify(response.data);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nostalgia-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else {
      alert(response?.error || t('exportFailed'));
    }

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = buildButtonMarkup(t('exportData'), getExportIconMarkup());
    }
  });
}

function importData(file) {
  if (!confirm(t('importConfirm'))) {
    return;
  }

  const btn = document.getElementById('import-data-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = buildButtonMarkup(t('importing'), getSpinnerIconMarkup(16));
  }

  const restoreBtn = () => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = buildButtonMarkup(t('importData'), getImportIconMarkup());
    }
  };

  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (error) {
      alert(t('importInvalidFile'));
      restoreBtn();
      return;
    }

    chrome.runtime.sendMessage({ action: 'IMPORT_DATA', data }, (response) => {
      if (response && response.success) {
        allHashtagsCache = [];
        loadPosts();
        alert(t('importSuccess', { count: response.importedPosts }));
        closeSettingsModal();
      } else {
        alert(response?.error || t('importFailed'));
      }
      restoreBtn();
    });
  };
  reader.onerror = () => {
    alert(t('importInvalidFile'));
    restoreBtn();
  };
  reader.readAsText(file);
}

function startSync() {
  isSyncing = true;
  syncTotalFinalized = false;
  setSyncGridBanner(true);
  setTotalTileEstimated(true);
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const progressSection = document.getElementById('sync-progress-section');
  const completeSection = document.getElementById('sync-complete-section');
  const headerBtn = document.getElementById('sync-btn');

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = buildButtonMarkup(t('syncing'), getSpinnerIconMarkup());
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
  updateLocalizedSyncStatus('syncing', 'syncing');
}

function stopSync() {
  chrome.runtime.sendMessage({ action: 'STOP_SYNC' });
  const stopBtn = document.getElementById('sync-stop-btn');
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.textContent = t('stopping');
  }
}

function handleSyncStarted() {
  document.getElementById('sync-progress-bar').style.width = '10%';
  updateLocalizedSyncStatus('syncing', 'preparing');
}

// While syncing, the TOTAL tile shows Instagram's reported count, which is only
// an estimate (it counts deleted/private saved posts that never come down the
// feed). Label it as such during sync; on completion we swap in the real count.
function setTotalTileEstimated(estimated) {
  const label = document.getElementById('sync-total-label');
  const tile = document.getElementById('sync-total-tile');
  if (label) label.textContent = estimated ? t('estimatedTotal') : t('total');
  if (tile) tile.title = estimated ? t('estimatedTotalTooltip') : '';
}

function updateSyncPanelProgress(synced, failed, total = 0) {
  const syncedSafe = (typeof synced === 'number') ? synced : 0;
  const failedSafe = (typeof failed === 'number') ? failed : 0;

  document.getElementById('sync-synced-count').textContent = syncedSafe;
  document.getElementById('sync-failed-count').textContent = failedSafe;
  const totalElement = document.getElementById('sync-total-count');
  // Once finalized (sync complete), the TOTAL tile holds the real synced count --
  // never let a straggling progress update overwrite it with the estimate.
  if (!syncTotalFinalized) {
    // Only update total when we have a meaningful value. A transient 0 from the
    // content script (unknown total) should not wipe a previously known total.
    if (typeof total === 'number' && total > 0) {
      lastKnownSyncTotal = total;
    }
    if (totalElement) {
      totalElement.textContent = (lastKnownSyncTotal > 0) ? lastKnownSyncTotal : (typeof total === 'number' ? total : 0);
    }
  }

  const progressBar = document.getElementById('sync-progress-bar');
  const processed = syncedSafe + failedSafe;

  // Only update main page sync status if actively syncing
  // (not when just displaying saved progress from a previous session)
  if (isSyncing) {
    if (total > 0) {
      const percent = Math.min(99, Math.round((processed / total) * 100));
      updateLocalizedSyncStatus('syncing', 'syncStatusPercent', { percent });
    } else if (processed > 0) {
      updateLocalizedSyncStatus('syncing', 'syncing');
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

  // Update the tiles first, then force the bar to 100%. updateSyncPanelProgress
  // recomputes the bar width from synced/total (capped at 99%), so setting the
  // width must come AFTER it -- otherwise the "complete" bar snaps back to a
  // partial fill whenever Instagram's reported total exceeds what we could sync
  // (deleted/unavailable saved posts inflate that total).
  updateSyncPanelProgress(syncedCount, failedCount, lastKnownSyncTotal);

  if (progressBar) progressBar.style.width = '100%';

  // Sync finished: the estimate is no longer relevant -- show the real number of
  // posts we actually have and drop the "Estimated" qualifier. Latch it so no
  // late progress message can revert the tile back to the estimate.
  syncTotalFinalized = true;
  lastKnownSyncTotal = syncedCount;
  const totalEl = document.getElementById('sync-total-count');
  if (totalEl) totalEl.textContent = syncedCount;
  setTotalTileEstimated(false);

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = buildButtonMarkup(t('syncAgain'), getSyncIconMarkup());
    startBtn.classList.remove('syncing');
  }
  if (stopBtn) {
    stopBtn.style.display = 'none';
    stopBtn.disabled = false;
    stopBtn.textContent = t('stopSync');
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

  updateSyncPanelProgress(syncedCount, failedCount, lastKnownSyncTotal);

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = buildButtonMarkup(t('resumeSync'), getPlayIconMarkup());
    startBtn.classList.remove('syncing');
  }
  if (stopBtn) {
    stopBtn.style.display = 'none';
    stopBtn.disabled = false;
    stopBtn.textContent = t('stopSync');
  }
  if (headerBtn) headerBtn.classList.remove('syncing');


  // Show resume info
  checkSyncProgress();

  // Clear sync status
  updateSyncStatus('', '');
}

function handleSyncLoginRequired(error) {
  isSyncing = false;
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const headerBtn = document.getElementById('sync-btn');

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = buildButtonMarkup(t('retrySync'), getSyncIconMarkup());
    startBtn.classList.remove('syncing');
  }

  if (stopBtn) {
    stopBtn.style.display = 'none';
    stopBtn.disabled = false;
    stopBtn.textContent = t('stopSync');
  }

  if (headerBtn) headerBtn.classList.remove('syncing');

  updateLocalizedSyncStatus('error', 'syncStatusLoginRequired', { error });
}

function handleSyncError(error) {
  isSyncing = false;
  const startBtn = document.getElementById('sync-start-btn');
  const stopBtn = document.getElementById('sync-stop-btn');
  const headerBtn = document.getElementById('sync-btn');

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = buildButtonMarkup(t('retrySync'), getSyncIconMarkup());
    startBtn.classList.remove('syncing');
  }
  if (stopBtn) {
    stopBtn.style.display = 'none';
    stopBtn.disabled = false;
    stopBtn.textContent = t('stopSync');
  }
  if (headerBtn) headerBtn.classList.remove('syncing');

  // Show error in sync status
  updateLocalizedSyncStatus('error', 'syncStatusError', { error });

  // Clear error after 5 seconds
  setTimeout(() => {
    updateSyncStatus('', '');
  }, 5000);
}


// Update sync status - both in panel and in main content area
function updateSyncStatus(status, message, percent = null) {
  // Update status in main content (visible when panel is closed)
  const statusEl = document.getElementById('sync-status');
  if (statusEl) {
    statusEl.className = `sync-status ${status}`;
    statusEl.innerHTML = '';

    if (message) {
      if (status === 'syncing' && typeof percent === 'number') {
        const track = document.createElement('div');
        track.className = 'sync-status-track';
        const fill = document.createElement('div');
        fill.className = 'sync-status-fill';
        fill.style.width = `${percent}%`;
        track.appendChild(fill);
        statusEl.appendChild(track);
      }

      const label = document.createElement('span');
      label.className = 'sync-status-label';
      label.textContent = message;
      statusEl.appendChild(label);
    }

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
  container.innerHTML = '';

  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';

  const icon = document.createElement('div');
  icon.className = 'empty-icon';
  icon.textContent = '📭';

  const text = document.createElement('p');
  text.textContent = message;

  const syncBtn = document.createElement('button');
  syncBtn.className = 'sync-btn-inline';
  syncBtn.id = 'error-sync-btn';
  syncBtn.innerHTML = buildButtonMarkup(t('syncNow'), getSyncIconMarkup());

  emptyState.appendChild(icon);
  emptyState.appendChild(text);
  emptyState.appendChild(syncBtn);
  container.appendChild(emptyState);

  if (syncBtn) {
    syncBtn.addEventListener('click', openSyncPanel);
  }
}
