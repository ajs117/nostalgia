/**
 * Unit tests for background.js functions
 */

describe('Background script utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('hashtag extraction from posts', () => {
    const extractHashtags = (text) => {
      if (!text || typeof text !== 'string') return [];
      const hashtagRegex = /#[\w]+/g;
      const matches = text.match(hashtagRegex);
      return matches ? matches.map(tag => tag.toLowerCase()) : [];
    };

    const posts = [
      { title: 'Post 1 #photo #test' },
      { title: 'Post 2 #instagram' },
      { title: 'Post 3' },
      { title: null }
    ];

    const hashtagCounts = new Map();
    posts.forEach(post => {
      const caption = post.title || '';
      extractHashtags(caption).forEach(tag => {
        hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
      });
    });

    expect(hashtagCounts.get('#photo')).toBe(1);
    expect(hashtagCounts.get('#test')).toBe(1);
    expect(hashtagCounts.get('#instagram')).toBe(1);
  });

  test('post filtering logic', () => {
    const matchesFilters = (post, filterType, searchQuery, hashtagFilter) => {
      // Apply type filter
      if (filterType === 'photo' && post.isVideo) return false;
      if (filterType === 'video' && !post.isVideo) return false;

      // Apply search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const titleMatch = (post.title || '').toLowerCase().includes(searchLower);
        const usernameMatch = (post.username || '').toLowerCase().includes(searchLower);
        if (!titleMatch && !usernameMatch) return false;
      }

      // Apply hashtag filter
      if (hashtagFilter) {
        const extractHashtags = (text) => {
          if (!text || typeof text !== 'string') return [];
          const hashtagRegex = /#[\w]+/g;
          const matches = text.match(hashtagRegex);
          return matches ? matches.map(tag => tag.toLowerCase()) : [];
        };
        const caption = post.title || '';
        const hashtags = extractHashtags(caption);
        if (!hashtags.includes(hashtagFilter.toLowerCase())) return false;
      }

      return true;
    };

    const post1 = { title: 'Test post #photo', username: 'user1', isVideo: false };
    const post2 = { title: 'Video post', username: 'user2', isVideo: true };
    const post3 = { title: 'Another #photo post', username: 'user3', isVideo: false };

    expect(matchesFilters(post1, 'all', '', null)).toBe(true);
    expect(matchesFilters(post1, 'photo', '', null)).toBe(true);
    expect(matchesFilters(post2, 'photo', '', null)).toBe(false);
    expect(matchesFilters(post2, 'video', '', null)).toBe(true);
    expect(matchesFilters(post1, 'all', 'test', null)).toBe(true);
    expect(matchesFilters(post2, 'all', 'test', null)).toBe(false);
    expect(matchesFilters(post1, 'all', '', '#photo')).toBe(true);
    expect(matchesFilters(post2, 'all', '', '#photo')).toBe(false);
    expect(matchesFilters(post3, 'all', '', '#photo')).toBe(true);
  });

  test('post filtering with combined filters', () => {
    const matchesFilters = (post, filterType, searchQuery, hashtagFilter) => {
      // Apply type filter
      if (filterType === 'photo' && post.isVideo) return false;
      if (filterType === 'video' && !post.isVideo) return false;

      // Apply search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const titleMatch = (post.title || '').toLowerCase().includes(searchLower);
        const usernameMatch = (post.username || '').toLowerCase().includes(searchLower);
        if (!titleMatch && !usernameMatch) return false;
      }

      // Apply hashtag filter
      if (hashtagFilter) {
        const extractHashtags = (text) => {
          if (!text || typeof text !== 'string') return [];
          const hashtagRegex = /#[\w]+/g;
          const matches = text.match(hashtagRegex);
          return matches ? matches.map(tag => tag.toLowerCase()) : [];
        };
        const caption = post.title || '';
        const hashtags = extractHashtags(caption);
        if (!hashtags.includes(hashtagFilter.toLowerCase())) return false;
      }

      return true;
    };

    const post1 = { title: 'Test post #photo', username: 'testuser', isVideo: false };
    const post2 = { title: 'Video post #photo', username: 'user2', isVideo: true };
    const post3 = { title: 'Another #photo post', username: 'testuser', isVideo: false };

    // Combined search and hashtag
    expect(matchesFilters(post1, 'all', 'test', '#photo')).toBe(true);
    expect(matchesFilters(post2, 'all', 'test', '#photo')).toBe(false);
    expect(matchesFilters(post3, 'all', 'test', '#photo')).toBe(true);

    // Combined type and search
    expect(matchesFilters(post1, 'photo', 'test', null)).toBe(true);
    expect(matchesFilters(post2, 'photo', 'test', null)).toBe(false);
  });

  test('hashtag counting with duplicates', () => {
    const extractHashtags = (text) => {
      if (!text || typeof text !== 'string') return [];
      const hashtagRegex = /#[\w]+/g;
      const matches = text.match(hashtagRegex);
      return matches ? matches.map(tag => tag.toLowerCase()) : [];
    };

    const posts = [
      { title: 'Post 1 #photo #test' },
      { title: 'Post 2 #photo #instagram' },
      { title: 'Post 3 #photo' },
      { title: 'Post 4 #test' }
    ];

    const hashtagCounts = new Map();
    posts.forEach(post => {
      const caption = post.title || '';
      extractHashtags(caption).forEach(tag => {
        hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
      });
    });

    expect(hashtagCounts.get('#photo')).toBe(3);
    expect(hashtagCounts.get('#test')).toBe(2);
    expect(hashtagCounts.get('#instagram')).toBe(1);
  });

  test('filtering handles empty/null values', () => {
    const matchesFilters = (post, filterType, searchQuery, hashtagFilter) => {
      // Apply type filter
      if (filterType === 'photo' && post.isVideo) return false;
      if (filterType === 'video' && !post.isVideo) return false;

      // Apply search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const titleMatch = (post.title || '').toLowerCase().includes(searchLower);
        const usernameMatch = (post.username || '').toLowerCase().includes(searchLower);
        if (!titleMatch && !usernameMatch) return false;
      }

      // Apply hashtag filter
      if (hashtagFilter) {
        const extractHashtags = (text) => {
          if (!text || typeof text !== 'string') return [];
          const hashtagRegex = /#[\w]+/g;
          const matches = text.match(hashtagRegex);
          return matches ? matches.map(tag => tag.toLowerCase()) : [];
        };
        const caption = post.title || '';
        const hashtags = extractHashtags(caption);
        if (!hashtags.includes(hashtagFilter.toLowerCase())) return false;
      }

      return true;
    };

    const post1 = { title: null, username: null, isVideo: false };
    const post2 = { title: '', username: '', isVideo: true };
    const post3 = { title: 'Valid post', username: 'user', isVideo: false };

    expect(matchesFilters(post1, 'all', '', null)).toBe(true);
    expect(matchesFilters(post2, 'all', '', null)).toBe(true);
    expect(matchesFilters(post3, 'all', '', null)).toBe(true);
    expect(matchesFilters(post1, 'all', 'test', null)).toBe(false);
    expect(matchesFilters(post2, 'all', 'test', null)).toBe(false);
  });

  test('case insensitive search filtering', () => {
    const matchesFilters = (post, filterType, searchQuery, hashtagFilter) => {
      // Apply type filter
      if (filterType === 'photo' && post.isVideo) return false;
      if (filterType === 'video' && !post.isVideo) return false;

      // Apply search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const titleMatch = (post.title || '').toLowerCase().includes(searchLower);
        const usernameMatch = (post.username || '').toLowerCase().includes(searchLower);
        if (!titleMatch && !usernameMatch) return false;
      }

      // Apply hashtag filter
      if (hashtagFilter) {
        const extractHashtags = (text) => {
          if (!text || typeof text !== 'string') return [];
          const hashtagRegex = /#[\w]+/g;
          const matches = text.match(hashtagRegex);
          return matches ? matches.map(tag => tag.toLowerCase()) : [];
        };
        const caption = post.title || '';
        const hashtags = extractHashtags(caption);
        if (!hashtags.includes(hashtagFilter.toLowerCase())) return false;
      }

      return true;
    };

    const post1 = { title: 'TEST POST', username: 'UserName', isVideo: false };
    const post2 = { title: 'Test Post', username: 'username', isVideo: false };

    expect(matchesFilters(post1, 'all', 'test', null)).toBe(true);
    expect(matchesFilters(post1, 'all', 'TEST', null)).toBe(true);
    expect(matchesFilters(post1, 'all', 'Test', null)).toBe(true);
    expect(matchesFilters(post2, 'all', 'user', null)).toBe(true);
    expect(matchesFilters(post2, 'all', 'USER', null)).toBe(true);
  });

  describe('paginated sort: lightweight projection + page re-fetch', () => {
    // Mirrors the memory-optimized path in getPostsPaginated: instead of buffering
    // every matched full record (with its base64 thumbnail) to sort, it buffers a
    // lightweight projection, sorts that, then re-fetches the page's full records
    // by primary key. These tests lock in the invariant that the optimized path
    // returns the same page (and order) as sorting full records directly.

    const stableHashString = (value) => {
      let hash = 2166136261;
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return hash >>> 0;
    };

    const comparePostsForStableRandom = (a, b, randomSeed) => {
      const seed = Number.isFinite(randomSeed) ? Math.trunc(randomSeed) : 0;
      const aIdentity = a.id || a.link || a.username || a.title || '';
      const bIdentity = b.id || b.link || b.username || b.title || '';
      const aWeight = stableHashString(`${seed}:${aIdentity}`);
      const bWeight = stableHashString(`${seed}:${bIdentity}`);
      if (aWeight !== bWeight) return aWeight - bWeight;
      const fallbackA = `${aIdentity}:${a.timestamp || 0}`;
      const fallbackB = `${bIdentity}:${b.timestamp || 0}`;
      return fallbackA.localeCompare(fallbackB);
    };

    const sortFor = (mode, randomSeed) => (a, b) => {
      if (mode === 'alphabetical') {
        const ua = (a.username || '').toLowerCase();
        const ub = (b.username || '').toLowerCase();
        if (ua !== ub) return ua.localeCompare(ub);
        return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
      }
      if (mode === 'random') return comparePostsForStableRandom(a, b, randomSeed);
      return (b.timestamp || 0) - (a.timestamp || 0);
    };

    const project = (post) => ({
      id: post.id,
      link: post.link,
      username: post.username,
      title: post.title,
      timestamp: post.timestamp
    });

    // Optimized implementation under test (pure, store modeled as a Map).
    const paginateOptimized = (posts, mode, page, limit, randomSeed) => {
      const store = new Map(posts.map((p) => [p.id, p]));
      const projections = posts.map(project);
      projections.sort(sortFor(mode, randomSeed));
      const targetStart = (page - 1) * limit;
      const pageKeys = projections.slice(targetStart, targetStart + limit).map((e) => e.id);
      return {
        posts: pageKeys.map((k) => store.get(k)).filter(Boolean),
        total: projections.length,
        hasMore: projections.length > targetStart + limit
      };
    };

    // Reference: sort the full records directly.
    const paginateReference = (posts, mode, page, limit, randomSeed) => {
      const sorted = [...posts].sort(sortFor(mode, randomSeed));
      const targetStart = (page - 1) * limit;
      return {
        posts: sorted.slice(targetStart, targetStart + limit),
        total: sorted.length,
        hasMore: sorted.length > targetStart + limit
      };
    };

    const makePosts = (n) =>
      Array.from({ length: n }, (_, i) => ({
        id: `id-${i}`,
        link: `https://www.instagram.com/p/code${i}/`,
        username: `user${(n - i) % 7}`,
        title: `Caption ${i} #tag${i % 3}`,
        timestamp: 1000 + ((i * 37) % n),
        thumbnail: 'data:image/jpeg;base64,'.padEnd(2000, 'A') // simulate large blob
      }));

    test.each(['alphabetical', 'random', 'default'])(
      'optimized page matches reference for %s sort across pages',
      (mode) => {
        const posts = makePosts(53);
        const limit = 20;
        const seed = 12345;
        for (let pageNum = 1; pageNum <= 3; pageNum++) {
          const opt = paginateOptimized(posts, mode, pageNum, limit, seed);
          const ref = paginateReference(posts, mode, pageNum, limit, seed);
          expect(opt.total).toBe(ref.total);
          expect(opt.hasMore).toBe(ref.hasMore);
          expect(opt.posts.map((p) => p.id)).toEqual(ref.posts.map((p) => p.id));
          // Re-fetched records are the full objects (thumbnail intact).
          opt.posts.forEach((p) => expect(p.thumbnail).toBeTruthy());
        }
      }
    );

    test('page beyond the end returns empty', () => {
      const posts = makePosts(10);
      const opt = paginateOptimized(posts, 'default', 5, 20, 0);
      expect(opt.posts).toEqual([]);
      expect(opt.total).toBe(10);
      expect(opt.hasMore).toBe(false);
    });

    test('projection drops the thumbnail before sorting', () => {
      const [post] = makePosts(1);
      expect(project(post)).not.toHaveProperty('thumbnail');
    });
  });

  describe('sanitizeDownloadFilename', () => {
    // Mirrors background.js sanitizeDownloadFilename: keeps '/' for subfolders
    // but neutralizes path traversal and illegal filename characters.
    const sanitizeDownloadFilename = (filename) => {
      const sanitizeSegment = (segment) =>
        Array.from(segment, (character) => {
          const codePoint = character.charCodeAt(0);
          if ('<>:"\\|?*'.includes(character) || codePoint < 32) {
            return '-';
          }
          return character;
        })
          .join('')
          .replace(/\s+/g, ' ')
          .trim();

      const segments = String(filename || 'nostalgia-media')
        .split('/')
        .map(sanitizeSegment)
        .filter((segment) => segment && segment !== '.' && segment !== '..');

      return segments.join('/').slice(0, 200) || 'nostalgia-media';
    };

    test('preserves an intended subfolder', () => {
      expect(sanitizeDownloadFilename('nostalgia/user-abc123.jpg')).toBe('nostalgia/user-abc123.jpg');
    });

    test('strips path traversal segments', () => {
      expect(sanitizeDownloadFilename('../../etc/passwd')).toBe('etc/passwd');
      expect(sanitizeDownloadFilename('nostalgia/../../secret.mp4')).toBe('nostalgia/secret.mp4');
    });

    test('removes leading slashes (no absolute paths)', () => {
      expect(sanitizeDownloadFilename('/nostalgia/x.jpg')).toBe('nostalgia/x.jpg');
    });

    test('replaces illegal filename characters within a segment', () => {
      expect(sanitizeDownloadFilename('nostalgia/a<b>:c?.jpg')).toBe('nostalgia/a-b--c-.jpg');
    });

    test('falls back when everything is stripped', () => {
      expect(sanitizeDownloadFilename('////')).toBe('nostalgia-media');
      expect(sanitizeDownloadFilename('')).toBe('nostalgia-media');
    });
  });
});

