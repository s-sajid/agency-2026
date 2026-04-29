'use client'

import { Github, ArrowUpRight } from 'lucide-react'

import { cn } from '@/lib/utils'

const REPO = 's-sajid/agency-2026'
const REPO_URL = `https://github.com/${REPO}`

interface GithubBadgeProps {
  className?: string
}

/**
 * Compact attribution pill linking to the project's GitHub repo.
 *
 * Lives on the left side of the navbar alongside the wordmark — reads as
 * "this is the source," not as a user action competing with the right-side
 * icon buttons. Monospaced repo path so it sits in the same typographic
 * family as the dossier IDs and call_ids elsewhere in the app.
 *
 * Hidden below the `md` breakpoint to keep the mobile navbar uncluttered.
 */
export function GithubBadge({ className }: GithubBadgeProps) {
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={`View source on GitHub — ${REPO_URL}`}
      aria-label={`View source on GitHub: ${REPO}`}
      className={cn(
        'hidden md:inline-flex items-center gap-1.5 group h-7 px-2.5 rounded-md border transition-all duration-150',
        'hover:border-foreground/40 hover:bg-muted',
        className,
      )}
      style={{
        background: 'hsl(var(--muted) / 0.4)',
        borderColor: 'hsl(var(--border))',
      }}
    >
      <Github
        className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors"
        aria-hidden
      />
      <span className="text-[10.5px] font-mono tabular-nums text-muted-foreground group-hover:text-foreground tracking-tight transition-colors">
        {REPO}
      </span>
      <ArrowUpRight
        className="h-2.5 w-2.5 text-muted-foreground/60 group-hover:text-foreground transition-all duration-150 group-hover:-translate-y-px group-hover:translate-x-px"
        aria-hidden
      />
    </a>
  )
}
