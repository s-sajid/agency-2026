'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { LayoutDashboard, Users, Building2, MessageSquare, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChatDrawer } from '@/components/chat/ChatDrawer'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vendors', label: 'Vendors', icon: Users },
  { href: '/departments', label: 'Departments', icon: Building2 },
]

export function Sidebar() {
  const pathname = usePathname()
  const [chatOpen, setChatOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()

  useEffect(() => setMounted(true), [])

  return (
    <>
      <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r border-border bg-card flex flex-col">
        {/* Wordmark */}
        <div className="px-5 py-6">
          <div className="flex items-center gap-2.5">
            <div className="h-5 w-5 rounded-sm bg-primary shrink-0" />
            <span
              className="text-sm font-bold tracking-tight text-foreground"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Agency 2026
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 ml-[29px] tracking-wide uppercase">
            Vendor Intelligence
          </p>
        </div>

        {/* Divider */}
        <div className="mx-5 h-px bg-border" />

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-150 relative',
                  active
                    ? 'text-foreground font-medium bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-primary" />
                )}
                <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-4">
          <div className="mx-2 mb-4 h-px bg-border" />
          <button
            className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-150 mb-0.5"
            onClick={() => setChatOpen(true)}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
            Ask AI
          </button>
          <button
            className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-150"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {mounted && theme === 'dark'
              ? <Sun className="h-4 w-4 shrink-0" />
              : <Moon className="h-4 w-4 shrink-0" />}
            {mounted && theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      <ChatDrawer open={chatOpen} onOpenChange={setChatOpen} />
    </>
  )
}
