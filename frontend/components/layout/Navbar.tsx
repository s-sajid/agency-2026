'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { MessageSquare, Sun, Moon } from 'lucide-react'
import { ChatDrawer } from '@/components/chat/ChatDrawer'
import { NotificationsBell } from '@/components/layout/NotificationsBell'
import { GithubBadge } from '@/components/layout/GithubBadge'

export function Navbar() {
  const [chatOpen, setChatOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isDark = mounted && theme === 'dark'

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 h-14 transition-shadow duration-300"
        style={{
          backgroundColor: 'hsl(var(--card) / 0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid hsl(var(--border))',
          boxShadow: scrolled
            ? '0 1px 16px hsl(var(--foreground) / 0.06)'
            : 'none',
        }}
      >
        <div className="h-full px-8 flex items-center justify-between">
          {/* ── Wordmark ── */}
          <div className="flex items-center gap-3">
            <span
              className="text-sm font-bold tracking-tight"
              style={{ color: 'hsl(var(--primary))', fontFamily: 'var(--font-syne)' }}
            >
              Agency 2026
            </span>
            <div
              className="hidden sm:block h-3.5 w-px"
              style={{ backgroundColor: 'hsl(var(--border))' }}
            />
            <span
              className="hidden sm:block text-[11px] font-medium uppercase tracking-[0.12em]"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              Vendor Intelligence
            </span>
            <div
              className="hidden md:block h-3.5 w-px"
              style={{ backgroundColor: 'hsl(var(--border))' }}
            />
            <GithubBadge />
          </div>

          {/* ── Right actions ── */}
          <div className="flex items-center gap-2">
            <NotificationsBell />

            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="h-8 w-8 rounded-md flex items-center justify-center transition-colors duration-150"
              style={{ color: 'hsl(var(--muted-foreground))' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'hsl(var(--muted))'
                e.currentTarget.style.color = 'hsl(var(--foreground))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
              }}
              aria-label="Toggle theme"
            >
              {mounted ? (
                isDark
                  ? <Sun className="h-[15px] w-[15px]" />
                  : <Moon className="h-[15px] w-[15px]" />
              ) : (
                <div className="h-[15px] w-[15px]" />
              )}
            </button>

            <button
              onClick={() => setChatOpen(true)}
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[12px] font-semibold transition-all duration-150"
              style={{
                backgroundColor: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
                fontFamily: 'var(--font-syne)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'brightness(1.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'none'
              }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Ask AI
            </button>
          </div>
        </div>
      </header>

      <ChatDrawer open={chatOpen} onOpenChange={setChatOpen} />
    </>
  )
}
