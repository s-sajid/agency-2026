import { Database } from 'lucide-react'

import { cn } from '@/lib/utils'

// Default source for the homepage charts. Every dashboard endpoint in
// `backend/vendor_concentration_agent/dashboards.py` queries the same
// table; if a future chart hits a different one, pass `source` explicitly.
export const DEFAULT_DASHBOARD_SOURCE = 'ab.ab_contracts'

interface SourceBadgeProps {
  source?: string
  className?: string
}

/**
 * Small monospaced pill that names the underlying schema/table for a
 * dashboard card. Rendered low-contrast so it reads as metadata, not
 * a headline — but it makes the data provenance visible at a glance.
 */
export function SourceBadge({
  source = DEFAULT_DASHBOARD_SOURCE,
  className,
}: SourceBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded',
        'text-[9px] font-mono font-medium uppercase tracking-[0.08em]',
        'text-muted-foreground/85 bg-muted/50 border border-border/50',
        className,
      )}
      title={`Source: ${source}`}
    >
      <Database className="h-2.5 w-2.5" aria-hidden />
      <span className="tabular-nums">{source}</span>
    </span>
  )
}
