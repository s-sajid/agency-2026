'use client'

import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import { Skeleton } from '@/components/ui/skeleton'
import { pollChat, type ToolResult } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  ArrowUp, Sparkles, Compass, Calculator, ShieldCheck,
  CheckCircle2, Loader2, RotateCcw, X, Zap,
} from 'lucide-react'
import { ResultCard } from '@/components/chat/ResultCard'

// ── Message shape ──────────────────────────────────────────────────────────

type Block =
  | { type: 'text'; value: string }
  | { type: 'card'; result: ToolResult }

interface ToolCall {
  id: string
  name: string
  label: string
  question: string
  done: boolean
}

interface Message {
  role: 'user' | 'assistant'
  blocks: Block[]
  streaming?: boolean
  toolCalls?: ToolCall[]
  route?: { route: string; reason: string }
  // Authoritative "what's running on the backend right now" from the
  // poll cycle — drives the right-side panel between event bursts.
  activeAgent?: string[] | null
  pollTick?: number
}

interface ChatDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ── Pipeline architecture (drives the right-side trace panel) ──────────────

const PIPELINE_NODES = [
  {
    name: 'discovery',
    label: 'Discovery',
    sublabel: 'Reframe · pick scope',
    icon: <Compass className="h-3.5 w-3.5" />,
    color: 'hsl(var(--chart-2))',
  },
  {
    name: 'investigation',
    label: 'Investigation',
    sublabel: 'Run math · gather findings',
    icon: <Calculator className="h-3.5 w-3.5" />,
    color: 'hsl(var(--chart-4))',
  },
  {
    name: 'validator',
    label: 'Validator',
    sublabel: 'Cross-check · enforce gates',
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    color: 'hsl(var(--chart-1))',
  },
  {
    name: 'narrative',
    label: 'Narrative',
    sublabel: 'Plain-English brief',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    color: 'hsl(var(--chart-5))',
  },
] as const

const SUGGESTIONS = [
  'Find the worst vendor lock-in in Alberta IT spending',
  'Which categories have the highest HHI?',
  'Is the IBM mainframe contract really 100% sole-source?',
  'Show me vendors locked in across both Alberta and federal',
]

// ── Suggestions block (empty state) ────────────────────────────────────────
function QuickStart({ onSuggest }: { onSuggest: (s: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        Quick Start
      </p>
      <div className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSuggest(s)}
            className="text-left text-[11px] text-muted-foreground hover:text-foreground leading-snug px-3 py-2.5 rounded-lg bg-muted/40 hover:bg-muted border border-border/50 hover:border-border transition-all duration-150"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Trace-panel agent card ─────────────────────────────────────────────────

type NodeState = 'idle' | 'active' | 'done'

function useElapsedTime(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    if (active) {
      startRef.current = Date.now()
      setElapsed(0)
      const id = setInterval(() => {
        if (startRef.current !== null)
          setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }, 1000)
      return () => clearInterval(id)
    }
    startRef.current = null
    return undefined
  }, [active])
  return elapsed
}

function AgentCard({
  icon, color, label, role, sublabel, state, badge,
}: {
  icon: React.ReactNode
  color: string
  label: string
  role: string
  sublabel?: string
  state: NodeState
  badge?: string
}) {
  const elapsed = useElapsedTime(state === 'active')
  return (
    <div className={cn(
      'relative rounded-md border overflow-hidden transition-all duration-500',
      state === 'idle' && 'border-border/15 opacity-40',
      state === 'active' && 'border-border/50',
      state === 'done' && 'border-border/35',
    )}>
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] transition-all duration-500"
        style={{
          backgroundColor:
            state === 'done' ? 'hsl(var(--chart-3))' :
            state === 'active' ? color : 'transparent',
        }}
      />
      <div className="pl-3.5 pr-2.5 py-2">
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-[8px] font-bold uppercase tracking-[0.12em] transition-colors duration-300"
            style={{
              color:
                state === 'active' ? color :
                state === 'done' ? 'hsl(var(--chart-3))' :
                'hsl(var(--muted-foreground) / 0.3)',
            }}
          >{role}</span>
          <div className="flex items-center gap-1">
            {state === 'active' && elapsed > 0 && (
              <span className="text-[9px] font-mono tabular-nums text-muted-foreground/45">
                {elapsed}s
              </span>
            )}
            {state === 'active' && <Loader2 className="h-2.5 w-2.5 text-primary animate-spin" />}
            {state === 'done' && (
              <CheckCircle2 className="h-2.5 w-2.5" style={{ color: 'hsl(var(--chart-3))' }} />
            )}
            {state === 'idle' && <div className="h-1.5 w-1.5 rounded-full bg-border/25" />}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="shrink-0 transition-colors duration-300"
            style={{ color: state === 'idle' ? 'hsl(var(--muted-foreground) / 0.3)' : color }}
          >{icon}</span>
          <span className={cn(
            'text-[12px] font-semibold tracking-tight transition-colors duration-300',
            state === 'idle' && 'text-muted-foreground/30',
            state === 'active' && 'text-foreground',
            state === 'done' && 'text-muted-foreground/70',
          )}>{label}</span>
          {badge && state !== 'idle' && (
            <span className="text-[8px] font-medium text-muted-foreground/50 bg-muted border border-border/40 rounded px-1 py-0.5 leading-none">
              {badge}
            </span>
          )}
        </div>
        {sublabel && state !== 'idle' && (
          <p className={cn(
            'text-[10px] mt-1.5 pl-[22px] leading-snug break-words line-clamp-2 transition-colors duration-300',
            state === 'active' ? 'text-muted-foreground' : 'text-muted-foreground/40',
          )}>{sublabel}</p>
        )}
      </div>
      {state === 'active' && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
          <div
            className="absolute top-0 bottom-0 w-2/5 pipeline-scan"
            style={{ background: `linear-gradient(90deg, transparent 0%, ${color} 50%, transparent 100%)` }}
          />
        </div>
      )}
    </div>
  )
}

function PipelinePanel({
  toolCalls, streaming, empty, onSuggest, route, activeAgent, pollTick,
}: {
  toolCalls: ToolCall[]
  streaming: boolean
  empty: boolean
  onSuggest: (s: string) => void
  route?: { route: string; reason: string }
  // Authoritative "running right now" set from the poll cycle. Takes
  // precedence over event-derived state because polling intervals can
  // mean events lag the backend by up to ~1s.
  activeAgent?: string[] | null
  // Increments on every poll cycle — drives the small "tick" pulse in
  // the header so the user can *see* polling is happening.
  pollTick?: number
}) {
  if (empty || (!streaming && toolCalls.length === 0)) {
    return <QuickStart onSuggest={onSuggest} />
  }

  const activeSet = new Set(activeAgent ?? [])

  function nodeStateFor(name: string): NodeState {
    if (activeSet.has(name)) return 'active'
    const calls = toolCalls.filter((t) => t.name === name)
    if (calls.length === 0) return 'idle'
    return calls.every((t) => t.done) ? 'done' : 'active'
  }

  const routerState = nodeStateFor('router')
  const doneCount = toolCalls.filter((t) => t.done).length

  return (
    <div className="flex flex-col gap-1.5">
      <style>{`
        @keyframes pipeline-scan {
          from { transform: translateX(-200%); }
          to   { transform: translateX(500%); }
        }
        .pipeline-scan { animation: pipeline-scan 2s linear infinite; }
        @keyframes poll-tick {
          0%   { transform: scale(1);   opacity: 1; }
          50%  { transform: scale(1.6); opacity: 0.4; }
          100% { transform: scale(1);   opacity: 1; }
        }
      `}</style>

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Agents
          </p>
          {toolCalls.length > 0 && (
            <span className="text-[9px] font-mono tabular-nums text-muted-foreground/35">
              {doneCount}/{toolCalls.length}
            </span>
          )}
        </div>
        {streaming && (
          <span className="flex items-center gap-1.5 text-[9px] font-bold text-primary uppercase tracking-wider">
            <span
              key={pollTick}
              className="h-1.5 w-1.5 rounded-full bg-primary"
              style={{ animation: 'poll-tick 0.4s ease-out' }}
            />
            Polling
          </span>
        )}
      </div>

      <AgentCard
        icon={<Zap className="h-3.5 w-3.5" />}
        color={routerState === 'done' ? 'hsl(var(--chart-3))' : 'hsl(var(--primary))'}
        label="Router"
        role="coordinator"
        sublabel={
          route ? `→ ${route.route} · ${route.reason}` :
          routerState === 'active' ? 'Classifying question…' :
          'Routes to specialist(s)'
        }
        state={routerState}
        badge={route?.route}
      />

      <div className="ml-3 border-l-2 border-border/20 pl-3 flex flex-col gap-1.5 pt-0.5">
        {PIPELINE_NODES.map((node) => (
          <AgentCard
            key={node.name}
            icon={node.icon}
            color={node.color}
            label={node.label}
            role="agent"
            sublabel={node.sublabel}
            state={nodeStateFor(node.name)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Block rendering inside an assistant message ────────────────────────────

function AssistantTextBlock({ value }: { value: string }) {
  if (!value) return null
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words
      [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
      [&_p]:leading-relaxed [&_p]:my-2
      [&_strong]:font-semibold [&_strong]:text-foreground
      [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:my-2
      [&_h1]:hidden [&_h2]:hidden [&_h3]:hidden
      [&_table]:my-2 [&_table]:text-[11px] [&_table]:border [&_table]:border-border/40 [&_table]:rounded
      [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold
      [&_td]:px-2 [&_td]:py-1 [&_td]:border-t [&_td]:border-border/30 [&_td]:align-top
      [&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:font-mono
      [&_pre]:hidden
      [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5
      [&_hr]:my-3 [&_hr]:border-border">
      <ReactMarkdown>{value}</ReactMarkdown>
    </div>
  )
}

function AssistantBlocks({ blocks, streaming }: { blocks: Block[]; streaming?: boolean }) {
  // Empty + streaming = show a small skeleton
  if (blocks.length === 0 && streaming) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    )
  }
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text') return <AssistantTextBlock key={i} value={b.value} />
        return <ResultCard key={i} result={b.result} />
      })}
    </>
  )
}

// ── Drawer ─────────────────────────────────────────────────────────────────

export function ChatDrawer({ open, onOpenChange }: ChatDrawerProps) {
  const [mounted, setMounted] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const conversationRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Track whether the user is "stuck" at the bottom. We only auto-scroll
  // when they are. The moment they scroll up, we stop yanking them down.
  const stickToBottomRef = useRef(true)

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])
  useEffect(() => {
    if (!open) return
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, onOpenChange])

  // Track when the user scrolls within the conversation pane. If they
  // are within 80px of the bottom, mark as "stuck"; otherwise free them.
  function handleConversationScroll() {
    const el = conversationRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom < 80
  }

  // Scroll to the bottom of the CONVERSATION PANE (not the whole page).
  // Only runs if the user is already stuck at the bottom — never yanks
  // them away from content they're reading.
  function maybeScrollToBottom() {
    if (!stickToBottomRef.current) return
    const el = conversationRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }

  function appendTextToLast(prev: Message[], delta: string): Message[] {
    const updated = [...prev]
    const last = { ...updated[updated.length - 1] }
    const blocks = [...(last.blocks ?? [])]
    const tail = blocks[blocks.length - 1]
    if (tail && tail.type === 'text') {
      blocks[blocks.length - 1] = { type: 'text', value: tail.value + delta }
    } else {
      blocks.push({ type: 'text', value: delta })
    }
    last.blocks = blocks
    last.streaming = true
    updated[updated.length - 1] = last
    return updated
  }

  function appendCardToLast(prev: Message[], result: ToolResult): Message[] {
    const updated = [...prev]
    const last = { ...updated[updated.length - 1] }
    if (result.kind === 'route') {
      // Route metadata goes on the message itself, not as a chat block.
      last.route = (result as any).data
    } else {
      last.blocks = [...(last.blocks ?? []), { type: 'card', result }]
    }
    last.streaming = true
    updated[updated.length - 1] = last
    return updated
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = input.trim()
    if (!query || loading) return

    setInput('')
    setLoading(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', blocks: [{ type: 'text', value: query }] },
      { role: 'assistant', blocks: [], streaming: true, toolCalls: [] },
    ])

    try {
      for await (const update of pollChat(query)) {
        if (update.type === 'status') {
          // Authoritative "what's running on the backend right now" —
          // updated once per poll so the right panel doesn't lag the UI.
          setMessages((prev) => {
            const updated = [...prev]
            const last = { ...updated[updated.length - 1] }
            last.activeAgent = update.activeAgent
            last.pollTick = (last.pollTick ?? 0) + 1
            updated[updated.length - 1] = last
            return updated
          })
          continue
        }
        const event = update.event
        if (event.type === 'text') {
          setMessages((prev) => appendTextToLast(prev, event.text))
        } else if (event.type === 'tool_result') {
          setMessages((prev) => appendCardToLast(prev, event.result))
        } else if (event.type === 'tool') {
          setMessages((prev) => {
            const updated = [...prev]
            const last = { ...updated[updated.length - 1] }
            last.toolCalls = [
              ...(last.toolCalls ?? []),
              { id: `${event.name}-${Date.now()}`, name: event.name, label: event.label, question: event.question, done: false },
            ]
            updated[updated.length - 1] = last
            return updated
          })
        } else if (event.type === 'tool_done') {
          setMessages((prev) => {
            const updated = [...prev]
            const last = { ...updated[updated.length - 1] }
            let marked = false
            last.toolCalls = (last.toolCalls ?? []).map((t) => {
              if (!marked && t.name === event.name && !t.done) {
                marked = true
                return { ...t, done: true }
              }
              return t
            })
            updated[updated.length - 1] = last
            return updated
          })
        }
        maybeScrollToBottom()
      }
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        updated[updated.length - 1] = {
          ...last,
          streaming: false,
          toolCalls: (last.toolCalls ?? []).map((t) => ({ ...t, done: true })),
        }
        return updated
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong'
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        updated[updated.length - 1] = {
          ...last,
          blocks: [...(last.blocks ?? []), { type: 'text', value: `**Error:** ${msg}` }],
          streaming: false,
          toolCalls: (last.toolCalls ?? []).map((t) => ({ ...t, done: true })),
        }
        return updated
      })
    } finally {
      setLoading(false)
    }
  }

  if (!mounted || !open) return null

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const pipelineTools = lastAssistant?.toolCalls ?? []
  const isStreaming = lastAssistant?.streaming ?? false
  const activeAgent = lastAssistant?.activeAgent ?? null
  const pollTick = lastAssistant?.pollTick

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-background/75 backdrop-blur-md" onClick={() => onOpenChange(false)} />

      <div
        className="relative z-10 w-full max-w-6xl flex flex-col bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        style={{ height: 'min(880px, 95vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="leading-tight">
              <h2 className="text-[13px] font-bold tracking-tight text-foreground leading-none"
                  style={{ fontFamily: 'var(--font-syne)' }}>
                Ask AI
              </h2>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                Vendor concentration analysis
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setInput('') }}
                disabled={loading}
                title="Clear conversation"
                className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              ><RotateCcw className="h-3.5 w-3.5" /></button>
            )}
            <button
              onClick={() => onOpenChange(false)}
              className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            ><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: conversation — bounded width, scroll-y. Auto-scroll
              only when user is already at the bottom (handleScroll tracks). */}
          <div
            ref={conversationRef}
            onScroll={handleConversationScroll}
            className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-5 py-5 space-y-4"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground"
                     style={{ fontFamily: 'var(--font-syne)' }}>
                    Ask about Canadian government vendor concentration
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[300px]">
                    Routed through the Router agent to one or more specialists.
                    <br />Every number is sourced and verifiable.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'user' ? (
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground break-words">
                    {(msg.blocks[0] as { type: 'text'; value: string })?.value}
                  </div>
                ) : (
                  <div className="w-full max-w-[95%] rounded-2xl rounded-bl-sm px-4 py-3 bg-muted text-foreground">
                    <AssistantBlocks blocks={msg.blocks} streaming={msg.streaming} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right: trace panel */}
          <div className="w-[320px] shrink-0 border-l border-border bg-card/50 overflow-y-auto px-4 py-5">
            <PipelinePanel
              toolCalls={pipelineTools}
              streaming={isStreaming}
              empty={messages.length === 0}
              onSuggest={(s) => { setInput(s); inputRef.current?.focus() }}
              route={lastAssistant?.route}
              activeAgent={activeAgent}
              pollTick={pollTick}
            />
          </div>
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="px-4 py-3.5 border-t border-border shrink-0 bg-card">
          <div className="flex items-center gap-2 bg-muted rounded-xl px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about vendor concentration…"
              disabled={loading}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            ><ArrowUp className="h-3.5 w-3.5 text-primary-foreground" /></button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
