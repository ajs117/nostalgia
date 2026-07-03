const fs = require('fs');
const path = require('path');
const { TextDecoder, TextEncoder } = require('util');
const vm = require('vm');

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const { JSDOM } = require('jsdom');

const APP_PATH = path.join(__dirname, '..', 'app.js');
const I18N_PATH = path.join(__dirname, '..', 'i18n.js');
const BACKGROUND_PATH = path.join(__dirname, '..', 'background.js');
const CONTENT_SCRIPT_PATH = path.join(__dirname, '..', 'contentScript.js');
const TEST_IMAGE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function loadBackgroundContext() {
  const source = fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const context = {
    console,
    Promise,
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        onMessage: { addListener: jest.fn() },
        getURL: jest.fn((value) => value),
        lastError: null
      },
      action: {
        onClicked: { addListener: jest.fn() }
      },
      tabs: {
        onRemoved: { addListener: jest.fn() },
        onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
        onActivated: { addListener: jest.fn(), removeListener: jest.fn() },
        query: jest.fn(),
        create: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        sendMessage: jest.fn(),
        remove: jest.fn(),
        move: jest.fn()
      },
      scripting: {
        executeScript: jest.fn()
      },
      storage: {
        local: {
          get: jest.fn(),
          clear: jest.fn()
        }
      }
    },
    indexedDB: {
      open: jest.fn()
    },
    fetch: jest.fn(),
    Blob,
    FileReader,
    URL
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function loadContentScriptContext() {
  const source = fs.readFileSync(CONTENT_SCRIPT_PATH, 'utf8');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://www.instagram.com/'
  });

  const context = {
    console,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    MutationObserver: dom.window.MutationObserver,
    URL,
    URLSearchParams,
    FormData,
    Blob,
    fetch: jest.fn(),
    confirm: jest.fn(() => true),
    chrome: {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn()
      },
      storage: {
        local: {
          get: jest.fn((keys, callback) => callback({})),
          set: jest.fn((value, callback) => callback && callback()),
          remove: jest.fn((keys, callback) => callback && callback())
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function createAppDom() {
  return new JSDOM(`<!doctype html>
    <html lang="en" dir="ltr">
      <body>
        <input id="search-input" />
        <input id="search-input-mobile" />
        <div id="posts-container"></div>
        <div id="pagination"></div>
        <div id="filtered-count"></div>
        <div id="page-info"></div>
        <div id="hashtag-chips"></div>
        <div id="hashtag-chips-mobile"></div>
        <button id="sync-btn" type="button"></button>
        <button id="settings-btn" type="button"></button>
        <select id="language-select"></select>
        <select id="theme-select">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <div id="settings-modal"></div>
        <div id="settings-modal-overlay"></div>
        <button id="settings-modal-close" type="button"></button>
        <select id="sort-select">
          <option value="newest-saved">Newest Saved</option>
          <option value="random">Random</option>
        </select>
        <select id="sort-select-mobile">
          <option value="newest-saved">Newest Saved</option>
          <option value="random">Random</option>
        </select>
        <select id="type-filter">
          <option value="all">All</option>
        </select>
        <select id="type-filter-mobile">
          <option value="all">All</option>
        </select>
        <button id="random-refresh-btn" class="random-refresh-btn" type="button"></button>
        <button id="random-refresh-btn-mobile" class="random-refresh-btn" type="button"></button>
        <button id="mobile-filters-toggle" type="button"></button>
        <div id="mobile-filters-drawer"></div>
        <div id="drawer-overlay"></div>
        <button id="close-filters" type="button"></button>
        <div id="modal">
          <div id="modal-media"></div>
        </div>
        <button id="modal-close" type="button"></button>
        <button id="modal-prev" type="button"></button>
        <button id="modal-next" type="button"></button>
        <button id="modal-autoplay-btn" type="button"></button>
        <button id="modal-download-btn" type="button"></button>
        <button id="modal-collection-btn" type="button"></button>
        <h3 id="modal-title"></h3>
        <p id="modal-username"></p>
        <p id="modal-caption"></p>
        <div id="modal-hashtags"></div>
        <a id="modal-link" href="#"></a>
        <div id="sync-panel"></div>
        <div id="sync-panel-overlay"></div>
        <button id="sync-panel-close" type="button"></button>
        <button id="sync-start-btn" type="button"></button>
        <button id="sync-stop-btn" type="button"></button>
        <button id="sync-clear-progress" type="button"></button>
        <button id="clear-all-data-btn" type="button"></button>
        <div id="sync-status"></div>
        <div id="sync-progress-text"></div>
        <div id="sync-resume-info"></div>
        <div id="sync-resume-details"></div>
        <div id="sync-progress-section"></div>
        <div id="sync-complete-section"></div>
        <div id="sync-progress-bar"></div>
        <div id="sync-synced-count"></div>
        <div id="sync-failed-count"></div>
        <div id="sync-total-count"></div>
      </body>
    </html>`, {
    url: 'https://example.test/',
    runScripts: 'outside-only'
  });
}

function loadAppWindow(sendMessageImpl) {
  const dom = createAppDom();
  const i18nSource = fs.readFileSync(I18N_PATH, 'utf8');
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const chrome = {
    runtime: {
      sendMessage: jest.fn(sendMessageImpl),
      onMessage: { addListener: jest.fn() },
      lastError: null
    },
    storage: {
      local: {
        get: jest.fn((keys, callback) => callback({})),
        set: jest.fn((value, callback) => callback && callback()),
        remove: jest.fn((keys, callback) => callback && callback()),
        clear: jest.fn((callback) => callback && callback())
      }
    }
  };

  dom.window.chrome = chrome;
  dom.window.console = console;
  dom.window.scrollTo = jest.fn();
  dom.window.confirm = jest.fn(() => true);
  dom.window.navigator.language = 'en-US';
  dom.window.HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve());
  dom.window.HTMLMediaElement.prototype.pause = jest.fn();
  dom.window.setTimeout = setTimeout;
  dom.window.clearTimeout = clearTimeout;

  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.chrome = chrome;
  global.confirm = dom.window.confirm;

  dom.window.eval(i18nSource);
  dom.window.eval(source);

  return {
    dom,
    chrome,
    app: {
      loadPosts: dom.window.eval('loadPosts'),
      handleSortChange: dom.window.eval('handleSortChange'),
      handleRandomReshuffle: dom.window.eval('handleRandomReshuffle')
    }
  };
}

describe('Runtime behavior', () => {
  describe('contentScript.js resumable sync cursor', () => {
    test('loadSyncCursor returns defaults when nothing is stored', async () => {
      const context = loadContentScriptContext();
      context.chrome.storage.local.get.mockImplementation((keys, cb) => cb({}));

      const state = await vm.runInContext('loadSyncCursor()', context);
      expect(state).toEqual({ backfillCursor: '', backfillComplete: false });
    });

    test('loadSyncCursor restores a persisted backfill cursor', async () => {
      const context = loadContentScriptContext();
      context.chrome.storage.local.get.mockImplementation((keys, cb) =>
        cb({ nostalgia_sync_cursor: { backfillCursor: 'older-history-cursor', backfillComplete: true } })
      );

      const state = await vm.runInContext('loadSyncCursor()', context);
      expect(state).toEqual({ backfillCursor: 'older-history-cursor', backfillComplete: true });
    });

    test('saveSyncCursor writes the resumable state under its own key', async () => {
      const context = loadContentScriptContext();
      let written = null;
      context.chrome.storage.local.set.mockImplementation((value, cb) => {
        written = value;
        if (cb) cb();
      });

      await vm.runInContext('saveSyncCursor({ backfillCursor: "deep-cursor", backfillComplete: false })', context);
      expect(written).toEqual({
        nostalgia_sync_cursor: { backfillCursor: 'deep-cursor', backfillComplete: false }
      });
    });

    test('does not emit SYNC_STOPPED before the sync loop finishes cleanup', () => {
      const context = loadContentScriptContext();
      const listener = context.chrome.runtime.onMessage.addListener.mock.calls[0][0];

      vm.runInContext('isSyncing = true; syncedCount = 12; failedCount = 1;', context);
      listener({ action: 'STOP_SYNC' });

      expect(vm.runInContext('isSyncing', context)).toBe(false);
      expect(context.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'SYNC_STOPPED' }));
    });
  });

  describe('background.js random sorting', () => {
    test('uses a deterministic comparator for the same seed', () => {
      const context = loadBackgroundContext();
      const posts = [
        { id: 'post-a', timestamp: 100 },
        { id: 'post-b', timestamp: 200 },
        { id: 'post-c', timestamp: 300 },
        { id: 'post-d', timestamp: 400 },
        { id: 'post-e', timestamp: 500 }
      ];

      const firstOrder = [...posts]
        .sort((left, right) => context.comparePostsForStableRandom(left, right, 12345))
        .map((post) => post.id);
      const secondOrder = [...posts]
        .sort((left, right) => context.comparePostsForStableRandom(left, right, 12345))
        .map((post) => post.id);

      expect(firstOrder).toEqual(secondOrder);
      expect(posts.map((post) => context.stableHashString(`12345:${post.id}`)))
        .not.toEqual(posts.map((post) => context.stableHashString(`67890:${post.id}`)));
    });

    test('falls back to link and title identity when ids are missing', () => {
      const context = loadBackgroundContext();
      const posts = [
        { link: 'https://example.test/p/1', title: 'Alpha', timestamp: 10 },
        { link: 'https://example.test/p/2', title: 'Bravo', timestamp: 20 },
        { link: 'https://example.test/p/3', title: 'Charlie', timestamp: 30 }
      ];

      const firstOrder = [...posts]
        .sort((left, right) => context.comparePostsForStableRandom(left, right, 2468))
        .map((post) => post.link);
      const secondOrder = [...posts]
        .sort((left, right) => context.comparePostsForStableRandom(left, right, 2468))
        .map((post) => post.link);

      expect(firstOrder).toEqual(secondOrder);
    });

    test('keeps the Instagram tab open and activates it when login is required', () => {
      const context = loadBackgroundContext();
      const listener = context.chrome.runtime.onMessage.addListener.mock.calls[0][0];

      context.chrome.tabs.query.mockImplementation((query, callback) => {
        callback([{ id: 9001 }]);
      });

      vm.runInContext('activeInstagramTabId = 44;', context);

      listener({ action: 'SYNC_LOGIN_REQUIRED', error: 'Login required' }, {}, jest.fn());

      expect(context.chrome.tabs.update).toHaveBeenCalledWith(44, { active: true }, expect.any(Function));
      expect(context.chrome.tabs.remove).not.toHaveBeenCalled();
      expect(context.chrome.tabs.sendMessage).toHaveBeenCalledWith(9001, {
        action: 'SYNC_LOGIN_REQUIRED',
        error: 'Login required'
      }, expect.any(Function));
    });
  });

  describe('app.js request handling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    test('ignores stale responses after a newer load finishes first', () => {
      const requests = [];
      const { dom, app } = loadAppWindow((message, callback) => {
        requests.push({ message, callback });
      });
      const doc = dom.window.document;

      requests.length = 0;

      app.loadPosts();
      app.loadPosts();

      expect(requests).toHaveLength(2);
      expect(requests[0].message.action).toBe('GET_INSTAGRAM_POSTS');
      expect(requests[1].message.action).toBe('GET_INSTAGRAM_POSTS');

      requests[1].callback({
        success: true,
        posts: [{ id: 'fresh', title: 'Fresh post', username: 'new-user', image: TEST_IMAGE_DATA_URL }],
        total: 1
      });

      expect(doc.getElementById('posts-container').textContent).toContain('Fresh post');

      requests[0].callback({
        success: true,
        posts: [{ id: 'stale', title: 'Stale post', username: 'old-user', image: TEST_IMAGE_DATA_URL }],
        total: 1
      });

      expect(doc.getElementById('posts-container').textContent).toContain('Fresh post');
      expect(doc.getElementById('posts-container').textContent).not.toContain('Stale post');

      dom.window.close();
    });

    test('shows random reshuffle controls and sends a fresh seed', () => {
      const requests = [];

      const { dom, app } = loadAppWindow((message, callback) => {
        requests.push({ message, callback });
        if (callback) {
          callback({ success: true, posts: [], total: 0 });
        }
      });
      const doc = dom.window.document;

      requests.length = 0;

      const desktopSort = doc.getElementById('sort-select');
      desktopSort.value = 'random';

      app.handleSortChange({ target: desktopSort });

      expect(doc.getElementById('random-refresh-btn').classList.contains('visible')).toBe(true);
      expect(doc.getElementById('random-refresh-btn-mobile').classList.contains('visible')).toBe(true);
      expect(requests[0].message.sortBy).toBe('random');
      expect(Number.isFinite(requests[0].message.randomSeed)).toBe(true);

      app.handleRandomReshuffle();

      expect(requests[1].message.sortBy).toBe('random');
      expect(Number.isFinite(requests[1].message.randomSeed)).toBe(true);
      expect(requests[1].message.randomSeed).not.toBe(requests[0].message.randomSeed);

      dom.window.close();
    });

    test('downloads the current modal media through the background action', () => {
      const requests = [];
      const { dom, app } = loadAppWindow((message, callback) => {
        requests.push({ message, callback });

        if (message.action === 'GET_INSTAGRAM_POSTS' && callback) {
          callback({ success: true, posts: [], total: 0 });
          return;
        }

        if (message.action === 'DOWNLOAD_MEDIA' && callback) {
          callback({ success: true, downloadId: 77 });
        }
      });

      requests.length = 0;
      app.loadPosts();

      expect(requests[0].message.action).toBe('GET_INSTAGRAM_POSTS');

      requests[0].callback({
        success: true,
        posts: [{
          id: 'post-download',
          title: 'Download me',
          username: 'clipmaker',
          image: TEST_IMAGE_DATA_URL
        }],
        total: 1
      });

      dom.window.document.querySelector('.post-card').click();

      requests.length = 0;

      dom.window.eval('downloadCurrentMedia()');

      expect(requests).toHaveLength(1);
      expect(requests[0].message.action).toBe('DOWNLOAD_MEDIA');
      expect(requests[0].message.url).toBe(TEST_IMAGE_DATA_URL);
      expect(requests[0].message.filename).toBe('nostalgia/clipmaker-post-download.jpg');

      dom.window.close();
    });

    test('surfaces login-required sync state without leaving the UI stuck', () => {
      const { dom } = loadAppWindow((message, callback) => {
        if (callback) {
          callback({ success: true, posts: [], total: 0 });
        }
      });
      const doc = dom.window.document;

      dom.window.eval('isSyncing = true;');
      dom.window.eval('handleSyncLoginRequired("Login required.")');

      expect(doc.getElementById('sync-start-btn').disabled).toBe(false);
      expect(doc.getElementById('sync-start-btn').textContent).toContain('Retry Sync');
      expect(doc.getElementById('sync-stop-btn').style.display).toBe('none');
      expect(doc.getElementById('sync-status').textContent).toContain('The Instagram tab was opened so you can sign in');

      dom.window.close();
    });

    test('reserves portrait video space while the modal video is still loading', () => {
      let pendingVideoCallback = null;
      const { dom } = loadAppWindow((message, callback) => {
        if (message.action === 'FETCH_VIDEO_CDN') {
          pendingVideoCallback = callback;
          return;
        }

        if (callback) {
          callback({ success: true, posts: [], total: 0 });
        }
      });

      dom.window.eval(`
        renderVideoModal({
          id: 'video-post',
          link: 'https://www.instagram.com/reel/example/',
          image: '${TEST_IMAGE_DATA_URL}'
        }, document.getElementById('modal-media'));
      `);

      const shell = dom.window.document.querySelector('.modal-video-shell');
      expect(shell).not.toBeNull();
      expect(shell.classList.contains('portrait')).toBe(true);
      expect(dom.window.document.querySelector('.loading-video')).not.toBeNull();

      pendingVideoCallback({ success: true, videoUrl: 'https://cdn.example.test/video.mp4' });

      expect(dom.window.document.querySelector('.modal-video')).not.toBeNull();
      dom.window.close();
    });

    test('does not replace popular hashtags with current-page tags when the global fetch fails', () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const { dom, chrome } = loadAppWindow((message, callback) => {
        if (message.action === 'GET_ALL_HASHTAGS') {
          chrome.runtime.lastError = { message: 'temporary failure' };
          callback(undefined);
          chrome.runtime.lastError = null;
          return;
        }

        if (callback) {
          callback({ success: true, posts: [], total: 0 });
        }
      });
      const chips = dom.window.document.getElementById('hashtag-chips');

      dom.window.eval(`
        allPosts = [{ id: 'page-only', title: 'Only on this page #pageonly', username: 'demo' }];
        allHashtagsCache = [];
        fetchAllHashtags(2);
      `);

      expect(chips.textContent).not.toContain('#pageonly');
      expect(chips.textContent).toContain('No hashtags found');

      dom.window.close();
    });

    test('shows an autoplay toggle in the modal for video posts and persists changes', () => {
      const requests = [];
      const { dom, app } = loadAppWindow((message, callback) => {
        requests.push({ message, callback });

        if (message.action === 'GET_INSTAGRAM_POSTS' && callback) {
          callback({ success: true, posts: [], total: 0 });
          return;
        }

        if (message.action === 'FETCH_VIDEO_CDN' && callback) {
          callback({ success: true, videoUrl: 'https://cdn.example.test/video.mp4' });
        }
      });

      requests.length = 0;
      app.loadPosts();

      requests[0].callback({
        success: true,
        posts: [{
          id: 'video-autoplay',
          title: 'Video post',
          username: 'videomaker',
          image: TEST_IMAGE_DATA_URL,
          link: 'https://www.instagram.com/reel/video-autoplay/',
          isVideo: true
        }],
        total: 1
      });

      dom.window.document.querySelector('.post-card').click();

      const autoplayBtn = dom.window.document.getElementById('modal-autoplay-btn');
      expect(autoplayBtn.style.display).not.toBe('none');
      expect(autoplayBtn.textContent).toContain('Autoplay On');

      dom.window.eval('toggleModalAutoplay()');

      expect(autoplayBtn.textContent).toContain('Autoplay Off');
      expect(dom.window.localStorage.getItem('nostalgia_autoplay')).toBe('false');

      dom.window.close();
    });
  });
});
