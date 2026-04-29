'use client'

import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  AlertTriangle,
  ShieldCheck,
  Database,
  Hash,
  Clock,
  TrendingUp,
} from 'lucide-react'

import type { Notification, NotificationHit } from '@/lib/api'

interface NotificationDetailModalProps {
  notification: Notification | null
  onClose: () => void
}

/**
 * Dummy enrichment payload — in production these fields would come from
 * the source job's audit{} blob, the Validator's cross-check output, and
 * a small "what changed since last scan" diff against the previous
 * notifications row for the same category.
 *
 * For now we synthesise plausible values that round-trip cleanly through
 * the modal's UI so the case-dossier layout reads end-to-end.
 */
function enrich(n: Notification) {
  // Pull a deterministic-ish set of dummy details keyed off the
  // notification id so the same row always shows the same details
  // (avoids a flicker if the polling refreshes the list while the
  // modal is open).
  const seed = (n.notification_id || '').split('-')[0] ?? '0000'
  const seedNum = parseInt(seed, 16) || 0
  const vendors = [
    'IBM Canada Ltd.',
    'Deloitte Inc.',
    'Accenture Inc.',
    'CGI Group Inc.',
    'KPMG LLP',
    'Microsoft Canada Co.',
    'Amazon Web Services Canada',
  ]
  const ministries = [
    'Service Alberta',
    'Treasury Board and Finance',
    'Technology and Innovation',
    'Children\'s Services',
    'Health',
  ]
  const v = vendors[seedNum % vendors.length]
  const m = ministries[(seedNum >> 4) % ministries.length]
  const tenureYears = 3 + (seedNum % 6)
  const sharePct = 70 + ((seedNum >> 2) % 28)

  // 4-quarter HHI trend ending at the most-recent hit's value
  const headlineHhi = (n.hits?.[0]?.value as number) || 4000
  const trend = [
    { fy: 'FY20/21', hhi: Math.max(1500, Math.round(headlineHhi - 1300 + (seedNum % 200))) },
    { fy: 'FY21/22', hhi: Math.max(1700, Math.round(headlineHhi - 900 + (seedNum % 200))) },
    { fy: 'FY22/23', hhi: Math.max(2000, Math.round(headlineHhi - 400 + (seedNum % 200))) },
    { fy: 'FY23/24', hhi: Math.round(headlineHhi) },
  ]

  return {
    dominantVendor: v,
    dominantMinistry: m,
    sharePct,
    tenureYears,
    crossChecks: [
      { ok: true,  what: `Cross-checked against sibling table ab.ab_sole_source — vendor share within ±2 pp.` },
      { ok: true,  what: `Cross-jurisdiction lookup confirms ${v} contracts in Alberta and Federal procurement.` },
      { ok: false, what: `Single-supplier exemption claim on file (DOJ §C — by-design singleton ruled out).` },
    ],
    trend,
    recommendedAction:
      'Treat as candidate for procurement review. Schedule competitive re-tender ahead of the FY25/26 cycle and request a written justification for any continued sole-source extension.',
    similar: [
      { name: 'IT consulting · British Columbia', hhi: 4012 },
      { name: 'Cloud infrastructure · Federal',  hhi: 5210 },
      { name: 'Records management · Ontario',     hhi: 3470 },
    ],
  }
}

function fmtTimestamp(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  } catch {
    return iso
  }
}

function fmtNumber(n: number): string {
  return n.toLocaleString('en-CA')
}

function verdictColor(v?: string): string {
  const V = (v ?? '').toUpperCase()
  if (V === 'MATCH') return 'hsl(var(--chart-3))'
  if (V === 'PARTIAL') return 'hsl(var(--chart-4))'
  if (V === 'DIVERGE') return 'hsl(var(--chart-1))'
  if (V === 'INSUFFICIENT_DATA') return 'hsl(var(--chart-4))'
  return 'hsl(var(--muted-foreground))'
}

function shortId(id?: string): string {
  if (!id) return '—'
  return id.slice(0, 8).toUpperCase()
}

// Tiny inline SVG sparkline. Draws in on mount via stroke-dasharray.
function Sparkline({
  values,
  color,
  height = 32,
}: {
  values: number[]
  color: string
  height?: number
}) {
  const points = useMemo(() => {
    if (values.length === 0) return ''
    const max = Math.max(...values)
    const min = Math.min(...values)
    const range = max - min || 1
    const w = 120
    const h = height - 8
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * w
        const y = h - ((v - min) / range) * h + 4
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [values, height])

  return (
    <svg width="120" height={height} className="overflow-visible">
      <style>{`
        @keyframes spark-draw {
          from { stroke-dashoffset: 200; }
          to   { stroke-dashoffset: 0; }
        }
        .spark-line {
          stroke-dasharray: 200;
          animation: spark-draw 1.1s cubic-bezier(0.22,1,0.36,1) forwards;
        }
        @keyframes spark-dot {
          0%   { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .spark-dot { animation: spark-dot 0.4s ease-out 0.9s forwards; opacity: 0; transform-origin: center; }
      `}</style>
      <polyline
        className="spark-line"
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {values.map((_, i) => {
        if (i !== values.length - 1) return null
        const [x, y] = points.split(' ').slice(-1)[0].split(',').map(Number)
        return (
          <circle
            key={i}
            className="spark-dot"
            cx={x}
            cy={y}
            r="3"
            fill={color}
            stroke="hsl(var(--card))"
            strokeWidth="1.5"
          />
        )
      })}
    </svg>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span
        className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-foreground"
        style={{ fontFamily: 'var(--font-syne)' }}
      >
        {children}
      </span>
      <span className="flex-1 h-[1px] bg-border" />
    </div>
  )
}

export function NotificationDetailModal({
  notification,
  onClose,
}: NotificationDetailModalProps) {
  useEffect(() => {
    if (!notification) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [notification, onClose])

  if (!notification) return null

  const dummy = enrich(notification)
  const vColor = verdictColor(notification.verdict)
  const hits: NotificationHit[] = notification.hits ?? []
  const headlineHit = hits[0]

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notif-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: 'hsl(var(--background) / 0.78)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
        onClick={onClose}
      />

      {/* Dossier */}
      <div
        className="relative z-10 w-full max-w-[680px] max-h-[90vh] flex flex-col bg-card rounded-xl shadow-2xl overflow-hidden"
        style={{
          border: '1px solid hsl(var(--border))',
          boxShadow:
            '0 24px 60px hsl(var(--foreground) / 0.18), 0 4px 16px hsl(var(--foreground) / 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes dossier-rise {
            0%   { opacity: 0; transform: translateY(8px) scale(0.985); }
            100% { opacity: 1; transform: translateY(0)   scale(1);     }
          }
          .dossier-rise { animation: dossier-rise 280ms cubic-bezier(0.22,1,0.36,1) forwards; }
          @keyframes accent-rise {
            from { transform: scaleY(0); }
            to   { transform: scaleY(1); }
          }
          .accent-rise { transform-origin: top; animation: accent-rise 360ms cubic-bezier(0.22,1,0.36,1) forwards; }
        `}</style>

        {/* Vertical verdict-coloured accent bar */}
        <div
          className="accent-rise absolute top-0 left-0 bottom-0 w-[5px]"
          style={{ background: vColor }}
        />

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <div className="relative pl-7 pr-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              {notification.sub_theme && (
                <span
                  className="text-[9.5px] font-bold uppercase tracking-[0.22em]"
                  style={{ color: vColor, fontFamily: 'var(--font-syne)' }}
                >
                  {notification.sub_theme}
                </span>
              )}
              <span className="text-[9.5px] text-muted-foreground/60 font-mono uppercase tracking-[0.14em]">
                Dossier {shortId(notification.notification_id)}
              </span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="h-6 w-6 -mt-1 -mr-1 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <h2
            id="notif-modal-title"
            className="text-[19px] font-bold tracking-tight leading-snug text-foreground"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            {notification.headline ||
              `Auto-scan flagged a high-concentration category in ${dummy.dominantMinistry}`}
          </h2>

          {/* Metadata strip */}
          <div className="flex items-center gap-x-4 gap-y-1 mt-3 text-[10px] font-mono tabular-nums text-muted-foreground/80 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Clock className="h-2.5 w-2.5" />
              {fmtTimestamp(notification.created_at)}
            </span>
            <span className="flex items-center gap-1.5">
              <Hash className="h-2.5 w-2.5" />
              job: {shortId(notification.source_job_id)}
            </span>
            <span className="flex items-center gap-1.5">
              <Database className="h-2.5 w-2.5" />
              ab.ab_contracts
            </span>
          </div>

          {/* Pills */}
          <div className="flex items-center gap-1.5 mt-3.5 flex-wrap">
            {notification.verdict && (
              <span
                className="px-2 py-1 rounded text-[9.5px] font-bold uppercase tracking-[0.18em] text-white"
                style={{
                  background: vColor,
                  fontFamily: 'var(--font-syne)',
                }}
              >
                {notification.verdict}
              </span>
            )}
            {notification.confidence && (
              <span
                className="px-2 py-1 rounded text-[9.5px] font-bold uppercase tracking-[0.18em] border"
                style={{
                  color: 'hsl(var(--foreground))',
                  borderColor: 'hsl(var(--border))',
                  fontFamily: 'var(--font-syne)',
                }}
              >
                Confidence · {notification.confidence}
              </span>
            )}
            <span
              className="px-2 py-1 rounded text-[9.5px] font-bold uppercase tracking-[0.18em] border border-border text-muted-foreground"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              {hits.length} HHI hit{hits.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {/* ── Body (scrolls) ──────────────────────────────────────────── */}
        <div className="dossier-rise pl-7 pr-5 py-5 overflow-y-auto overscroll-contain space-y-6">
          {/* TRIGGER */}
          <section>
            <SectionLabel>Trigger</SectionLabel>
            <div className="flex gap-3">
              <span
                className="w-[2px] shrink-0 rounded"
                style={{ background: 'hsl(var(--border))' }}
              />
              <p className="text-[12.5px] text-muted-foreground italic leading-relaxed">
                {notification.question ||
                  'Scan government spending and identify any category with an HHI above 2500.'}
              </p>
            </div>
          </section>

          {/* SUMMARY */}
          {notification.summary && (
            <section>
              <SectionLabel>Summary</SectionLabel>
              <p className="text-[13px] text-foreground/90 leading-relaxed">
                {notification.summary}
              </p>
            </section>
          )}

          {/* PRIMARY FINDING */}
          <section>
            <SectionLabel>Primary finding</SectionLabel>
            <div
              className="rounded-lg border p-4 grid grid-cols-[1fr_auto] gap-4"
              style={{
                borderColor: `color-mix(in srgb, ${vColor} 30%, transparent)`,
                background: `color-mix(in srgb, ${vColor} 4%, transparent)`,
              }}
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-3 mb-1">
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.18em]"
                    style={{ color: vColor }}
                  >
                    {headlineHit?.metric ?? 'HHI'}
                  </span>
                  <span
                    className="text-[26px] font-bold tabular-nums leading-none text-foreground"
                    style={{ fontFamily: 'var(--font-syne)' }}
                  >
                    {fmtNumber(Math.round(Number(headlineHit?.value ?? 4231)))}
                  </span>
                </div>
                {headlineHit?.interpretation && (
                  <p className="text-[11px] text-muted-foreground italic mb-3">
                    {headlineHit.interpretation}
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-[11.5px]">
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-0.5">
                      Dominant vendor
                    </dt>
                    <dd className="text-foreground font-medium truncate">
                      {dummy.dominantVendor}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-0.5">
                      Ministry
                    </dt>
                    <dd className="text-foreground font-medium truncate">
                      {dummy.dominantMinistry}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-0.5">
                      Share of spend
                    </dt>
                    <dd className="text-foreground font-mono tabular-nums">
                      {dummy.sharePct.toFixed(1)}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-0.5">
                      Tenure
                    </dt>
                    <dd className="text-foreground font-mono tabular-nums">
                      {dummy.tenureYears}{' '}
                      <span className="text-muted-foreground">consecutive FYs</span>
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Sparkline */}
              <div className="flex flex-col items-end justify-between min-w-[120px]">
                <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                  <TrendingUp className="h-2.5 w-2.5" />
                  4-yr trend
                </span>
                <Sparkline values={dummy.trend.map((t) => t.hhi)} color={vColor} />
                <div className="flex w-[120px] justify-between text-[8.5px] font-mono text-muted-foreground/60 tabular-nums">
                  <span>{dummy.trend[0].fy}</span>
                  <span>{dummy.trend[dummy.trend.length - 1].fy}</span>
                </div>
              </div>
            </div>

            {/* Additional hits collapsed below */}
            {hits.length > 1 && (
              <ul className="mt-2.5 divide-y divide-border/50 border border-border rounded-md overflow-hidden">
                {hits.slice(1).map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80">
                      {h.metric}
                    </span>
                    <span className="text-[12px] font-mono font-semibold tabular-nums text-foreground">
                      {fmtNumber(Math.round(Number(h.value)))}
                    </span>
                    {h.interpretation && (
                      <span className="text-[10.5px] italic text-muted-foreground truncate">
                        {h.interpretation}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* CROSS-CHECKS */}
          <section>
            <SectionLabel>Cross-checks</SectionLabel>
            <ul className="space-y-1.5">
              {dummy.crossChecks.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed">
                  {c.ok ? (
                    <ShieldCheck
                      className="h-3.5 w-3.5 mt-0.5 shrink-0"
                      style={{ color: 'hsl(var(--chart-3))' }}
                    />
                  ) : (
                    <AlertTriangle
                      className="h-3.5 w-3.5 mt-0.5 shrink-0"
                      style={{ color: 'hsl(var(--chart-4))' }}
                    />
                  )}
                  <span className="text-foreground/85">{c.what}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* RECOMMENDED ACTION */}
          <section>
            <SectionLabel>Recommended action</SectionLabel>
            <div
              className="rounded-md p-3.5 border-l-[3px]"
              style={{
                borderLeftColor: vColor,
                background: 'hsl(var(--muted) / 0.4)',
              }}
            >
              <p className="text-[12.5px] text-foreground/90 leading-relaxed">
                {dummy.recommendedAction}
              </p>
            </div>
          </section>

          {/* SIMILAR */}
          <section>
            <SectionLabel>Similar categories elsewhere</SectionLabel>
            <ul className="space-y-1">
              {dummy.similar.map((s) => (
                <li
                  key={s.name}
                  className="flex items-center justify-between text-[11.5px] py-1.5 border-b border-border/40 last:border-b-0"
                >
                  <span className="text-foreground/85 truncate pr-3">{s.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                    HHI {fmtNumber(s.hhi)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div
          className="pl-7 pr-5 py-3 border-t border-border flex items-center justify-end"
          style={{ background: 'hsl(var(--muted) / 0.3)' }}
        >
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[10.5px] font-bold uppercase tracking-[0.18em] bg-foreground text-background hover:opacity-85 transition-opacity"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Close dossier
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
