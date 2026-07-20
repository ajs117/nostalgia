/**
 * End-to-end tests for the content-script action handlers (bump-to-top and
 * add-to-nostalgia-collection). Loads the REAL contentScript.js with a fake
 * chrome + fetch and drives its onMessage listener, verifying the exact
 * Instagram endpoints, credentials, CSRF header, and response shape.
 *
 * This is as close as CI can get to "test it against Instagram": everything
 * except Instagram's server response is real code.
 */

function createFetchMock(routes) {
  const calls = [];
  const fetchMock = jest.fn(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    for (const route of routes) {
      if (String(url).includes(route.match)) {
        if (route.fail) {
          throw new TypeError('Failed to fetch');
        }
        return {
          ok: route.status ? route.status < 400 : true,
          status: route.status || 200,
          json: async () => route.body ?? { status: 'ok' }
        };
      }
    }
    throw new TypeError(`Unmocked fetch: ${url}`);
  });
  return { fetchMock, calls };
}

function loadContentScript() {
  const messageListeners = [];
  global.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      sendMessage: (msg, cb) => { if (cb) cb({ success: true }); },
      getURL: (p) => `chrome-extension://test/${p}`
    },
    storage: {
      local: {
        get: (keys, cb) => cb({}),
        set: (obj, cb) => { if (cb) cb(); },
        remove: (keys, cb) => { if (cb) cb(); }
      }
    }
  };
  // The content script reads the CSRF token from document.cookie.
  document.cookie = 'csrftoken=test-csrf-token';

  jest.isolateModules(() => {
    require('../contentScript.js');
  });

  return {
    dispatch(message) {
      return new Promise((resolve) => {
        let responded = false;
        messageListeners.forEach((fn) => {
          const result = fn(message, {}, (response) => {
            responded = true;
            resolve(response);
          });
          void result;
        });
        setTimeout(() => { if (!responded) resolve(undefined); }, 4500);
      });
    }
  };
}

describe('content script Instagram actions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('CS_PING responds so the background can verify liveness', async () => {
    const { fetchMock } = createFetchMock([]);
    global.fetch = fetchMock;
    const cs = loadContentScript();

    expect(await cs.dispatch({ action: 'CS_PING' })).toEqual({ pong: true });
  });

  test('BUMP_POST_TO_TOP unsaves then saves via same-origin web endpoints with CSRF', async () => {
    const { fetchMock, calls } = createFetchMock([
      { match: '/api/v1/web/save/' }
    ]);
    global.fetch = fetchMock;
    const cs = loadContentScript();

    const response = await cs.dispatch({
      action: 'BUMP_POST_TO_TOP',
      post: { id: '123456789_987654321', link: 'https://www.instagram.com/p/abc/' }
    });

    expect(response).toEqual({ success: true });
    expect(calls).toHaveLength(2);
    // pk only (no _userPk suffix), same-origin www, unsave then save.
    expect(calls[0].url).toBe('https://www.instagram.com/api/v1/web/save/123456789/unsave/');
    expect(calls[1].url).toBe('https://www.instagram.com/api/v1/web/save/123456789/save/');
    calls.forEach(({ options }) => {
      expect(options.method).toBe('POST');
      expect(options.credentials).toBe('include');
      expect(options.headers['x-csrftoken']).toBe('test-csrf-token');
    });
  });

  test('BUMP_POST_TO_TOP falls back to the media endpoint when web/save fails', async () => {
    const { fetchMock, calls } = createFetchMock([
      { match: '/api/v1/web/save/', fail: true },
      { match: '/api/v1/media/' }
    ]);
    global.fetch = fetchMock;
    const cs = loadContentScript();

    const response = await cs.dispatch({
      action: 'BUMP_POST_TO_TOP',
      post: { id: '111_222', link: 'https://www.instagram.com/p/abc/' }
    });

    expect(response).toEqual({ success: true });
    const mediaCalls = calls.filter((c) => c.url.includes('/api/v1/media/'));
    expect(mediaCalls.map((c) => c.url)).toEqual([
      'https://www.instagram.com/api/v1/media/111_222/unsave/',
      'https://www.instagram.com/api/v1/media/111_222/save/'
    ]);
  });

  test('BUMP_POST_TO_TOP surfaces a diagnosable error when every endpoint fails', async () => {
    const { fetchMock } = createFetchMock([
      { match: '/api/v1/web/save/', fail: true },
      { match: '/api/v1/media/', fail: true }
    ]);
    global.fetch = fetchMock;
    const cs = loadContentScript();

    const response = await cs.dispatch({
      action: 'BUMP_POST_TO_TOP',
      post: { id: '111_222', link: 'https://www.instagram.com/p/abc/' }
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/unsave failed .*endpoint.*: Failed to fetch/);
  });

  test('ADD_POST_TO_NOSTALGIA_COLLECTION reuses the existing collection and saves with its id', async () => {
    const { fetchMock, calls } = createFetchMock([
      {
        match: '/api/v1/collections/list/',
        body: {
          items: [{ collection: { collection_id: '777', collection_name: 'nostalgia' } }],
          more_available: false
        }
      },
      { match: '/api/v1/web/save/' }
    ]);
    global.fetch = fetchMock;
    const cs = loadContentScript();

    const response = await cs.dispatch({
      action: 'ADD_POST_TO_NOSTALGIA_COLLECTION',
      post: { id: '333_444', link: 'https://www.instagram.com/p/xyz/' }
    });

    expect(response.success).toBe(true);
    expect(response.collectionId).toBe('777');

    const saveCall = calls.find((c) => c.url.includes('/web/save/'));
    expect(saveCall.url).toBe('https://www.instagram.com/api/v1/web/save/333/save/');
    expect(String(saveCall.options.body)).toContain(encodeURIComponent('["777"]'));
  });

  test('ADD_POST_TO_NOSTALGIA_COLLECTION creates the collection via i.instagram when missing', async () => {
    let created = false;
    const { fetchMock, calls } = createFetchMock([
      {
        // Only i.instagram serves create; www would 404.
        match: '/api/v1/collections/create/'
      },
      {
        match: '/api/v1/collections/list/',
        // First list is empty; after create, list returns the new collection.
        get body() {
          return created
            ? { items: [{ collection: { collection_id: '888', collection_name: 'nostalgia' } }], more_available: false }
            : { items: [], more_available: false };
        }
      },
      { match: '/api/v1/web/save/' }
    ]);
    // Flip `created` once the create endpoint is hit.
    const wrapped = jest.fn(async (url, options) => {
      const result = await fetchMock(url, options);
      if (String(url).includes('/collections/create/')) created = true;
      return result;
    });
    global.fetch = wrapped;
    const cs = loadContentScript();

    const response = await cs.dispatch({
      action: 'ADD_POST_TO_NOSTALGIA_COLLECTION',
      post: { id: '999_111', link: 'https://www.instagram.com/p/qrs/' }
    });

    expect(response.success).toBe(true);
    const createCall = calls.find((c) => c.url.includes('/collections/create/'));
    expect(createCall.url).toBe('https://i.instagram.com/api/v1/collections/create/');
    expect(response.collectionId).toBe('888');
  });
});
