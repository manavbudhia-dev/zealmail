import type { Fence } from '../../shared/types';

/**
 * Combines this window's fences with a list that arrived from elsewhere (another monitor's
 * window, or the reply to our own save), per fence instead of replacing the whole list.
 * Mirrors fence-merge.js in the main process.
 *
 *  - for a fence we both have, the one with the newer `updatedAt` wins (ties keep ours)
 *  - a fence only they have is added, unless we deleted it ourselves and have not saved yet
 *  - a fence we have but they do not is kept (it may be new and not saved yet)
 *  - ids in `deleted` were deleted on the other side and are removed here (deletion wins)
 */
export function applyIncomingFences(
  local: Fence[],
  incoming: Fence[],
  deleted: string[],
  knownIds: Set<string>
): Fence[] {
  const deletedSet = new Set(deleted);
  const localIds = new Set(local.map((f) => f.id));
  const incomingById = new Map(incoming.map((f) => [f.id, f]));

  const result: Fence[] = [];
  for (const fence of local) {
    if (deletedSet.has(fence.id)) continue;
    const theirs = incomingById.get(fence.id);
    result.push(theirs && (theirs.updatedAt || 0) > (fence.updatedAt || 0) ? theirs : fence);
  }
  for (const fence of incoming) {
    if (localIds.has(fence.id) || deletedSet.has(fence.id)) continue;
    if (knownIds.has(fence.id)) continue; // we removed it locally; that removal is still to be saved
    result.push(fence);
  }
  return result;
}
