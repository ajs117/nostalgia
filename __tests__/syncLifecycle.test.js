/**
 * Sync lifecycle state-machine tests.
 *
 * Unlike the other suites (which test logic copies), these load the REAL
 * background.js with a stateful fake `chrome` and drive its onMessage listener,
 * covering the class of bugs that has repeatedly bitten the sync feature:
 * state guards, service-worker restarts, and tab lifecycle.
 */

function createFakeChrome({ sessionData = {}, existingTabs = [] } = {}) {
  let nextTabId = 100;
  const tabs = new Map(existingTabs.map((t) => [t.id, t]));
  const sessionStore = { ...sessionData };
  const localStore = {};
  const messageListeners = [];
  const removedListeners = [];
  const broadcasts = [];

  const chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => `chrome-extension://test/${p}`,
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      },
      sendMessage: (msg, cb) => { if (cb) cb({ success: true }); }
    },
    action: { onClicked: { addListener: () => {} } },
    alarms: {
      create: () => {},
      onAlarm: { addListener: () => {} }
    },
    storage: {
      session: {
        get: (keys, cb) => cb({ ...sessionStore }),
        set: (obj, cb) => { Object.assign(sessionStore, obj); if (cb) cb(); }
      },
      local: {
        get: (keys, cb) => cb({ ...localStore }),
        set: (obj, cb) => { Object.assign(localStore, obj); if (cb) cb(); },
        remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete localStore[k]); if (cb) cb(); }
      }
    },
    tabs: {
      onRemoved: { addListener: (fn) => removedListeners.push(fn) },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      onActivated: { addListener: () => {}, removeListener: () => {} },
      create: (opts, cb) => {
        const tab = { id: nextTabId++, url: opts.url, status: 'complete' };
        tabs.set(tab.id, tab);
        chrome.runtime.lastError = null;
        if (cb) cb(tab);
      },
      get: (tabId, cb) => {
        if (tabs.has(tabId)) {
          chrome.runtime.lastError = null;
          cb(tabs.get(tabId));
        } else {
          chrome.runtime.lastError = { message: 'No tab with id' };
          cb(undefined);
          chrome.runtime.lastError = null;
        }
      },
      query: (q, cb) => {
        chrome.runtime.lastError = null;
        const url = q && q.url;
        const results = [...tabs.values()].filter((t) =>
          !url || (typeof url === 'string' && t.url && t.url.startsWith(url.replace(/\*$/, ''))));
        cb(results);
      },
      remove: (tabId, cb) => {
        tabs.delete(tabId);
        chrome.runtime.lastError = null;
        if (cb) cb();
        removedListeners.forEach((fn) => fn(tabId));
      },
      update: (tabId, opts, cb) => { chrome.runtime.lastError = null; if (cb) cb(tabs.get(tabId)); },
      move: (tabId, opts, cb) => { chrome.runtime.lastError = null; if (cb) cb(); },
      sendMessage: (tabId, msg, cb) => {
        broadcasts.push({ tabId, msg });
        chrome.runtime.lastError = null;
        if (cb) cb();
      }
    },
    scripting: { executeScript: (opts, cb) => { if (cb) cb([]); } },
    downloads: { download: (opts, cb) => { if (cb) cb(1); } }
  };

  return {
    chrome,
    tabs,
    sessionStore,
    broadcasts,
    removedListeners,
    // Dispatch a message to the background listener; returns the sendResponse payload.
    dispatch(message) {
      return new Promise((resolve) => {
        let responded = false;
        messageListeners.forEach((fn) => {
          fn(message, { tab: null }, (response) => {
            responded = true;
            resolve(response);
          });
        });
        // Sync handlers that never call sendResponse.
        setTimeout(() => { if (!responded) resolve(undefined); }, 20);
      });
    }
  };
}

function loadBackground(fake) {
  jest.resetModules();
  global.chrome = fake.chrome;
  jest.isolateModules(() => {
    require('../background.js');
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('sync lifecycle state machine', () => {
  test('PING responds and initial state is not syncing', async () => {
    const fake = createFakeChrome();
    loadBackground(fake);

    expect(await fake.dispatch({ action: 'PING' })).toEqual({ success: true });
    expect(await fake.dispatch({ action: 'GET_SYNC_STATE' })).toEqual({ syncing: false });
  });

  test('starting a background sync sets state and persists it', async () => {
    const fake = createFakeChrome();
    loadBackground(fake);

    await fake.dispatch({ action: 'SYNC_WITH_INSTAGRAM_BACKGROUND' });
    await flush();

    expect(await fake.dispatch({ action: 'GET_SYNC_STATE' })).toEqual({ syncing: true });
    const persisted = fake.sessionStore.nostalgia_sw_sync_state;
    expect(persisted.syncInProgress).toBe(true);
    expect(typeof persisted.activeInstagramTabId).toBe('number');
  });

  test('a second concurrent sync request does not open a second tab', async () => {
    const fake = createFakeChrome();
    loadBackground(fake);

    await fake.dispatch({ action: 'SYNC_WITH_INSTAGRAM_BACKGROUND' });
    await flush();
    const tabCountAfterFirst = fake.tabs.size;

    await fake.dispatch({ action: 'SYNC_WITH_INSTAGRAM_BACKGROUND' });
    await flush();

    expect(fake.tabs.size).toBe(tabCountAfterFirst);
  });

  test('SYNC_FINISHED clears the syncing state and persists the clear', async () => {
    const fake = createFakeChrome();
    loadBackground(fake);

    await fake.dispatch({ action: 'SYNC_WITH_INSTAGRAM_BACKGROUND' });
    await flush();
    await fake.dispatch({ action: 'SYNC_FINISHED', syncedCount: 10, failedCount: 0 });
    await flush();

    expect(await fake.dispatch({ action: 'GET_SYNC_STATE' })).toEqual({ syncing: false });
    expect(fake.sessionStore.nostalgia_sw_sync_state.syncInProgress).toBe(false);
  });

  test('closing the sync tab clears the syncing state (crash safety)', async () => {
    const fake = createFakeChrome();
    loadBackground(fake);

    await fake.dispatch({ action: 'SYNC_WITH_INSTAGRAM_BACKGROUND' });
    await flush();
    const tabId = fake.sessionStore.nostalgia_sw_sync_state.activeInstagramTabId;

    fake.chrome.tabs.remove(tabId);
    await flush();

    expect(await fake.dispatch({ action: 'GET_SYNC_STATE' })).toEqual({ syncing: false });
  });

  test('a restarted worker rehydrates a running sync from storage.session', async () => {
    const tab = { id: 555, url: 'https://www.instagram.com/', status: 'complete' };
    const fake = createFakeChrome({
      sessionData: {
        nostalgia_sw_sync_state: { syncInProgress: true, activeInstagramTabId: 555 }
      },
      existingTabs: [tab]
    });
    loadBackground(fake);
    await flush();

    expect(await fake.dispatch({ action: 'GET_SYNC_STATE' })).toEqual({ syncing: true });
  });

  test('rehydration discards state whose tab no longer exists', async () => {
    const fake = createFakeChrome({
      sessionData: {
        nostalgia_sw_sync_state: { syncInProgress: true, activeInstagramTabId: 999 }
      }
    });
    loadBackground(fake);
    await flush();

    expect(await fake.dispatch({ action: 'GET_SYNC_STATE' })).toEqual({ syncing: false });
  });

  test('IMPORT_FAILED clears syncing state so the next sync can start', async () => {
    const fake = createFakeChrome();
    loadBackground(fake);

    await fake.dispatch({ action: 'SYNC_WITH_INSTAGRAM_BACKGROUND' });
    await flush();
    await fake.dispatch({ action: 'IMPORT_FAILED', error: 'boom' });
    await flush();

    expect(await fake.dispatch({ action: 'GET_SYNC_STATE' })).toEqual({ syncing: false });

    // And a fresh sync is allowed to start again afterwards.
    await fake.dispatch({ action: 'SYNC_WITH_INSTAGRAM_BACKGROUND' });
    await flush();
    expect(await fake.dispatch({ action: 'GET_SYNC_STATE' })).toEqual({ syncing: true });
  });
});
