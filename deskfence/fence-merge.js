// Merges a window's saved fence list into the list on disk, per fence (not the whole list),
// so a window holding a stale copy can never undo another window's newer change.
//
//  - every fence carries `updatedAt` (stamped by the renderer on each change); the newer one wins
//  - a fence the sender did not mention is kept (another window may have just created it)
//  - a fence is only removed when the sender explicitly lists its id in `deleted`
//  - deletion wins over a stale copy: tombstones stop a stale window from resurrecting it
function isValidFence(f) {
  return (
    !!f &&
    typeof f === 'object' &&
    typeof f.id === 'string' &&
    f.id.length > 0 &&
    typeof f.name === 'string' &&
    !!f.position && Number.isFinite(f.position.x) && Number.isFinite(f.position.y) &&
    !!f.size && Number.isFinite(f.size.width) && Number.isFinite(f.size.height) &&
    Array.isArray(f.items) &&
    !!f.style && typeof f.style === 'object'
  );
}

// Returns { fences, rejected }: `rejected` are ids the sender still had but that were deleted
// earlier (so the sender can drop its stale copy too).
function mergeDetailed(current, incoming, deleted, tombstones, now) {
  const rejected = [];
  const stamp = now === undefined ? Date.now() : now;
  const byId = new Map();
  const order = [];
  for (const f of current) {
    if (!byId.has(f.id)) order.push(f.id);
    byId.set(f.id, f);
  }

  for (const id of deleted) {
    byId.delete(id);
    tombstones.set(id, stamp);
  }

  for (const f of incoming) {
    if (!isValidFence(f)) continue;
    const existing = byId.get(f.id);
    if (!existing) {
      if (tombstones.has(f.id)) {
        rejected.push(f.id); // deleted elsewhere: deletion wins
        continue;
      }
      byId.set(f.id, f);
      order.push(f.id);
    } else if ((Number(f.updatedAt) || 0) >= (Number(existing.updatedAt) || 0)) {
      byId.set(f.id, f);
    }
  }

  const seen = new Set();
  const result = [];
  for (const id of order) {
    if (byId.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(byId.get(id));
    }
  }
  return { fences: result, rejected };
}

function mergeOnSave(current, incoming, deleted, tombstones, now) {
  return mergeDetailed(current, incoming, deleted, tombstones, now).fences;
}

module.exports = { mergeOnSave, mergeDetailed, isValidFence };
