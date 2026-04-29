'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SourceBadge } from '@/components/dashboard/SourceBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchVendorDominance } from '@/lib/api'
import type { VendorDominancePoint } from '@/lib/types'

function bandColor(pct: number): string {
  if (pct > 60) return 'hsl(var(--destructive))'
  if (pct > 33) return 'hsl(var(--chart-1))'
  return 'hsl(var(--chart-3))'
}

function bandLabel(pct: number): string {
  if (pct > 60) return 'HIGH'
  if (pct > 33) return 'MOD'
  return 'LOW'
}

function fmtSpend(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000)     return `$${(v / 1_000_000).toFixed(0)}M`
  return `$${(v / 1_000).toFixed(0)}K`
}

function DominanceRow({ d }: { d: VendorDominancePoint }) {
  const color = bandColor(d.dominance_pct)
  const pct   = Math.min(d.dominance_pct, 100)

  return (
    <div className="group">
      {/* Ministry name + % */}
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span
          className="text-[11px] font-semibold text-foreground leading-tight"
          style={{ fontFamily: 'var(--font-syne)' }}
        >
          {d.department}
        </span>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span
            className="text-[12px] font-bold tabular-nums leading-none"
            style={{ color }}
          >
            {pct.toFixed(0)}%
          </span>
          <span
            className="text-[8px] font-bold uppercase tracking-widest leading-none"
            style={{ color, opacity: 0.65 }}
          >
            {bandLabel(pct)}
          </span>
        </div>
      </div>

      {/* Progress bar with 50% reference marker */}
      <div className="relative h-[7px] bg-muted rounded-full overflow-hidden">
        {/* 50% tick — drawn before the fill so it stays visible for bars < 50% */}
        <div
          className="absolute top-0 bottom-0 w-px z-10"
          style={{ left: '50%', backgroundColor: 'hsl(var(--border))', opacity: 0.7 }}
        />
        <div
          className="h-full rounded-full transition-none"
          style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.82 }}
        />
      </div>

      {/* Top vendor */}
      <div className="flex items-center justify-between mt-1 gap-2">
        <span className="text-[10px] text-muted-foreground truncate leading-none">
          {d.top_vendor}
        </span>
        <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums leading-none">
          {fmtSpend(d.vendor_spend)} of {fmtSpend(d.total_spend)}
        </span>
      </div>
    </div>
  )
}

export function VendorDominanceChart() {
  const [data, setData]   = useState<VendorDominancePoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchVendorDominance()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  // Highest dominance first
  const sorted = data
    ? [...data].sort((a, b) => b.dominance_pct - a.dominance_pct)
    : null

  // Split into two columns of equal length
  const half   = sorted ? Math.ceil(sorted.length / 2) : 0
  const colA   = sorted?.slice(0, half) ?? []
  const colB   = sorted?.slice(half)   ?? []

  return (
    <Card className="border-border">
      <CardHeader className="pb-3 px-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <CardTitle
            className="text-sm font-bold text-foreground tracking-tight"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Top Vendor Dominance
          </CardTitle>
          <SourceBadge />
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          #1 vendor's share of ministry spend · top 12 ministries by total contract value · bar midpoint = 50%
        </p>
      </CardHeader>

      <CardContent className="px-5 pb-5">
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !sorted ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {/* Column A — highest half */}
            <div className="flex flex-col gap-4">
              {colA.map((d) => <DominanceRow key={d.department} d={d} />)}
            </div>
            {/* Column B — lower half */}
            <div className="flex flex-col gap-4">
              {colB.map((d) => <DominanceRow key={d.department} d={d} />)}
            </div>
          </div>
        )}

        {/* Legend */}
        {sorted && (
          <div className="flex items-center gap-5 mt-5 pt-4 border-t border-border justify-center flex-wrap">
            {[
              { label: '< 33%',  color: 'hsl(var(--chart-3))',    note: 'competitive'      },
              { label: '33–60%', color: 'hsl(var(--chart-1))',    note: 'moderate lock-in' },
              { label: '> 60%',  color: 'hsl(var(--destructive))', note: 'high dominance'  },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-6 rounded-sm"
                  style={{ backgroundColor: item.color, opacity: 0.8 }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {item.label}
                  <span className="opacity-60"> · {item.note}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
