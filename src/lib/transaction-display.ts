const ACTION_LABELS: Record<string, string> = {
  top_up: 'Top Up',
  search: 'Search',
  purchase: 'Purchase',
  boost: 'Boost',
  refund: 'Refund',
  add_content: 'Add Content',
  add_source: 'Add Source',
  payout: 'Earnings',
  other: 'Other',
}

const ACTION_BADGE_COLORS: Record<string, string> = {
  top_up: 'bg-emerald-500/10 text-emerald-400',
  search: 'bg-blue-500/10 text-blue-400',
  purchase: 'bg-purple-500/10 text-purple-400',
  boost: 'bg-amber/10 text-amber',
  refund: 'bg-amber/10 text-amber',
  add_content: 'bg-emerald-500/10 text-emerald-400',
  add_source: 'bg-teal-500/10 text-teal-400',
  payout: 'bg-green-500/10 text-green-400',
  other: 'bg-muted/40 text-muted-foreground',
}

export function getActionDisplayLabel(action: string): string {
  return ACTION_LABELS[action] ?? 'Other'
}

export function getActionBadgeColor(action: string): string {
  return ACTION_BADGE_COLORS[action] ?? ACTION_BADGE_COLORS.other
}
