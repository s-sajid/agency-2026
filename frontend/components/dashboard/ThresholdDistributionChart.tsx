'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchContractDistribution } from '@/lib/api'
import type { ContractDistributionBucket } from '@/lib/types'

function fmtM(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  return '$' + (n / 1_000).toFixed(0) + 'K'
}

function bucketColor(bucketId: number): string {
  return bucketId <= 4 ? 'hsl(var(--chart-1))' : 'hsl(var(--chart-2))'
}

function bucketOpacity(bucketId: number): number {
  if (bucketId === 4) return 1      // $50–75K: full opacity, threshold proximity
  if (bucketId <= 3) return 0.55
  return 0.8
}

const chartConfig = {
  contract_count: { label: 'Contracts', color: 'hsl(var(--chart-1))' },
}

export function ThresholdDistributionChart() {
  const [data, setData] = useState<ContractDistributionBucket[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchContractDistribution()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load distribution data'))
  }, [])

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle
          className="text-sm font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-syne)' }}
        >
          Contract Value Distribution
        </CardTitle>
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest mt-0.5">
          Contract count by size · AB $75K competitive tender threshold
        </p>
      </CardHeader>

      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <BarChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }} maxBarSize={52}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : String(v)}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <ChartTooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0]?.payload as ContractDistributionBucket
                  const isThresholdZone = item.bucket_id === 4
                  return (
                    <div className="min-w-[10rem] rounded-lg border border-border bg-card px-3 py-3 text-xs shadow-xl">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none mb-2.5">
                        {item.bucket}
                        {isThresholdZone && (
                          <span className="ml-2 text-[9px] font-semibold text-[hsl(var(--chart-1))]">
                            ← THRESHOLD ZONE
                          </span>
                        )}
                      </p>
                      <div className="grid gap-1.5">
                        <div className="flex items-center justify-between gap-6">
                          <span className="text-[10px] text-muted-foreground leading-none">Contracts</span>
                          <span className="text-[11px] font-bold text-foreground tabular-nums">
                            {item.contract_count.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-6">
                          <span className="text-[10px] text-muted-foreground leading-none">Total Value</span>
                          <span className="text-[11px] font-bold text-foreground tabular-nums">
                            {fmtM(item.total_amount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="contract_count" radius={[4, 4, 0, 0]}>
                {data.map((item) => (
                  <Cell
                    key={item.bucket_id}
                    fill={bucketColor(item.bucket_id)}
                    fillOpacity={bucketOpacity(item.bucket_id)}
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
