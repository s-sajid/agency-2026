'use client'

import { useEffect, useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SourceBadge } from '@/components/dashboard/SourceBadge'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchConcentrationTrend } from '@/lib/api'
import type { ConcentrationTrendPoint } from '@/lib/types'

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

const DEPT_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
] as const

const chartConfig = {}

export function ConcentrationTrendChart() {
  const [rawData, setRawData] = useState<ConcentrationTrendPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchConcentrationTrend()
      .then(setRawData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load trend data'))
  }, [])

  const { departments, pivotedData } = useMemo(() => {
    if (!rawData) return { departments: [] as string[], pivotedData: null }
    const depts = [...new Set(rawData.map((r) => r.department))]
    const years = [...new Set(rawData.map((r) => r.year))].sort((a, b) => a - b)
    const lookup = new Map(rawData.map((r) => [`${r.year}:${r.department}`, r.hhi]))
    const pivotedData = years.map((year) => {
      const row: Record<string, number> = { year }
      depts.forEach((dept) => {
        const hhi = lookup.get(`${year}:${dept}`)
        if (hhi !== undefined) row[dept] = hhi
      })
      return row
    })
    return { departments: depts, pivotedData }
  }, [rawData])

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle
            className="text-sm font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Concentration Trend by Department
          </CardTitle>
          <SourceBadge />
        </div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest mt-0.5">
          HHI over time · top 5 most concentrated departments
        </p>
      </CardHeader>

      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rawData === null ? (
          <Skeleton className="h-[320px] w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="h-[320px] w-full">
            <LineChart data={pivotedData ?? undefined} margin={{ left: 8, right: 24, top: 12, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, 10000]}
                tickFormatter={(v: number) => v.toLocaleString()}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <ReferenceLine
                y={1500}
                stroke="hsl(var(--chart-1))"
                strokeDasharray="4 2"
                label={{ value: 'Mod.', position: 'insideTopRight', fontSize: 9, fill: 'hsl(var(--chart-1))' }}
              />
              <ReferenceLine
                y={2500}
                stroke="hsl(var(--destructive))"
                strokeDasharray="4 2"
                label={{ value: 'High', position: 'insideTopRight', fontSize: 9, fill: 'hsl(var(--destructive))' }}
              />
              <ChartTooltip
                cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="min-w-[11rem] rounded-lg border border-border bg-card px-3 py-3 text-xs shadow-xl">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none mb-2.5">
                        FY {label}
                      </p>
                      <div className="grid gap-1.5">
                        {payload.map((entry, i) => (
                          <div key={i} className="flex items-center justify-between gap-6">
                            <span className="flex items-center gap-1.5">
                              <div
                                className="w-3 h-0.5 rounded-full shrink-0"
                                style={{ backgroundColor: entry.color as string }}
                              />
                              <span className="text-[10px] text-muted-foreground leading-none">
                                {truncate(String(entry.name), 22)}
                              </span>
                            </span>
                            <span className="text-[11px] font-bold text-foreground tabular-nums">
                              {Number(entry.value).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }}
              />
              {departments.map((dept, i) => (
                <Line
                  key={dept}
                  type="monotone"
                  dataKey={dept}
                  stroke={DEPT_COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: DEPT_COLORS[i] }}
                  connectNulls
                />
              ))}
              <Legend
                content={({ payload }) => (
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 justify-center">
                    {payload?.map((entry, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div
                          className="w-4 h-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: entry.color as string }}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {truncate(String(entry.dataKey ?? ''), 24)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
