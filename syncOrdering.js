/**
 * Pure helpers for assigning a stable `savedOrder` to Instagram saved posts.
 *
 * Instagram's saved feed is returned newest-saved-first and paginated by
 * `max_id`. We capture that order into a numeric `savedOrder` where
 * "newest saved" === highest value (sorting descending reproduces the feed).
 *
 * The sync runs in two phases:
 *   - TOP: posts saved since the last sync, slotted ABOVE the current max.
 *   - BACKFILL: historical posts, slotted BELOW the current min, resumable.
 *
 * These functions are intentionally pure so they can be unit-tested without a
 * live Instagram session. They are attached to the global (for the content
 * script) and exported via CommonJS (for Jest).
 */
(function attachSyncOrdering(global) {
  /**
   * Assign savedOrder to newly-discovered "top" posts (saved since last sync).
   * `newestFirst` is in API order (index 0 = most recently saved). The newest
   * gets the highest value, contiguous above `max`, with NO inversion across
   * the batch.
   * @param {Array<any>} newestFirst
   * @param {number} max current DB max savedOrder (anchor)
   * @returns {Array<{ post: any, savedOrder: number }>}
   */
  function assignTopOrders(newestFirst, max) {
    const base = Number.isFinite(max) ? max : 0;
    const length = newestFirst.length;
    return newestFirst.map((post, i) => ({ post, savedOrder: base + (length - i) }));
  }

  /**
   * Assign savedOrder to backfilled historical posts. `newestFirst` is API order
   * within the batch; values descend below `min` (newest-of-batch highest).
   * @param {Array<any>} newestFirst
   * @param {number} min current DB min savedOrder (anchor)
   * @returns {Array<{ post: any, savedOrder: number }>}
   */
  function assignBackfillOrders(newestFirst, min) {
    const base = Number.isFinite(min) ? min : 0;
    return newestFirst.map((post, j) => ({ post, savedOrder: base - 1 - j }));
  }

  /**
   * From an API page (newest first) and parallel existence flags, collect the
   * leading run of posts NOT already in the DB, stopping at the first known post.
   * @param {Array<any>} items
   * @param {Array<boolean>} existsFlags
   * @returns {{ newOnes: Array<any>, reachedKnown: boolean }}
   */
  function collectLeadingUnknown(items, existsFlags) {
    const flags = Array.isArray(existsFlags) ? existsFlags : [];
    const newOnes = [];
    let reachedKnown = false;
    for (let i = 0; i < items.length; i++) {
      if (flags[i]) {
        reachedKnown = true;
        break;
      }
      newOnes.push(items[i]);
    }
    return { newOnes, reachedKnown };
  }

  /**
   * Decide which phases to run for this sync.
   * @param {{ dbEmpty: boolean, backfillComplete: boolean }} input
   * @returns {{ runTop: boolean, runBackfill: boolean }}
   */
  function decideSyncPhase(input) {
    const dbEmpty = !!(input && input.dbEmpty);
    const backfillComplete = !!(input && input.backfillComplete);
    if (dbEmpty) {
      // Nothing known yet: the whole feed is "history" — backfill from the top.
      return { runTop: false, runBackfill: true };
    }
    return { runTop: true, runBackfill: !backfillComplete };
  }

  const api = {
    assignTopOrders,
    assignBackfillOrders,
    collectLeadingUnknown,
    decideSyncPhase
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (global) {
    global.NostalgiaSyncOrdering = api;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
