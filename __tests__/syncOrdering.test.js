/**
 * Unit tests for the pure saved-order helpers in syncOrdering.js.
 * These lock in the invariants that the two-phase sync engine relies on
 * (validated without a live Instagram session).
 */
const {
  assignTopOrders,
  assignBackfillOrders,
  collectLeadingUnknown,
  decideSyncPhase
} = require('../syncOrdering');

const post = (id) => ({ id });

describe('assignTopOrders (new saves go above max, newest highest)', () => {
  test('newest-first input → strictly decreasing savedOrder, newest highest, all > max', () => {
    const items = [post('n0'), post('n1'), post('n2')]; // n0 = most recently saved
    const out = assignTopOrders(items, 100);
    const orders = out.map((o) => o.savedOrder);

    expect(orders).toEqual([103, 102, 101]);
    expect(orders.every((v) => v > 100)).toBe(true);
    // newest (n0) has the highest value
    expect(out[0].post.id).toBe('n0');
    expect(out[0].savedOrder).toBe(Math.max(...orders));
    // strictly decreasing → no inversion across the batch
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeLessThan(orders[i - 1]);
    }
  });

  test('empty input → empty output', () => {
    expect(assignTopOrders([], 5)).toEqual([]);
  });

  test('non-finite max defaults to 0', () => {
    expect(assignTopOrders([post('a')], null)[0].savedOrder).toBe(1);
  });
});

describe('assignBackfillOrders (history goes below min, newest-of-batch highest)', () => {
  test('descends below min, newest-of-batch highest', () => {
    const items = [post('a'), post('b'), post('c')];
    const out = assignBackfillOrders(items, 0);
    expect(out.map((o) => o.savedOrder)).toEqual([-1, -2, -3]);
    expect(out.every((o) => o.savedOrder < 0)).toBe(true);
  });

  test('chains across batches without collision when min is advanced by caller', () => {
    const page1 = [post('a'), post('b')];
    const out1 = assignBackfillOrders(page1, 0);
    let min = 0 - out1.length; // caller advances min by batch length
    const page2 = [post('c'), post('d')];
    const out2 = assignBackfillOrders(page2, min);

    const all = [...out1, ...out2].map((o) => o.savedOrder);
    // strictly decreasing across both pages (a > b > c > d)
    for (let i = 1; i < all.length; i++) {
      expect(all[i]).toBeLessThan(all[i - 1]);
    }
    // no duplicates
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('global descending order reproduces the saved feed', () => {
  test('a fresh full backfill yields newest-saved-first when sorted descending', () => {
    // Simulate 3 pages of the feed, newest first overall.
    const feedNewestFirst = ['s0', 's1', 's2', 's3', 's4'].map(post);
    const pages = [feedNewestFirst.slice(0, 2), feedNewestFirst.slice(2, 4), feedNewestFirst.slice(4)];

    const assigned = [];
    let min = 0;
    for (const pageItems of pages) {
      const out = assignBackfillOrders(pageItems, min);
      min -= out.length;
      assigned.push(...out);
    }

    const sortedDesc = [...assigned].sort((a, b) => b.savedOrder - a.savedOrder);
    expect(sortedDesc.map((o) => o.post.id)).toEqual(feedNewestFirst.map((p) => p.id));
  });

  test('incremental new saves land above an existing backfilled set', () => {
    // Existing DB: 3 historical posts at -1,-2,-3 (min = -3, max = -1).
    const existingMax = -1;
    const newSaves = [post('new0'), post('new1')]; // saved since last sync, newest first
    const top = assignTopOrders(newSaves, existingMax);

    const all = [
      { post: post('h0'), savedOrder: -1 },
      { post: post('h1'), savedOrder: -2 },
      { post: post('h2'), savedOrder: -3 },
      ...top
    ];
    const sortedDesc = [...all].sort((a, b) => b.savedOrder - a.savedOrder);
    // newest phone-save first, then the older new save, then history
    expect(sortedDesc.map((o) => o.post.id)).toEqual(['new0', 'new1', 'h0', 'h1', 'h2']);
  });
});

describe('collectLeadingUnknown', () => {
  test('collects the leading run of unknown posts and stops at first known', () => {
    const items = [post('a'), post('b'), post('c'), post('d')];
    const exists = [false, false, true, false];
    const { newOnes, reachedKnown } = collectLeadingUnknown(items, exists);
    expect(newOnes.map((p) => p.id)).toEqual(['a', 'b']);
    expect(reachedKnown).toBe(true);
  });

  test('all unknown → reachedKnown false, everything collected', () => {
    const items = [post('a'), post('b')];
    const { newOnes, reachedKnown } = collectLeadingUnknown(items, [false, false]);
    expect(newOnes).toHaveLength(2);
    expect(reachedKnown).toBe(false);
  });

  test('first post known → nothing collected', () => {
    const items = [post('a'), post('b')];
    const { newOnes, reachedKnown } = collectLeadingUnknown(items, [true, false]);
    expect(newOnes).toEqual([]);
    expect(reachedKnown).toBe(true);
  });
});

describe('decideSyncPhase', () => {
  test('empty DB → backfill only', () => {
    expect(decideSyncPhase({ dbEmpty: true, backfillComplete: false })).toEqual({
      runTop: false,
      runBackfill: true
    });
  });

  test('non-empty DB, backfill incomplete → both phases', () => {
    expect(decideSyncPhase({ dbEmpty: false, backfillComplete: false })).toEqual({
      runTop: true,
      runBackfill: true
    });
  });

  test('non-empty DB, backfill complete → top only (fast re-sync)', () => {
    expect(decideSyncPhase({ dbEmpty: false, backfillComplete: true })).toEqual({
      runTop: true,
      runBackfill: false
    });
  });
});
