'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchVendorCompetition } from '@/lib/api'
import type { VendorCompetitionPoint } from '@/lib/types'

function fmtM(n: number) {
  return '$' + (n / 1_000_000).toFixed(0) + 'M'
}

const chartConfig = {
  returning_spend: { label: 'Returning / Incumbent', color: 'hsl(var(--chart-1))' },
  new_spend:       { label: 'New Vendors',            color: 'hsl(var(--chart-3))' },
}

export function VendorCompetitionChart() {
  const [data, setData] = useState<VendorCompetitionPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchVendorCompetition()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load competition data'))
  }, [])

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle
          className="text-sm font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-syne)' }}
        >
          New vs. Incumbent Vendor Spend
        </CardTitle>
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest mt-0.5">
          Annual contract value · new entrants vs. returning suppliers
        </p>
      </CardHeader>

      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <BarChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }} maxBarSize={40}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={fmtM}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <ChartTooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const year = payload[0]?.payload?.year
                  const returning = payload.find((p) => p.dataKey === 'returning_spend')
                  const newVendor = payload.find((p) => p.dataKey === 'new_spend')
                  const total = (Number(returning?.value ?? 0) + Number(newVendor?.value ?? 0))
                  return (
                    <div className="min-w-[11rem] rounded-lg border border-border bg-card px-3 py-3 text-xs shadow-xl">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none mb-2.5">
                        FY {year}
                      </p>
                      <div className="grid gap-1.5">
                        {returning && (
                          <div className="flex items-center justify-between gap-6">
                            <span className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-sm shrink-0 bg-[hsl(var(--chart-1))]" />
                              <span className="text-[10px] text-muted-foreground leading-none">Incumbent</span>
                            </span>
                            <span className="text-[11px] font-bold text-foreground tabular-nums">
                              {fmtM(Number(returning.value))}
                            </span>
                          </div>
                        )}
                        {newVendor && (
                          <div className="flex items-center justify-between gap-6">
                            <span className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-sm shrink-0 bg-[hsl(var(--chart-3))]" />
                              <span className="text-[10px] text-muted-foreground leading-none">New Vendors</span>
                            </span>
                            <span className="text-[11px] font-bold text-foreground tabular-nums">
                              {fmtM(Number(newVendor.value))}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-6 pt-1 mt-0.5 border-t border-border">
                          <span className="text-[10px] text-muted-foreground leading-none">Total</span>
                          <span className="text-[11px] font-bold text-foreground tabular-nums">{fmtM(total)}</span>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="returning_spend" stackId="spend" fill="var(--color-returning_spend)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="new_spend" stackId="spend" fill="var(--color-new_spend)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
