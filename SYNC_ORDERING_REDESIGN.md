# Sync Ordering Redesign — Design Plan

Status: **proposal (not yet implemented)** · Scope: `contentScript.js` sync engine, with optional `app.js` UX change and new tests. `background.js` needs **no** changes (it already exposes `GET_DB_BOUNDS` and preserves `savedOrder` on re-save).

## 1. Goal & invariants

"**Newest Saved**" must mean *the order you saved posts on Instagram* (newest save first), and must stay correct across:

- a fresh full sync of 30k+ posts,
- a sync that is **stopped and resumed** (possibly across browser sessions),
- a **re-sync after completion** when you've saved new posts on your phone,
- partial/interrupted backfills.

Invariants the design must guarantee:

1. **I1 — Newest save = highest `savedOrder`.** Sorting `savedOrder` descending yields exactly the Instagram saved order.
2. **I2 — No inversion.** Within any batch/page of newly-discovered saves, relative order matches the API (newest first).
3. **I3 — New saves always go on top.** Posts saved on the phone since the last sync get `savedOrder` *above* every existing post, on every re-sync — never at the bottom.
4. **I4 — Backfill is resumable & monotonic.** Historical backfill descends below the oldest post and survives stop/restart until truly complete.
5. **I5 — Idempotent re-sync.** After backfill is complete, a re-sync only scans the top until it reconnects with known posts (fast), then stops.

## 2. Why the current code violates these

| Bug | Location | Effect |
|-----|----------|--------|
| Resume state wiped on success (`clearProgress()`), so `savedMinId=''` next run → never enters "top mode" | `getInstagramSavedPosts` → `clearProgress` | **Violates I3:** new phone-saves get `bottomOrderCounter` values *below oldest* → shown as oldest. |
| Top mode does `order = topOrderCounter + (batch.length - batchIndex)` then `topOrderCounter += batch.length` | contentScript.js ~1305 / ~1315 | **Violates I1/I2:** with `PARALLEL_BATCH=1`, each newer post gets a *lower* value than the one before → newest-saved sort shows them backwards. |
| Counters re-anchor to `Date.now()`/bounds each run; re-sync re-walks the entire history doing existence checks | whole loop | **Violates I5:** slow, rate-limit-prone, "pages keep changing." |

(Backfill/"bottom mode" is already correct — it *decrements* its anchor while walking newest-first. The asymmetry with top mode, which *increments*, is the core defect.)

## 3. New state model

Derive the `savedOrder` anchors from the DB itself every sync (no drifting counters):

- **Top anchor** = `dbBounds.max` (from existing `GET_DB_BOUNDS`). New saves are assigned *above* it.
- **Bottom anchor** = `dbBounds.min`. Backfill is assigned *below* it.

Persist only what cannot be derived from the DB, under a **new** storage key (kept separate from the UI's `instagram_sync_progress` so the resume/counters UI is undisturbed):

```js
// chrome.storage.local key: 'nostalgia_sync_cursor'
{
  backfillCursor: string,      // next_max_id to resume the deep historical walk ('' = from top)
  backfillComplete: boolean    // true once the API reported more_available === false at the bottom
}
```

`instagram_sync_progress` (existing) keeps serving the UI's synced/failed/total counters and is still cleared on completion. `nostalgia_sync_cursor` is **only** cleared by "Clear All Data" (and `CLEAR_STORAGE`).

### `savedOrder` number space

- **New installs:** integers; backfill descends from `0` (newest history highest), new saves ascend above the running max. Negatives are fine — IndexedDB number indexes sort negatives correctly.
- **Existing installs:** anchoring to `dbBounds.max`/`min` (currently ~`Date.now()` magnitude) means **no migration of existing values is required** — their *relative* order is preserved; we only assign new work relative to current bounds. (See §7 for remediating already-corrupted data.)

## 4. Algorithm

```
state = load('nostalgia_sync_cursor') || { backfillCursor: '', backfillComplete: false }
bounds = GET_DB_BOUNDS()            // { min, max } or { null, null } if empty
dbEmpty = (POSTS_COUNT === 0)

// ---------- Phase A: TOP (new saves) — skipped only when DB is empty ----------
if (!dbEmpty) {
  let cursor = '', max = bounds.max, newBuffer = []
  loop pages from cursor (newest→older):
    items = fetchSavedPosts(cursor)
    exists = CHECK_POSTS_BATCH_EXISTS(items)
    // collect leading run of NOT-existing items
    for item in items (in order):
      if exists(item): reachedKnown = true; break
      newBuffer.push(item)
    if reachedKnown or !items.more_available: break
    cursor = items.next_max_id
  // assign newest=highest, contiguous above max, NO inversion:
  L = newBuffer.length
  for i in 0..L-1: savedOrder(newBuffer[i]) = max + (L - i)   // i=0 (newest) → max+L
  processAndSave(newBuffer)
}

// ---------- Phase B: BACKFILL (historical) — resumable ----------
if (dbEmpty || !state.backfillComplete) {
  let cursor = dbEmpty ? '' : state.backfillCursor
  let min = bounds.min ?? 0
  loop pages from cursor (newest→older):
    items = fetchSavedPosts(cursor)
    exists = CHECK_POSTS_BATCH_EXISTS(items)
    newOnes = items.filter(not exists)         // skip already-stored
    // assign descending below min, newest-of-batch highest:
    for j in 0..newOnes.length-1: savedOrder(newOnes[j]) = min - 1 - j
    min -= newOnes.length
    processAndSave(newOnes)
    state.backfillCursor = items.next_max_id; persist(state)   // throttled
    if (!items.more_available): state.backfillComplete = true; persist(state); break
    cursor = items.next_max_id
    if (stopRequested) break
}
```

Notes:
- **First sync (empty DB):** Phase A is skipped; Phase B walks the whole feed from the top, newest=highest. If interrupted, the DB is now non-empty, so the next run does a (no-op) Phase A that stops immediately at the newest known post, then Phase B resumes from `backfillCursor`. Clean.
- **Re-sync after completion:** Phase A collects new saves and stops at the first known post; Phase B is skipped (`backfillComplete`). Fast (I5).
- Existing `addPostsToIndexedDB` already **preserves `savedOrder` for posts already present** (by id or link), so re-encountering a post never disturbs its rank.

## 5. Edge cases

| Case | Handling |
|------|----------|
| **Empty DB / after "Clear All Data"** | `nostalgia_sync_cursor` reset; Phase A skipped; Phase B from `''`. |
| **Interrupted Phase A** (stop during top scan) | New buffer flushed as far as processed; next run re-scans from top, re-collects any still-unknown new saves (idempotent via existence check + preserved order). |
| **Interrupted Phase B** | `backfillCursor`/counts persisted per batch (throttled); resume continues below current min. Because min is re-read from DB each run, resumed values stay monotonic. |
| **Post unsaved on phone** | Remains in our DB (we never delete); its rank is stale but harmless. Out of scope (could add reconciliation later). |
| **Post unsaved then re-saved** | Same `id` → counts as "exists" → Phase A stops there; rank preserved. Acceptable (it keeps its original rank rather than jumping to newest). Documented limitation. |
| **Duplicate by link, different id** | Handled by existing `addPostsToIndexedDB` link-index check (unchanged). |
| **API returns fewer than expected / gaps** | Phase A's "stop at first known" tolerates gaps; Phase B keys off `more_available`. |
| **Rate limit / network error** | Existing retry/backoff loop retained; `backfillCursor` already persisted so a hard failure resumes cleanly. |
| **`GET_DB_BOUNDS` returns null max but DB non-empty** (corrupt index) | Fall back: treat as `max = 0`; log; Phase A still appends above 0. |
| **Concurrent inserts shifting pagination view** | UX mitigation in §8. |

## 6. Testability (pure, unit-tested helpers)

Extract the algorithm's decision points into **real exported functions** (exposed for tests the way `i18n.js` attaches its API), so tests exercise the actual code, not a copy:

1. `assignTopOrders(newestFirst, max)` → `[{ post, savedOrder }]` — assert: strictly decreasing by index, `newestFirst[0]` highest, all `> max`, contiguous.
2. `assignBackfillOrders(newestFirst, min)` → assert: `newestFirst[0]` highest, all `< min`, strictly decreasing.
3. `collectLeadingUnknown(items, existsFlags)` → `{ newOnes, reachedKnown }` — assert: stops at first existing; everything before is collected in order.
4. `decideSyncPhase({ dbEmpty, backfillComplete })` → `{ runTop, runBackfill }` — assert all four transitions.

Plus a property-style test feeding a simulated 3-page feed through `assign*` and checking the global `savedOrder` descending order equals the API order. This validates I1–I5 without live Instagram. **End-to-end behavior still requires a real sync to confirm** — called out explicitly.

## 7. Remediating already-corrupted installs (optional, separate step)

Going-forward correctness does **not** retroactively fix posts already misordered by the current bugs. Offer a one-time **"Rebuild saved order"** action:

- Walk the full saved feed top→bottom once, and for each item **update** the existing record's `savedOrder` to a fresh descending sequence (newest=highest). Matched by `id`; no re-download of thumbnails needed.
- Expensive (one full API walk, ~30k) but deterministic and correct.
- Gated behind an explicit button in the sync panel with a clear "this re-reads all your saves from Instagram" notice. Resumable via the same `backfillCursor` mechanism.

This is **Phase 2** of rollout — ship the forward-correct engine first, add the rebuild tool if you want to fix historical order.

## 8. "Pages keep changing during sync" (UX, low risk, separable)

Cause: `UPDATE_ITEMS` makes `app.js` reload the current page while inserts shift `savedOrder` offsets. Proposed change (independent of the ordering fix):

- While `isSyncing`, **pause auto-reload of the grid**; show a non-intrusive "Syncing… N new posts" banner and update only the counters/progress.
- Reload the grid once on `SYNC_COMPLETE`, or immediately when the user manually changes page/sort/filter.

Keeps the view stable during a multi-hour 30k sync.

## 9. Rollout / rollback

1. **Phase 1:** new engine + `nostalgia_sync_cursor` state + unit tests. Additive storage key; if anything misbehaves we revert `contentScript.js` and the orphan key is ignored. Existing `savedOrder` values untouched.
2. **Phase 2 (optional):** "Rebuild saved order" remediation tool.
3. **Phase 3 (optional):** sync-time grid-update pause (§8).

Rollback is clean because: existing `savedOrder` values are never destructively rewritten by Phase 1, and the new state key is purely additive.

## 10. Files touched (Phase 1)

- `contentScript.js` — replace `topOrderCounter`/`bottomOrderCounter`/`checkingNewPosts` logic in `getInstagramSavedPosts`; add `backfillCursor`/`backfillComplete` persistence; extract the four pure helpers.
- `__tests__/syncOrdering.test.js` — new test file for the helpers + the simulated-feed property test.
- `app.js` — (Phase 3 only) pause grid auto-reload during sync.
- `background.js` — none.

## 11. Open questions for you

- **Q1:** OK to ship Phase 1 (forward-correct) first and treat the "Rebuild saved order" remediation (Phase 2) as a follow-up? Or do you want both together since your current 30k data is likely already mis-ranked?
- **Q2:** Want the §8 grid-stability change included, or keep it strictly to ordering for now?
- **Q3:** Any preference on `savedOrder` numeric base (anchor to current `Date.now()`-magnitude bounds vs. renormalizing to small integers during a rebuild)?
