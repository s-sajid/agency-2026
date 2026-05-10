'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  AlertTriangle,
  ShieldCheck,
  Database,
  Hash,
  Clock,
  Info,
} from 'lucide-react'

import type { Notification, NotificationHit, NotificationMetricRow } from '@/lib/api'

interface NotificationDetailModalProps {
  notification: Notification | null
  onClose: () => void
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

// Pull a metric row out of the persisted metrics_table by case-insensitive
// name match. Returns the row's already-formatted display value, or null.
function findMetric(
  rows: NotificationMetricRow[] | undefined,
  ...names: string[]
): NotificationMetricRow | null {
  if (!rows) return null
  const lowered = names.map((n) => n.toLowerCase())
  for (const r of rows) {
    const m = (r.metric || '').toLowerCase()
    if (lowered.some((n) => m === n || m.includes(n))) return r
  }
  return null
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

  const vColor = verdictColor(notification.verdict)
  const hits: NotificationHit[] = notification.hits ?? []
  const headlineHit = hits[0]
  const metricsTable = notification.metrics_table ?? []
  const crossChecks = notification.cross_checks ?? []
  const caveats = notification.caveats ?? []

  // Derive secondary panel fields from the persisted metrics_table — the
  // values are pre-formatted strings ("100.0%", "1") composed by the
  // Final Brief, so we render them verbatim.
  const shareRow = findMetric(metricsTable, 'CR_1', 'CR1', 'cr_1')
  const tenureRow = findMetric(metricsTable, 'incumbency_streak', 'incumbency')

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
            {notification.headline || 'Auto-scan flagged a high-concentration category.'}
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
            {notification.entity && (
              <span className="flex items-center gap-1.5">
                <Database className="h-2.5 w-2.5" />
                {notification.entity}
              </span>
            )}
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
              className="rounded-lg border p-4"
              style={{
                borderColor: `color-mix(in srgb, ${vColor} 30%, transparent)`,
                background: `color-mix(in srgb, ${vColor} 4%, transparent)`,
              }}
            >
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
                  {fmtNumber(Math.round(Number(headlineHit?.value ?? 0)))}
                </span>
              </div>
              {headlineHit?.interpretation && (
                <p className="text-[11px] text-muted-foreground italic mb-3">
                  {headlineHit.interpretation}
                </p>
              )}

              <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-[11.5px]">
                {notification.entity && (
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-0.5">
                      Dominant vendor
                    </dt>
                    <dd className="text-foreground font-medium truncate" title={notification.entity}>
                      {notification.entity}
                    </dd>
                  </div>
                )}
                {notification.category && (
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-0.5">
                      Category
                    </dt>
                    <dd className="text-foreground font-medium truncate" title={notification.category}>
                      {notification.category}
                    </dd>
                  </div>
                )}
                {shareRow && (
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-0.5">
                      Share of spend (CR_1)
                    </dt>
                    <dd className="text-foreground font-mono tabular-nums">
                      {shareRow.value}
                    </dd>
                  </div>
                )}
                {tenureRow && (
                  <div>
                    <dt className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70 mb-0.5">
                      Tenure
                    </dt>
                    <dd className="text-foreground font-mono tabular-nums">
                      {tenureRow.value}{' '}
                      {tenureRow.interpretation && (
                        <span className="text-muted-foreground">
                          · {tenureRow.interpretation}
                        </span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
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

          {/* METRICS TABLE — full deterministic-math output */}
          {metricsTable.length > 0 && (
            <section>
              <SectionLabel>All metrics computed</SectionLabel>
              <ul className="divide-y divide-border/50 border border-border rounded-md overflow-hidden">
                {metricsTable.map((m, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2"
                  >
                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80">
                      {m.metric}
                    </span>
                    <span className="text-[10.5px] italic text-muted-foreground truncate">
                      {m.interpretation || ''}
                    </span>
                    <span className="text-[12px] font-mono font-semibold tabular-nums text-foreground">
                      {m.value}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* CROSS-CHECKS */}
          {crossChecks.length > 0 && (
            <section>
              <SectionLabel>Cross-checks</SectionLabel>
              <ul className="space-y-1.5">
                {crossChecks.map((c, i) => (
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
          )}

          {/* CAVEATS */}
          {caveats.length > 0 && (
            <section>
              <SectionLabel>Caveats</SectionLabel>
              <ul className="space-y-1.5">
                {caveats.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed">
                    <Info
                      className="h-3 w-3 mt-1 shrink-0 text-muted-foreground/70"
                    />
                    <span className="text-foreground/80 italic">{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* RECOMMENDED ACTION */}
          {notification.recommendation && (
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
                  {notification.recommendation}
                </p>
              </div>
            </section>
          )}
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
