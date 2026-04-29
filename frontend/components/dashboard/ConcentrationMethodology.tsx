'use client'

import { useEffect, useRef, useState } from 'react'

const BANDS = [
  {
    id: 'low',
    shortLabel: 'LOW',
    fullLabel: 'Competitive',
    range: '< 1,500',
    widthPct: 15,
    color: 'hsl(var(--chart-3))',
    desc: 'Multiple vendors share contracts without dominant incumbency. New entrants can compete effectively on price and capability.',
    signal: 'New entrants can win',
  },
  {
    id: 'moderate',
    shortLabel: 'MOD',
    fullLabel: 'Moderate Lock-In',
    range: '1,500 – 2,500',
    widthPct: 10,
    color: 'hsl(var(--chart-1))',
    desc: 'One or a few vendors hold meaningful share. Incumbency advantage is forming; barriers to switching begin to emerge.',
    signal: 'Competition is narrowing',
  },
  {
    id: 'high',
    shortLabel: 'HIGH',
    fullLabel: 'Highly Concentrated',
    range: '> 2,500',
    widthPct: 75,
    color: 'hsl(var(--destructive))',
    desc: 'A single supplier dominates spend. Renewal risk and pricing leverage are concentrated; open competition is displaced.',
    signal: 'Incumbency has replaced competition',
  },
] as const

export function ConcentrationMethodology() {
  const [animated, setAnimated] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setAnimated(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="rounded-xl border border-border bg-card overflow-hidden">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 border-b border-border">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="h-px w-5 bg-primary" />
            <span
              className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Methodology
            </span>
          </div>
          <h2
            className="text-lg font-bold text-foreground tracking-tight mb-2"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            How Concentration Is Measured
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            We use the{' '}
            <strong className="text-foreground font-semibold">
              Herfindahl–Hirschman Index (HHI)
            </strong>{' '}
            — the standard market concentration metric used by the U.S. Department of Justice and
            competition regulators worldwide — to measure how contract spending is distributed
            across vendors within each ministry. A higher HHI signals fewer vendors absorbing a
            larger share of total spend, and a greater risk that incumbency has replaced
            open competition.
          </p>
        </div>

        {/* Formula box */}
        <div className="shrink-0">
          <div className="rounded-lg border border-border bg-muted/40 px-5 py-4 min-w-[220px]">
            <div
              className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              The Formula
            </div>

            <div className="flex items-end gap-2 mb-3">
              <span
                className="text-base font-bold text-foreground leading-none"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                HHI
              </span>
              <span className="text-muted-foreground text-sm leading-none pb-px">=</span>
              <div className="flex items-end gap-1 leading-none pb-px">
                <div className="flex flex-col items-center text-muted-foreground leading-none mr-0.5">
                  <span className="text-[7px]">n</span>
                  <span className="text-[15px] leading-none" style={{ lineHeight: 1 }}>Σ</span>
                  <span className="text-[7px]">i=1</span>
                </div>
                <span className="text-sm text-foreground">s</span>
                <sub className="text-[8px] text-muted-foreground leading-none" style={{ verticalAlign: 'sub' }}>i</sub>
                <sup className="text-[8px] text-muted-foreground leading-none" style={{ verticalAlign: 'super' }}>2</sup>
              </div>
              <span className="text-muted-foreground text-sm leading-none pb-px">×</span>
              <span className="text-sm text-foreground font-semibold leading-none pb-px tabular-nums">10,000</span>
            </div>

            <div className="text-[10px] text-muted-foreground font-mono mb-3">
              s<sub>i</sub> = vendor<sub>i</sub> spend ÷ ministry total spend
            </div>

            <div className="pt-2.5 border-t border-border/60 space-y-1">
              <div
                className="text-[9px] text-muted-foreground uppercase tracking-wider"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                Example · 1 vendor at 80%
              </div>
              <div className="text-[11px] font-mono text-foreground">
                0.8² × 10,000 ={' '}
                <span className="font-bold" style={{ color: 'hsl(var(--destructive))' }}>
                  6,400
                </span>
                <span
                  className="ml-1.5 text-[9px] font-bold uppercase tracking-wider"
                  style={{ color: 'hsl(var(--destructive))', fontFamily: 'var(--font-syne)' }}
                >
                  HIGH
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── HHI Spectrum ── */}
      <div className="px-6 py-5 border-b border-border">
        <div
          className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-4"
          style={{ fontFamily: 'var(--font-syne)' }}
        >
          Concentration Scale · 0 – 10,000
        </div>

        {/* Band short labels above bar */}
        <div className="flex mb-1.5">
          {BANDS.map((band, i) => (
            <div
              key={band.id}
              className="text-[9px] font-bold uppercase tracking-wider"
              style={{
                width: `${band.widthPct}%`,
                color: band.color,
                opacity: animated ? 1 : 0,
                transition: `opacity 400ms ease-out ${i * 160 + 300}ms`,
                fontFamily: 'var(--font-syne)',
              }}
            >
              {band.shortLabel}
            </div>
          ))}
        </div>

        {/* Bar */}
        <div className="relative h-6 rounded-md flex overflow-hidden bg-muted">
          {BANDS.map((band, i) => (
            <div
              key={band.id}
              className="h-full relative"
              style={{
                width: animated ? `${band.widthPct}%` : '0%',
                backgroundColor: band.color,
                opacity: 0.72,
                transition: `width 700ms cubic-bezier(0.25, 1, 0.5, 1) ${i * 160}ms`,
              }}
            >
              {i < BANDS.length - 1 && (
                <div
                  className="absolute top-0 right-0 bottom-0 w-0.5"
                  style={{ backgroundColor: 'hsl(var(--card))', opacity: 0.7 }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Numeric axis below bar */}
        <div className="relative mt-1.5 h-4 select-none">
          <span className="absolute left-0 text-[9px] text-muted-foreground tabular-nums">0</span>
          <span
            className="absolute text-[9px] text-muted-foreground tabular-nums"
            style={{ left: '15%', transform: 'translateX(-50%)' }}
          >
            1,500
          </span>
          <span
            className="absolute text-[9px] text-muted-foreground tabular-nums"
            style={{ left: '25%', transform: 'translateX(-50%)' }}
          >
            2,500
          </span>
          <span className="absolute right-0 text-[9px] text-muted-foreground tabular-nums">
            10,000
          </span>
        </div>
      </div>

      {/* ── Band detail cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
        {BANDS.map((band) => (
          <div key={band.id} className="px-5 py-4">
            <div className="flex items-center gap-2 mb-2.5">
              <div
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: band.color, opacity: 0.85 }}
              />
              <span
                className="text-[11px] font-bold text-foreground"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                {band.fullLabel}
              </span>
              <span
                className="text-[9px] font-bold uppercase tracking-wider ml-auto"
                style={{ color: band.color, fontFamily: 'var(--font-syne)' }}
              >
                {band.shortLabel}
              </span>
            </div>
            <div
              className="text-[10px] font-semibold tabular-nums mb-2"
              style={{ color: band.color }}
            >
              HHI {band.range}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {band.desc}
            </p>
            <div
              className="text-[10px] font-medium mt-2.5"
              style={{ color: band.color, opacity: 0.75 }}
            >
              {band.signal}
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div className="px-6 py-3 bg-muted/30 border-t border-border">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="font-semibold" style={{ color: 'hsl(var(--foreground) / 0.75)' }}>
            Data:
          </span>{' '}
          Alberta Government open contract disclosures, all fiscal years. HHI computed per
          ministry across all vendors. Ministry and vendor names with variant spellings are
          normalized to a single canonical form before aggregation. Thresholds follow the U.S.
          DOJ/FTC Merger Guidelines: unconcentrated &lt;1,500 · moderately concentrated
          1,500–2,500 · highly concentrated &gt;2,500.
        </p>
      </div>
    </div>
  )
}
