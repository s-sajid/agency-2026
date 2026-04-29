'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchTopVendors } from '@/lib/api'

type Row = { recipient: string; contract_count: number; total_amount: number }

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function fmtM(n: number) {
  return '$' + (n / 1_000_000).toFixed(0) + 'M'
}

const chartConfig = {
  total_amount: { label: 'Total Spend', color: 'hsl(var(--chart-2))' },
}

export function TopVendorsChart() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTopVendors(10)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load vendors'))
  }, [])

  const chartHeight = rows ? rows.length * 44 + 16 : 456

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle
          className="text-sm font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-syne)' }}
        >
          Top Vendors by Contract Value
        </CardTitle>
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest mt-0.5">
          Top 10 recipients · total contract value
        </p>
      </CardHeader>

      <CardContent className="p-6 pt-0 pb-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows === null ? (
          <Skeleton className="h-[456px] w-full" />
        ) : (
          <ChartContainer
            config={chartConfig}
            className="w-full"
            style={{ height: `${chartHeight}px` }}
          >
            <BarChart
              data={rows.map((r) => ({ ...r, label: truncate(r.recipient, 26) }))}
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
                tickFormatter={fmtM}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, _name, item) => (
                      <div className="flex flex-col gap-1.5 py-0.5 w-full">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
                          {truncate(item.payload?.recipient ?? '', 32)}
                        </span>
                        <span className="text-sm font-bold text-foreground tabular-nums">
                          {'$' + Number(value).toLocaleString('en-CA', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Bar dataKey="total_amount" radius={[0, 4, 4, 0]}>
                {rows.map((_, i) => (
                  <Cell
                    key={i}
                    fill="var(--color-total_amount)"
                    fillOpacity={rows.length > 1 ? 1 - (i / (rows.length - 1)) * 0.55 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
