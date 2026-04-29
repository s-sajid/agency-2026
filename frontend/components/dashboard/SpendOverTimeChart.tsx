'use client'

import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SourceBadge } from '@/components/dashboard/SourceBadge'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchSpendByYear } from '@/lib/api'
import type { SpendByYear } from '@/lib/types'

function fmtM(n: number) {
  return '$' + (Number(n) / 1_000_000).toFixed(0) + 'M'
}

const chartConfig = {
  total_spend: { label: 'Total Spend', color: 'hsl(var(--chart-2))' },
}

export function SpendOverTimeChart() {
  const [data, setData] = useState<SpendByYear[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSpendByYear()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load spend data'))
  }, [])

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle
            className="text-sm font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Total Spend by Fiscal Year
          </CardTitle>
          <SourceBadge />
        </div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest mt-0.5">
          Annual contract value · Alberta government
        </p>
      </CardHeader>

      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <AreaChart data={data} margin={{ left: 8, right: 16, top: 16, bottom: 4 }}>
              <defs>
                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-total_spend)" stopOpacity={0.35} />
                  <stop offset="60%" stopColor="var(--color-total_spend)" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="var(--color-total_spend)" stopOpacity={0} />
                </linearGradient>
              </defs>
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
                width={60}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, _name, item) => (
                      <div className="flex flex-col gap-1.5 py-0.5 w-full">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
                          FY {item.payload?.year}
                        </span>
                        <span className="text-sm font-bold text-foreground tabular-nums">
                          {fmtM(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="total_spend"
                stroke="var(--color-total_spend)"
                fill="url(#spendGradient)"
                strokeWidth={2.5}
                dot={{ fill: 'var(--color-total_spend)', strokeWidth: 0, r: 3.5 }}
                activeDot={{ r: 5.5, strokeWidth: 0, fill: 'var(--color-total_spend)' }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
