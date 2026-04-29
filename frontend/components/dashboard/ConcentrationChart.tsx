'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SourceBadge } from '@/components/dashboard/SourceBadge'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchConcentration } from '@/lib/api'
import type { ConcentrationResult } from '@/lib/types'

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

const bandColor: Record<'HIGH' | 'MODERATE' | 'LOW', string> = {
  HIGH:     'hsl(var(--destructive))',
  MODERATE: 'hsl(var(--chart-1))',
  LOW:      'hsl(var(--chart-3))',
}

const bandLabel: Record<'HIGH' | 'MODERATE' | 'LOW', string> = {
  HIGH: 'High', MODERATE: 'Moderate', LOW: 'Low',
}

type Band = 'HIGH' | 'MODERATE' | 'LOW'

const chartConfig = {
  hhi: { label: 'HHI Score', color: 'hsl(var(--chart-1))' },
}

export function ConcentrationChart() {
  const [results, setResults] = useState<ConcentrationResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchConcentration(10)
      .then(setResults)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load concentration data'))
  }, [])

  const chartHeight = results ? results.length * 44 + 16 : 456

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle
            className="text-sm font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Concentration by Department
          </CardTitle>
          <SourceBadge />
        </div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest mt-0.5">
          HHI score · top 10 departments
        </p>
      </CardHeader>

      <CardContent className="p-6 pt-0 pb-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : results === null ? (
          <Skeleton className="h-[456px] w-full" />
        ) : (
          <ChartContainer
            config={chartConfig}
            className="w-full"
            style={{ height: `${chartHeight}px` }}
          >
              <BarChart
                data={results.map((r) => ({ ...r, label: truncate(r.department, 26) }))}
                layout="vertical"
                barSize={32}
                margin={{ left: 8, right: 56, top: 4, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <YAxis
                  dataKey="label"
                  type="category"
                  width={160}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <XAxis
                  type="number"
                  domain={[0, 10000]}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, _name, item) => {
                        const band = item.payload?.band as Band | undefined
                        const color = band ? bandColor[band] : 'hsl(var(--chart-1))'
                        return (
                          <div className="flex flex-col gap-1.5 py-0.5 w-full">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
                              {truncate(item.payload?.department ?? '', 32)}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-foreground tabular-nums">
                                HHI {Number(value).toLocaleString()}
                              </span>
                              {band && (
                                <span
                                  className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                                  style={{ color, backgroundColor: color + '20' }}
                                >
                                  {bandLabel[band]}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      }}
                    />
                  }
                />
                <ReferenceLine
                  x={1500}
                  stroke="hsl(var(--chart-1))"
                  strokeDasharray="4 2"
                  label={{ value: 'Mod.', position: 'insideTopRight', fontSize: 9, fill: 'hsl(var(--chart-1))' }}
                />
                <ReferenceLine
                  x={2500}
                  stroke="hsl(var(--destructive))"
                  strokeDasharray="4 2"
                  label={{ value: 'High', position: 'insideTopRight', fontSize: 9, fill: 'hsl(var(--destructive))' }}
                />
                <Bar dataKey="hhi" radius={[0, 4, 4, 0]}>
                  {results.map((r, i) => (
                    <Cell key={i} fill={bandColor[r.band]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
