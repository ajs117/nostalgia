/**
 * Collection / account filter predicate + facet aggregation.
 *
 * Mirrors the logic in background.js getPostsPaginated()/getLibraryFacets() so
 * the filtering rules are pinned without needing a live IndexedDB.
 */

// Mirrors matchesFilters() in getPostsPaginated for the new dimensions.
function matchesFilters(post, { filterType = 'all', searchQuery = '', collectionFilter = null, authorFilter = null } = {}) {
  if (filterType === 'photo' && post.isVideo) return false;
  if (filterType === 'video' && !post.isVideo) return false;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    const titleMatch = (post.title || '').toLowerCase().includes(q);
    const userMatch = (post.username || '').toLowerCase().includes(q);
    if (!titleMatch && !userMatch) return false;
  }

  if (collectionFilter) {
    const ids = Array.isArray(post.collectionIds) ? post.collectionIds.map(String) : [];
    if (!ids.includes(String(collectionFilter))) return false;
  }

  if (authorFilter) {
    if ((post.username || '').toLowerCase() !== String(authorFilter).toLowerCase()) return false;
  }

  return true;
}

const POSTS = [
  { id: '1', username: 'alice', title: 'beach', isVideo: false, collectionIds: ['10', '20'] },
  { id: '2', username: 'Bob', title: 'sunset reel', isVideo: true, collectionIds: ['20'] },
  { id: '3', username: 'alice', title: 'food', isVideo: false, collectionIds: [] },
  { id: '4', username: 'carol', title: 'dogs', isVideo: true },
  { id: '5', username: 'alice', title: 'cats', isVideo: false, collectionIds: [30] }
];

describe('collection filter', () => {
  test('keeps only posts in the given collection', () => {
    const got = POSTS.filter((p) => matchesFilters(p, { collectionFilter: '20' })).map((p) => p.id);
    expect(got).toEqual(['1', '2']);
  });

  test('matches numeric collection ids stored as numbers', () => {
    const got = POSTS.filter((p) => matchesFilters(p, { collectionFilter: 30 })).map((p) => p.id);
    expect(got).toEqual(['5']);
  });

  test('excludes posts with missing or empty collectionIds', () => {
    expect(matchesFilters(POSTS[2], { collectionFilter: '20' })).toBe(false);
    expect(matchesFilters(POSTS[3], { collectionFilter: '20' })).toBe(false);
  });

  test('no filter keeps everything', () => {
    expect(POSTS.every((p) => matchesFilters(p, {}))).toBe(true);
  });
});

describe('author filter', () => {
  test('matches exactly, case-insensitively', () => {
    expect(POSTS.filter((p) => matchesFilters(p, { authorFilter: 'alice' })).map((p) => p.id))
      .toEqual(['1', '3', '5']);
    expect(POSTS.filter((p) => matchesFilters(p, { authorFilter: 'bob' })).map((p) => p.id))
      .toEqual(['2']);
  });

  test('does not substring-match (unlike search)', () => {
    // "ali" should match nothing as an author filter, but does as a search.
    expect(POSTS.filter((p) => matchesFilters(p, { authorFilter: 'ali' }))).toHaveLength(0);
    expect(POSTS.filter((p) => matchesFilters(p, { searchQuery: 'ali' })).length).toBeGreaterThan(0);
  });
});

describe('combined filters', () => {
  test('collection AND author AND type all apply', () => {
    const got = POSTS.filter((p) => matchesFilters(p, {
      collectionFilter: '20', authorFilter: 'alice', filterType: 'photo'
    })).map((p) => p.id);
    expect(got).toEqual(['1']);
  });

  test('contradictory filters yield nothing', () => {
    const got = POSTS.filter((p) => matchesFilters(p, { collectionFilter: '10', authorFilter: 'carol' }));
    expect(got).toHaveLength(0);
  });
});

describe('multi-select survives paging/filtering', () => {
  // Mirrors the selectedPosts Map in app.js. The earlier Set-of-ids version
  // resolved the selection against the CURRENT page, so posts scrolled off the
  // page were counted in the toolbar but silently skipped by bulk actions.
  function makeSelection() {
    const selected = new Map();
    return {
      toggle(post) {
        if (selected.has(post.id)) selected.delete(post.id);
        else selected.set(post.id, post);
      },
      selectAll(posts) {
        posts.forEach((p) => { if (p && p.id) selected.set(p.id, p); });
      },
      clear: () => selected.clear(),
      count: () => selected.size,
      getSelected: () => Array.from(selected.values())
    };
  }

  test('selection made on one page is still actionable after the page changes', () => {
    const sel = makeSelection();
    const page1 = POSTS.slice(0, 2);
    const page2 = POSTS.slice(2);

    sel.selectAll(page1);
    expect(sel.count()).toBe(2);

    // Navigate to page 2: displayed posts change entirely.
    void page2;
    // Count and actionable set must still agree.
    expect(sel.getSelected()).toHaveLength(2);
    expect(sel.getSelected().map((p) => p.id)).toEqual(['1', '2']);
  });

  test('selecting across pages accumulates', () => {
    const sel = makeSelection();
    sel.selectAll(POSTS.slice(0, 2));
    sel.selectAll(POSTS.slice(2, 4));
    expect(sel.count()).toBe(4);
    expect(sel.getSelected().map((p) => p.id)).toEqual(['1', '2', '3', '4']);
  });

  test('toolbar count always equals the number of actionable posts', () => {
    const sel = makeSelection();
    sel.selectAll(POSTS);
    expect(sel.count()).toBe(sel.getSelected().length);
    sel.toggle(POSTS[0]);
    expect(sel.count()).toBe(sel.getSelected().length);
  });

  test('toggle removes a previously selected post', () => {
    const sel = makeSelection();
    sel.toggle(POSTS[0]);
    expect(sel.count()).toBe(1);
    sel.toggle(POSTS[0]);
    expect(sel.count()).toBe(0);
  });
});

describe('facet aggregation', () => {
  // Mirrors the counting loop in getLibraryFacets().
  function aggregate(posts) {
    const authorCounts = new Map();
    const collectionCounts = new Map();
    let videos = 0;
    posts.forEach((post) => {
      if (post.isVideo) videos++;
      const u = post.username || '';
      if (u) authorCounts.set(u, (authorCounts.get(u) || 0) + 1);
      if (Array.isArray(post.collectionIds)) {
        post.collectionIds.forEach((id) => {
          const key = String(id);
          collectionCounts.set(key, (collectionCounts.get(key) || 0) + 1);
        });
      }
    });
    const authors = [...authorCounts.entries()]
      .map(([username, count]) => ({ username, count }))
      .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
    return { authors, collectionCounts, videos, photos: posts.length - videos };
  }

  test('counts authors and sorts by frequency', () => {
    const { authors } = aggregate(POSTS);
    expect(authors[0]).toEqual({ username: 'alice', count: 3 });
    expect(authors.map((a) => a.username)).toEqual(['alice', 'Bob', 'carol']);
  });

  test('counts posts per collection, including multi-collection posts', () => {
    const { collectionCounts } = aggregate(POSTS);
    expect(collectionCounts.get('20')).toBe(2);
    expect(collectionCounts.get('10')).toBe(1);
    expect(collectionCounts.get('30')).toBe(1);
  });

  test('splits photos and videos', () => {
    const { photos, videos } = aggregate(POSTS);
    expect(videos).toBe(2);
    expect(photos).toBe(3);
    expect(photos + videos).toBe(POSTS.length);
  });
});
