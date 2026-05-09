'use client'

import { ArrowUpRight } from 'lucide-react'

import { cn } from '@/lib/utils'

const REPO = 's-sajid/agency-2026'
const REPO_URL = `https://github.com/${REPO}`

// The pinned `lucide-react@1.14.0` predates the brand-icon split and no
// longer exports `Github`, so we render the official mark as inline SVG
// here. currentColor lets it inherit the badge's text colour for the
// hover transition.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.111.82-.261.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

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
      <GithubMark className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
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
