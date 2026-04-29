'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Bell, AlarmClock, Activity, X, ChevronRight } from 'lucide-react'

import { fetchNotifications, type Notification } from '@/lib/api'
import { cn } from '@/lib/utils'
import { NotificationDetailModal } from '@/components/layout/NotificationDetailModal'

const LAST_SEEN_KEY = 'agency2026.notifications.last-seen'
const POLL_MS = 30_000

function formatTimeAgo(iso?: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function verdictColor(verdict?: string): string {
  const V = (verdict ?? '').toUpperCase()
  if (V === 'MATCH') return 'hsl(var(--chart-3))'
  if (V === 'PARTIAL') return 'hsl(var(--chart-4))'
  if (V === 'DIVERGE') return 'hsl(var(--chart-1))'
  return 'hsl(var(--muted-foreground))'
}

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[] | null>(null)
  const [open, setOpen] = useState(false)
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [selected, setSelected] = useState<Notification | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    setMounted(true)
    setLastSeenAt(localStorage.getItem(LAST_SEEN_KEY))
  }, [])

  // Poll the notifications endpoint every 30s. If the request fails (network
  // blip, App Runner restart) we keep prior state so the badge doesn't flicker.
  useEffect(() => {
    if (!mounted) return
    let cancelled = false
    async function tick() {
      try {
        const r = await fetchNotifications()
        if (!cancelled) setItems(r.items)
      } catch {
        /* keep prior state */
      }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [mounted])

  // Close the panel on Esc or outside click. The panel is portalled to <body>
  // so contains-checks need to span both the button and the panel.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      if (
        panelRef.current && !panelRef.current.contains(t) &&
        buttonRef.current && !buttonRef.current.contains(t)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const unreadCount = (() => {
    if (!items || items.length === 0) return 0
    if (!lastSeenAt) return items.length
    const last = new Date(lastSeenAt).getTime()
    return items.filter((i) => new Date(i.created_at).getTime() > last).length
  })()

  function markRead() {
    const ts = new Date().toISOString()
    setLastSeenAt(ts)
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAST_SEEN_KEY, ts)
    }
  }

  function togglePanel() {
    setOpen((prev) => {
      const next = !prev
      if (next) {
        markRead()
        if (buttonRef.current) {
          setAnchorRect(buttonRef.current.getBoundingClientRect())
        }
      }
      return next
    })
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={togglePanel}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        className="relative h-8 w-8 rounded-md flex items-center justify-center transition-colors duration-150"
        style={{
          color: open ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
          backgroundColor: open ? 'hsl(var(--muted))' : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (open) return
          e.currentTarget.style.backgroundColor = 'hsl(var(--muted))'
          e.currentTarget.style.color = 'hsl(var(--foreground))'
        }}
        onMouseLeave={(e) => {
          if (open) return
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
        }}
      >
        <Bell className="h-[15px] w-[15px]" />

        {unreadCount > 0 && (
          <>
            <style>{`
              @keyframes bell-ping {
                0%   { transform: scale(1);   opacity: 0.6; }
                100% { transform: scale(2.6); opacity: 0;   }
              }
              .bell-ping { animation: bell-ping 1.6s ease-out infinite; }
            `}</style>
            <span
              className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
              style={{
                background: 'hsl(var(--chart-1))',
                boxShadow: '0 0 0 2px hsl(var(--card)), 0 0 6px hsl(var(--chart-1))',
              }}
            />
            <span
              className="bell-ping absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full pointer-events-none"
              style={{ background: 'hsl(var(--chart-1))' }}
            />
          </>
        )}
      </button>

      {mounted && open && anchorRect && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[100] w-[420px] max-w-[calc(100vw-32px)] rounded-xl overflow-hidden"
          style={{
            top: anchorRect.bottom + 8,
            right: window.innerWidth - anchorRect.right,
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            boxShadow:
              '0 12px 40px hsl(var(--foreground) / 0.10), 0 2px 8px hsl(var(--foreground) / 0.06)',
          }}
        >
          {/* ── Header with explainer ── */}
          <div
            className="px-4 pt-3 pb-3.5 border-b border-border"
            style={{ background: 'hsl(var(--muted) / 0.4)' }}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2">
                <AlarmClock
                  className="h-3.5 w-3.5"
                  style={{ color: 'hsl(var(--chart-1))' }}
                />
                <span
                  className="text-[12px] font-bold tracking-tight"
                  style={{ fontFamily: 'var(--font-syne)' }}
                >
                  Auto-Scan Notifications
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <p className="text-[10.5px] text-muted-foreground leading-relaxed">
              A background scan runs the full{' '}
              <span className="text-foreground font-medium">Discovery → Investigation → Validator → Narrative</span>{' '}
              pipeline every 10 minutes. An alert fires when validated findings include any category with HHI{' '}
              <span className="font-mono font-semibold text-foreground">&gt; 2500</span> — the DOJ &ldquo;highly concentrated&rdquo; threshold.
            </p>
          </div>

          {/* ── List ── */}
          <div className="max-h-[420px] overflow-y-auto overscroll-contain">
            {items === null && (
              <div className="px-4 py-8 text-center">
                <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse" />
                  Connecting…
                </div>
              </div>
            )}

            {items !== null && items.length === 0 && (
              <div className="px-4 py-8 text-center">
                <div className="inline-flex flex-col items-center gap-2">
                  <Activity
                    className="h-4 w-4"
                    style={{ color: 'hsl(var(--chart-3))' }}
                  />
                  <p className="text-[11px] text-muted-foreground leading-snug max-w-[260px]">
                    Auto-scan is running.<br />
                    No high-concentration alerts yet.
                  </p>
                </div>
              </div>
            )}

            {items?.map((n) => {
              const isUnread =
                lastSeenAt === null ||
                new Date(n.created_at).getTime() > new Date(lastSeenAt).getTime()
              const vColor = verdictColor(n.verdict)
              const hitCount = n.hits?.length ?? 0
              return (
                <button
                  key={n.notification_id}
                  type="button"
                  onClick={() => {
                    setSelected(n)
                    setOpen(false)
                  }}
                  className="w-full text-left px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 transition-opacity duration-300"
                      style={{
                        background: isUnread ? vColor : 'transparent',
                        opacity: isUnread ? 1 : 0,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[12px] font-bold tracking-tight leading-snug text-foreground line-clamp-2 group-hover:underline group-hover:underline-offset-[3px] decoration-foreground/20"
                        style={{ fontFamily: 'var(--font-syne)' }}
                      >
                        {n.headline || 'High-concentration finding'}
                      </p>
                      {n.summary && (
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                          {n.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {n.verdict && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-[0.14em] border"
                            style={{
                              color: vColor,
                              borderColor: `color-mix(in srgb, ${vColor} 35%, transparent)`,
                              background: `color-mix(in srgb, ${vColor} 8%, transparent)`,
                            }}
                          >
                            {n.verdict}
                          </span>
                        )}
                        {n.sub_theme && (
                          <span className="text-[8.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                            {n.sub_theme}
                          </span>
                        )}
                        {hitCount > 0 && (
                          <span className="text-[10px] text-muted-foreground/80 font-mono tabular-nums">
                            {hitCount} hit{hitCount === 1 ? '' : 's'}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono tabular-nums">
                          {formatTimeAgo(n.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* ── Footer ── */}
          <div
            className="px-4 py-2 border-t border-border flex items-center justify-between text-[9.5px] uppercase tracking-[0.14em] font-bold"
            style={{ background: 'hsl(var(--muted) / 0.3)' }}
          >
            <span className="text-muted-foreground/70">
              Scans every 10 min · 7-day retention
            </span>
            <span className="flex items-center gap-1 text-muted-foreground/70">
              <span
                className="h-1.5 w-1.5 rounded-full animate-pulse"
                style={{ background: 'hsl(var(--chart-3))' }}
              />
              Live
            </span>
          </div>
        </div>,
        document.body
      )}

      {/* Detail dossier — opens when a row is clicked, closes via Esc /
          backdrop / Close button. Renders alongside the bell so it
          survives the bell panel closing. */}
      <NotificationDetailModal
        notification={selected}
        onClose={() => setSelected(null)}
      />
    </>
  )
}
