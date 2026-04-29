'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchMetrics } from '@/lib/api'
import type { DashboardMetrics, Stat } from '@/lib/types'

function toStats(m: DashboardMetrics): Stat[] {
  return [
    { label: 'Total Contracts', value: m.total_contracts.toLocaleString() },
    {
      label: 'Total Spend',
      value:
        '$' +
        (m.total_spend / 1_000_000).toLocaleString('en-CA', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }) +
        'M',
    },
    { label: 'Unique Vendors', value: m.unique_vendors.toLocaleString() },
  ]
}

export function MetricsSummary() {
  const [stats, setStats] = useState<Stat[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMetrics()
      .then((m) => setStats(toStats(m)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load metrics'))
  }, [])

  if (error) {
    return <div className="text-sm text-destructive">Failed to load metrics: {error}</div>
  }

  return (
    <div className="grid grid-cols-3 gap-5">
      {(stats ?? Array(3).fill(null)).map((stat, i) => (
        <Card key={i} className="relative overflow-hidden border-border">
          {/* Red left border — government document field marker */}
          <div className="absolute top-0 left-0 bottom-0 w-[4px] bg-primary" />
          <CardContent className="pt-5 pb-5 pl-7 pr-5">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest mb-3">
              {stat?.label ?? <Skeleton className="h-3 w-24" />}
            </div>
            {stat ? (
              <p
                className="text-3xl font-bold text-foreground tabular-nums"
                style={{ fontFamily: 'var(--font-syne)', fontVariantNumeric: 'tabular-nums' }}
              >
                {stat.value}
              </p>
            ) : (
              <Skeleton className="h-9 w-32 mt-1" />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
