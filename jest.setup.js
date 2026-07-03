// Mock Chrome APIs for testing
global.chrome = {
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      if (callback) callback({ success: true });
    }),
    onMessage: {
      addListener: jest.fn()
    },
    getURL: jest.fn((path) => `chrome-extension://test/${path}`),
    lastError: null
  },
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        if (callback) callback({});
      }),
      set: jest.fn((data, callback) => {
        if (callback) callback();
      }),
      remove: jest.fn((keys, callback) => {
        if (callback) callback();
      }),
      clear: jest.fn((callback) => {
        if (callback) callback();
      })
    }
  },
  tabs: {
    query: jest.fn((query, callback) => {
      if (callback) callback([]);
    }),
    create: jest.fn((options, callback) => {
      if (callback) callback({ id: 1 });
    }),
    update: jest.fn((tabId, options, callback) => {
      if (callback) callback();
    }),
    sendMessage: jest.fn((tabId, message, callback) => {
      if (callback) callback();
    }),
    remove: jest.fn((tabId, callback) => {
      if (callback) callback();
    })
  },
  action: {
    onClicked: {
      addListener: jest.fn()
    }
  }
};

// Mock IndexedDB
global.indexedDB = {
  open: jest.fn(() => ({
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    result: {
      createObjectStore: jest.fn(),
      transaction: jest.fn()
    }
  }))
};

// Mock DOM APIs
global.document = {
  createElement: jest.fn((tag) => ({
    tagName: tag.toUpperCase(),
    style: {},
    addEventListener: jest.fn(),
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    querySelector: jest.fn(),
    querySelectorAll: jest.fn(() => []),
    getElementById: jest.fn(),
    body: {
      appendChild: jest.fn(),
      style: {}
    },
    head: {
      appendChild: jest.fn()
    }
  })),
  getElementById: jest.fn(() => ({
    innerHTML: '',
    textContent: '',
    style: {},
    addEventListener: jest.fn(),
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    querySelector: jest.fn(),
    querySelectorAll: jest.fn(() => [])
  })),
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(() => []),
  body: {
    appendChild: jest.fn(),
    style: {}
  },
  head: {
    appendChild: jest.fn()
  }
};

global.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  location: {
    hostname: 'www.instagram.com'
  }
};

global.URL = {
  createObjectURL: jest.fn(() => 'blob:test-url'),
  revokeObjectURL: jest.fn()
};

global.fetch = jest.fn(() => Promise.resolve({
  ok: true,
  status: 200,
  json: () => Promise.resolve({}),
  blob: () => Promise.resolve(new Blob())
}));

global.Blob = jest.fn((parts, options) => ({
  size: 0,
  type: options?.type || 'application/octet-stream'
}));

global.FileReader = jest.fn(() => ({
  readAsDataURL: jest.fn(),
  onloadend: null,
  onerror: null,
  result: null
}));

