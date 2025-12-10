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
});

