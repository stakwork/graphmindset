import type { Review } from "@/lib/graph-api"

type SelectableRow = Pick<Review, "ref_id" | "action_name" | "status">

/**
 * Shift-click range selection over the visible review rows.
 *
 * Applies `select` (the new state of the clicked checkbox) to every row between
 * the anchor row and the clicked row inclusive. Rows the selection rules exclude
 * — non-pending, or a different action than the one the selection is locked to —
 * are skipped rather than aborting the range, so a range spanning mixed actions
 * still picks up every compatible row inside it.
 *
 * Falls back to toggling the clicked row alone when the anchor is no longer in
 * the list (page change, filter change, refetch).
 */
export function computeRangeSelection(
  rows: SelectableRow[],
  anchorRefId: string | null,
  clickedRefId: string,
  select: boolean,
  current: ReadonlySet<string>,
  lockedActionName: string | null
): Set<string> {
  const next = new Set(current)

  const clickedIndex = rows.findIndex((r) => r.ref_id === clickedRefId)
  const anchorIndex =
    anchorRefId === null ? -1 : rows.findIndex((r) => r.ref_id === anchorRefId)

  if (clickedIndex === -1 || anchorIndex === -1) {
    if (select) next.add(clickedRefId)
    else next.delete(clickedRefId)
    return next
  }

  const action = lockedActionName ?? rows[clickedIndex].action_name
  const start = Math.min(anchorIndex, clickedIndex)
  const end = Math.max(anchorIndex, clickedIndex)

  for (let i = start; i <= end; i++) {
    const row = rows[i]
    if (row.status !== "pending" || row.action_name !== action) continue
    if (select) next.add(row.ref_id)
    else next.delete(row.ref_id)
  }

  return next
}
