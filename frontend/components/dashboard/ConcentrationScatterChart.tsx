'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchConcentrationScatter } from '@/lib/api'
import type { ConcentrationScatterPoint } from '@/lib/types'

const BAND_COLORS = {
  HIGH:     'hsl(var(--destructive))',
  MODERATE: 'hsl(var(--chart-1))',
  LOW:      'hsl(var(--chart-3))',
}

const QUADRANTS = [
  {
    corner: 'tr' as const,
    text: 'PRIORITY RISK',
    fill: 'hsl(var(--destructive))',
    fillOpacity: 0.07,
    labelColor: 'hsl(var(--destructive))',
    // x1=xMid, x2=xMax, y1=yMid, y2=top
  },
  {
    corner: 'tl' as const,
    text: 'NICHE CONCERN',
    fill: 'hsl(var(--chart-1))',
    fillOpacity: 0.04,
    labelColor: 'hsl(var(--chart-1))',
    // x1=xMin, x2=xMid, y1=yMid, y2=top
  },
  {
    corner: 'br' as const,
    text: 'COMPETITIVE',
    fill: 'hsl(var(--chart-3))',
    fillOpacity: 0.05,
    labelColor: 'hsl(var(--chart-3))',
    // x1=xMid, x2=xMax, y1=0, y2=yMid
  },
  {
    corner: 'bl' as const,
    text: 'LOW PRIORITY',
    fill: 'transparent',
    fillOpacity: 0,
    labelColor: 'hsl(var(--muted-foreground))',
    // x1=xMin, x2=xMid, y1=0, y2=yMid
  },
] as const

// ── Quadrant label rendered inside each ReferenceArea ─────────────────────────
function QuadrantLabel({
  viewBox,
  text,
  color,
  corner,
}: {
  viewBox?: { x: number; y: number; width: number; height: number }
  text: string
  color: string
  corner: 'tl' | 'tr' | 'bl' | 'br'
}) {
  if (!viewBox || viewBox.width < 2 || viewBox.height < 2) return null
  const { x, y, width, height } = viewBox
  const pad = 7
  const tx = corner.includes('r') ? x + width - pad : x + pad
  const ty = corner.includes('b') ? y + height - pad : y + pad
  return (
    <text
      x={tx}
      y={ty}
      textAnchor={corner.includes('r') ? 'end' : 'start'}
      dominantBaseline={corner.includes('b') ? 'auto' : 'hanging'}
      fontSize={7.5}
      fill={color}
      opacity={0.6}
      style={{
        fontFamily: 'monospace',
        letterSpacing: '0.07em',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {text}
    </text>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtSpend(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000)     return `$${(v / 1_000_000).toFixed(0)}M`
  return `$${(v / 1_000).toFixed(0)}K`
}

function toChart(d: ConcentrationScatterPoint) {
  return { ...d, logSpend: Math.log10(Math.max(d.total_spend, 1)) }
}

type TPoint = ConcentrationScatterPoint & { logSpend: number }

function dotRadius(vendorCount: number): number {
  return Math.max(4, Math.min(12, 3.5 + Math.sqrt(vendorCount) * 0.7))
}

function filterOutliers(pts: TPoint[]): TPoint[] {
  return pts
    .filter((d) => d.total_spend >= 5_000_000 && d.vendor_count >= 3)
    .sort((a, b) => b.total_spend - a.total_spend)
    .slice(0, 25)
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: TPoint }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-xl text-xs space-y-1.5 min-w-[13rem]">
      <p
        className="font-bold text-foreground text-[11px] leading-tight"
        style={{ fontFamily: 'var(--font-syne)' }}
      >
        {d.department}
      </p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
        <span>HHI</span>
        <span className="text-foreground font-semibold tabular-nums text-right">
          {d.hhi.toLocaleString()}
        </span>
        <span>Band</span>
        <span
          className="font-bold text-right uppercase tracking-wide text-[10px]"
          style={{ color: BAND_COLORS[d.band] }}
        >
          {d.band}
        </span>
        <span>Spend</span>
        <span className="text-foreground font-semibold text-right">{fmtSpend(d.total_spend)}</span>
        <span>Vendors</span>
        <span className="text-foreground font-semibold text-right">{d.vendor_count}</span>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
const Y_MID = 2500   // HHI "highly concentrated" threshold
const Y_TOP = 10200

export function ConcentrationScatterChart() {
  const [raw, setRaw]     = useState<ConcentrationScatterPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchConcentrationScatter()
      .then(setRaw)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  const allData = useMemo(() => raw?.map(toChart) ?? null, [raw])

  const { filtered, xMin, xMax, xTicks, xMid } = useMemo(() => {
    if (!allData) {
      return { filtered: null, xMin: 7, xMax: 10, xTicks: [7, 8, 9, 10], xMid: 8.5 }
    }
    const f = filterOutliers(allData)
    const logVals = f.map((d) => d.logSpend).sort((a, b) => a - b)
    const lo = logVals[0]
    const hi = logVals[logVals.length - 1]
    const xMin = Math.floor((lo - 0.15) * 10) / 10
    const xMax = Math.ceil((hi + 0.15) * 10) / 10

    // Median logSpend as horizontal quadrant divider
    const xMid = logVals[Math.floor(logVals.length / 2)]

    const ticks: number[] = []
    for (let t = Math.ceil(xMin); t <= Math.floor(xMax); t++) ticks.push(t)

    return { filtered: f, xMin, xMax, xTicks: ticks, xMid }
  }, [allData])

  const renderDot = useCallback(
    (props: { cx?: number; cy?: number; payload?: TPoint }) => {
      const { cx, cy, payload } = props
      if (cx == null || cy == null || !payload) return null as unknown as React.ReactElement
      const color = BAND_COLORS[payload.band]
      const r = dotRadius(payload.vendor_count)
      return (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={color}
          fillOpacity={0.78}
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth={1.5}
        />
      ) as unknown as React.ReactElement
    },
    []
  )

  return (
    <Card className="border-border">
      <CardHeader className="pb-2 px-5 pt-5">
        <CardTitle
          className="text-sm font-bold text-foreground tracking-tight"
          style={{ fontFamily: 'var(--font-syne)' }}
        >
          Spend vs. Concentration
        </CardTitle>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Ministries ≥$5M spend · X: total spend · Y: HHI · dividers at median spend &amp; HHI 2500
        </p>
      </CardHeader>

      <CardContent className="px-5 pb-5">
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !filtered ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 12, right: 20, bottom: 4, left: 8 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                strokeOpacity={0.3}
              />

              {/* ── Quadrant background fills ── */}
              {/* Priority Risk: high spend + high HHI */}
              <ReferenceArea
                x1={xMid} x2={xMax + 0.5}
                y1={Y_MID} y2={Y_TOP}
                fill={QUADRANTS[0].fill}
                fillOpacity={QUADRANTS[0].fillOpacity}
                strokeOpacity={0}
                label={
                  <QuadrantLabel
                    text={QUADRANTS[0].text}
                    color={QUADRANTS[0].labelColor}
                    corner={QUADRANTS[0].corner}
                  />
                }
              />
              {/* Niche Concern: low spend + high HHI */}
              <ReferenceArea
                x1={xMin - 0.5} x2={xMid}
                y1={Y_MID} y2={Y_TOP}
                fill={QUADRANTS[1].fill}
                fillOpacity={QUADRANTS[1].fillOpacity}
                strokeOpacity={0}
                label={
                  <QuadrantLabel
                    text={QUADRANTS[1].text}
                    color={QUADRANTS[1].labelColor}
                    corner={QUADRANTS[1].corner}
                  />
                }
              />
              {/* Competitive: high spend + low HHI */}
              <ReferenceArea
                x1={xMid} x2={xMax + 0.5}
                y1={0} y2={Y_MID}
                fill={QUADRANTS[2].fill}
                fillOpacity={QUADRANTS[2].fillOpacity}
                strokeOpacity={0}
                label={
                  <QuadrantLabel
                    text={QUADRANTS[2].text}
                    color={QUADRANTS[2].labelColor}
                    corner={QUADRANTS[2].corner}
                  />
                }
              />
              {/* Low Priority: low spend + low HHI */}
              <ReferenceArea
                x1={xMin - 0.5} x2={xMid}
                y1={0} y2={Y_MID}
                fill={QUADRANTS[3].fill}
                fillOpacity={QUADRANTS[3].fillOpacity}
                strokeOpacity={0}
                label={
                  <QuadrantLabel
                    text={QUADRANTS[3].text}
                    color={QUADRANTS[3].labelColor}
                    corner={QUADRANTS[3].corner}
                  />
                }
              />

              {/* ── Quadrant dividers ── */}
              <ReferenceLine
                x={xMid}
                stroke="hsl(var(--border))"
                strokeWidth={1.5}
                strokeOpacity={0.8}
              />
              <ReferenceLine
                y={Y_MID}
                stroke="hsl(var(--border))"
                strokeWidth={1.5}
                strokeOpacity={0.8}
              />

              <XAxis
                type="number"
                dataKey="logSpend"
                domain={[xMin, xMax]}
                ticks={xTicks}
                tickFormatter={(v) => fmtSpend(Math.pow(10, v))}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
              />

              <YAxis
                type="number"
                dataKey="hhi"
                domain={[0, Y_TOP]}
                ticks={[0, 2500, 5000, 7500, 10000]}
                tickFormatter={(v: number) => (v === 0 ? '0' : `${v / 1000}k`)}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                width={36}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: 'hsl(var(--border))', strokeDasharray: '3 3' }}
              />

              <Scatter data={filtered} shape={renderDot} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        )}

        {filtered && (
          <div className="flex items-center gap-5 mt-1 justify-center flex-wrap">
            {(['LOW', 'MODERATE', 'HIGH'] as const).map((band) => (
              <div key={band} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: BAND_COLORS[band], opacity: 0.85 }}
                />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {band}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 ml-2 border-l border-border pl-4">
              <span className="text-[10px] text-muted-foreground">Bubble size = vendor count</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
