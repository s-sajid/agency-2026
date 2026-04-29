'use client'

import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
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

// ── Conversation context ───────────────────────────────────────────────────
//
// On every submission we serialise the prior turns into the `context` arg
// the backend already plumbs to /chat → orchestrator → Router and every
// specialist. Each consumer sandwiches it between a "Conversation context:"
// header and the new question, so a plain `USER: …\n\nASSISTANT: …` text
// format is what they expect.
//
// We cap aggressively — token budget matters, and the most recent few
// turns carry almost all of the useful signal for follow-ups.
const CONTEXT_MAX_MESSAGES = 8
const CONTEXT_MAX_CHARS_PER_MESSAGE = 600

function extractAssistantText(msg: Message): string {
  // Prefer the Final Brief's headline + summary — it's the agent's
  // canonical answer and (post-Narrative-paraphrase) the most useful
  // signal for follow-up questions.
  for (const b of msg.blocks) {
    if (b.type === 'card' && b.result.kind === 'final_brief') {
      const data = b.result.data
      const parts = [data.headline, data.summary].filter(Boolean) as string[]
      if (parts.length) return parts.join(' ')
    }
  }
  // Otherwise concatenate any flowing text (e.g. narration route).
  const text = msg.blocks
    .filter((b): b is { type: 'text'; value: string } => b.type === 'text')
    .map((b) => b.value)
    .join(' ')
    .trim()
  if (text) return text
  // Last resort: pull a one-line gist out of the last structured card.
  for (let i = msg.blocks.length - 1; i >= 0; i--) {
    const b = msg.blocks[i]
    if (b.type !== 'card') continue
    const r = b.result
    if (r.kind === 'findings' && 'headline' in r.data && r.data.headline) return r.data.headline
    if (r.kind === 'verdict' && 'verdict' in r.data && r.data.verdict) return `Verdict: ${r.data.verdict}`
    if (r.kind === 'discovery_plan' && 'scope' in r.data && r.data.scope) return r.data.scope
  }
  return ''
}

function buildContext(messages: Message[]): string {
  const tail = messages.slice(-CONTEXT_MAX_MESSAGES)
  const turns: string[] = []
  for (const msg of tail) {
    if (msg.streaming) continue
    if (msg.role === 'user') {
      const first = msg.blocks[0]
      if (first?.type === 'text' && first.value.trim()) {
        turns.push(`USER: ${first.value.trim().slice(0, CONTEXT_MAX_CHARS_PER_MESSAGE)}`)
      }
    } else {
      const text = extractAssistantText(msg)
      if (text) turns.push(`ASSISTANT: ${text.slice(0, CONTEXT_MAX_CHARS_PER_MESSAGE)}`)
    }
  }
  return turns.join('\n\n')
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
  icon, color, label, role, sublabel, state, badge, question, onPath = true,
}: {
  icon: React.ReactNode
  color: string
  label: string
  role: string
  sublabel?: string
  state: NodeState
  badge?: string
  // The live tool-call question for this agent — surfaced inside the
  // spotlight card so the user can see *what* the running agent is being
  // asked to do, not just that it's running.
  question?: string
  // Whether this agent is on the active route's path. When false (and a
  // route has been chosen), the card renders deeply faded so the user
  // can still see the architecture but the active path reads first.
  onPath?: boolean
}) {
  const elapsed = useElapsedTime(state === 'active' && onPath)

  // Off-path: very faded compact strip — never spotlight even if "active"
  // because the backend isn't actually running this agent on this route.
  if (!onPath) {
    return (
      <div className="relative rounded border border-border/10 overflow-hidden opacity-[0.18] transition-opacity duration-500">
        <div className="pl-3 pr-2.5 py-1.5 flex items-center gap-2">
          <span className="shrink-0 flex items-center justify-center w-3.5 h-3.5 text-muted-foreground/50">
            {icon}
          </span>
          <span className="text-[11.5px] font-semibold tracking-tight flex-1 truncate text-muted-foreground/60">
            {label}
          </span>
          <span className="text-[7.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground/40 shrink-0">
            bypass
          </span>
        </div>
      </div>
    )
  }

  // ── Spotlight: the agent currently running ──────────────────────────────
  if (state === 'active') {
    return (
      <div
        className="relative rounded-lg border-2 overflow-hidden transition-all duration-500"
        style={{
          borderColor: color,
          boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 12%, transparent), 0 12px 36px color-mix(in srgb, ${color} 22%, transparent)`,
        }}
      >
        {/* Color wash */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: color, opacity: 0.07 }} />
        {/* Top scan-bar — thicker than the old version */}
        <div className="absolute top-0 left-0 right-0 h-[3px] overflow-hidden">
          <div
            className="absolute top-0 bottom-0 w-2/5 pipeline-scan"
            style={{ background: `linear-gradient(90deg, transparent 0%, ${color} 50%, transparent 100%)` }}
          />
        </div>

        <div className="relative px-4 pt-4 pb-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <span
              className="text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ color }}
            >
              {role} · running
            </span>
            <div className="flex items-center gap-1.5">
              {elapsed > 0 && (
                <span className="text-[10px] font-mono tabular-nums" style={{ color }}>
                  {elapsed}s
                </span>
              )}
              <Loader2 className="h-3 w-3 animate-spin" style={{ color }} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Radar pulse + saturated icon disc */}
            <div className="relative shrink-0">
              <span
                className="absolute inset-0 rounded-full radar-pulse"
                style={{ background: color }}
              />
              <span
                className="absolute inset-0 rounded-full radar-pulse-2"
                style={{ background: color }}
              />
              <div
                className="relative h-10 w-10 rounded-full flex items-center justify-center text-white"
                style={{ background: color, boxShadow: `0 0 24px color-mix(in srgb, ${color} 55%, transparent)` }}
              >
                <span className="scale-150">{icon}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <h4
                className="text-[15px] font-bold tracking-tight leading-tight text-foreground"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                {label}
              </h4>
              {sublabel && (
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                  {sublabel}
                </p>
              )}
            </div>
            {badge && (
              <span
                className="text-[9px] font-bold uppercase tracking-[0.12em] rounded px-1.5 py-1 leading-none shrink-0 text-white"
                style={{ background: color }}
              >
                {badge}
              </span>
            )}
          </div>

          {question && (
            <div
              className="mt-3 pt-2.5 border-t"
              style={{ borderColor: `color-mix(in srgb, ${color} 22%, transparent)` }}
            >
              <p className="text-[10px] uppercase tracking-[0.16em] font-semibold mb-1" style={{ color }}>
                Task
              </p>
              <p className="text-[11.5px] text-foreground/85 leading-relaxed line-clamp-3">
                {question}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Compact: idle or done — recede so the spotlight reads ───────────────
  return (
    <div className={cn(
      'relative rounded border overflow-hidden transition-all duration-500',
      state === 'idle' && 'border-border/10 opacity-30',
      state === 'done' && 'border-border/40',
    )}>
      <div
        className="absolute left-0 top-0 bottom-0 w-[2px]"
        style={{ backgroundColor: state === 'done' ? 'hsl(var(--chart-3))' : 'transparent' }}
      />
      <div className="pl-3 pr-2.5 py-1.5 flex items-center gap-2">
        <span
          className="shrink-0 flex items-center justify-center w-3.5 h-3.5"
          style={{ color: state === 'idle' ? 'hsl(var(--muted-foreground) / 0.4)' : color }}
        >
          {icon}
        </span>
        <span className={cn(
          'text-[11.5px] font-semibold tracking-tight flex-1 truncate',
          state === 'idle' && 'text-muted-foreground/40',
          state === 'done' && 'text-muted-foreground/85',
        )}>
          {label}
        </span>
        {badge && state === 'done' && (
          <span className="text-[8px] font-medium text-muted-foreground/55 bg-muted border border-border/40 rounded px-1 py-0.5 leading-none shrink-0">
            {badge}
          </span>
        )}
        <span
          className="text-[7.5px] font-bold uppercase tracking-[0.12em] shrink-0"
          style={{
            color: state === 'idle' ? 'hsl(var(--muted-foreground) / 0.3)' : 'hsl(var(--chart-3))',
          }}
        >
          {state === 'idle' ? 'wait' : 'done'}
        </span>
        {state === 'done' && (
          <CheckCircle2 className="h-2.5 w-2.5 shrink-0" style={{ color: 'hsl(var(--chart-3))' }} />
        )}
      </div>
    </div>
  )
}

// Vertical connector between two nodes in the topology. State is derived
// from the *target* agent: if the target is running we animate flowing
// dashes in its color; if it's done we render a solid coloured stem.
function FlowConnector({
  state,
  color,
  onPath = true,
  variant = 'pipeline',
}: {
  state: NodeState
  color: string
  onPath?: boolean
  // 'pipeline' is a vertical centreline; 'branch' is a curved side path
  // used for the Router → Narrative alt route.
  variant?: 'pipeline' | 'branch'
}) {
  if (variant === 'branch') {
    return (
      <div className="relative h-12 w-full pointer-events-none">
        <svg viewBox="0 0 200 48" className="absolute inset-0 w-full h-full overflow-visible">
          <path
            d="M 100 0 C 100 22, 130 22, 160 30 L 180 36"
            stroke={onPath ? color : 'hsl(var(--border))'}
            strokeWidth={onPath ? 2 : 1}
            strokeDasharray={onPath && state === 'active' ? '4 4' : undefined}
            fill="none"
            opacity={onPath ? 1 : 0.25}
            className={onPath && state === 'active' ? 'flow-dash-svg' : undefined}
          />
          <polygon
            points="180,32 188,36 180,40"
            fill={onPath ? color : 'hsl(var(--border))'}
            opacity={onPath ? 1 : 0.25}
          />
        </svg>
        <span
          className="absolute right-1 top-1 text-[7.5px] font-bold uppercase tracking-[0.18em]"
          style={{ color: onPath ? color : 'hsl(var(--muted-foreground))', opacity: onPath ? 0.85 : 0.35 }}
        >
          alt path
        </span>
      </div>
    )
  }

  return (
    <div className="relative h-7 w-full pointer-events-none flex justify-center">
      {/* Stem */}
      <div
        className="absolute top-0 bottom-1.5 w-[2px] left-1/2 -translate-x-1/2 transition-opacity duration-300"
        style={{
          background: onPath
            ? (state === 'idle' ? 'hsl(var(--border))' : color)
            : 'hsl(var(--border))',
          opacity: onPath ? (state === 'idle' ? 0.4 : 1) : 0.18,
        }}
      />
      {/* Animated dash overlay when target agent is running */}
      {onPath && state === 'active' && (
        <div
          className="absolute top-0 bottom-1.5 w-[2px] left-1/2 -translate-x-1/2 flow-dash"
          style={{
            background: `repeating-linear-gradient(180deg, ${color} 0 6px, transparent 6px 12px)`,
          }}
        />
      )}
      {/* Arrowhead */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0"
        style={{
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `7px solid ${onPath ? (state === 'idle' ? 'hsl(var(--border))' : color) : 'hsl(var(--border))'}`,
          opacity: onPath ? (state === 'idle' ? 0.55 : 1) : 0.25,
        }}
      />
    </div>
  )
}

// Deterministic Final Brief terminator — no LLM, so it gets a different
// visual tier than the agent cards. Only rendered for the pipeline route.
function FinalBriefNode({ state }: { state: NodeState }) {
  return (
    <div
      className={cn(
        'relative rounded-lg border-2 border-dashed overflow-hidden transition-all duration-500',
        state === 'idle' && 'opacity-30',
      )}
      style={{
        borderColor: state === 'done'
          ? 'hsl(var(--chart-3))'
          : state === 'active'
            ? 'hsl(var(--chart-5))'
            : 'hsl(var(--border))',
      }}
    >
      <div className="px-3.5 py-2.5 flex items-center gap-2.5">
        <div
          className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 text-white"
          style={{
            background: state === 'done' ? 'hsl(var(--chart-3))' : 'hsl(var(--chart-5))',
          }}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-[12px] font-bold tracking-tight leading-none"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Final Brief
          </p>
        </div>
        <span
          className="text-[7.5px] font-bold uppercase tracking-[0.12em] shrink-0"
          style={{
            color: state === 'done' ? 'hsl(var(--chart-3))' : 'hsl(var(--muted-foreground))',
          }}
        >
          {state === 'done' ? 'ready' : state === 'active' ? 'composing' : 'pending'}
        </span>
      </div>
    </div>
  )
}

// Which agents are on the path for a given route? Used to fade off-path
// nodes + grey out the connectors that don't carry traffic.
function isOnPath(agent: string, route?: string): boolean {
  if (!route) return true // before classification, the whole graph is live
  if (route === 'pipeline') return ['discovery', 'investigation', 'validator'].includes(agent)
  if (route === 'narration') return agent === 'narrative'
  if (route === 'discovery') return agent === 'discovery'
  if (route === 'investigation') return agent === 'investigation'
  if (route === 'validation') return agent === 'validator'
  return false // out_of_scope or unknown
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

  function questionFor(name: string): string | undefined {
    // Prefer the most recent in-flight call; fall back to the last call we saw.
    const calls = toolCalls.filter((t) => t.name === name)
    const inflight = [...calls].reverse().find((t) => !t.done)
    return (inflight ?? calls[calls.length - 1])?.question
  }

  const routerState = nodeStateFor('router')
  const doneCount = toolCalls.filter((t) => t.done).length

  // Final Brief is implicit in the pipeline: ready once Validator finishes.
  // Never "active" on its own (no LLM call) — it goes idle → done.
  const finalBriefState: NodeState =
    nodeStateFor('validator') === 'done' ? 'done' : 'idle'

  const routeName = route?.route
  const pipelineActive = !routeName || routeName === 'pipeline'

  // Helper: state for the connector pointing AT a given agent. We look
  // at the agent below; if it's running or done, the connector inherits
  // that state so flow lights up in cascading fashion.
  const connectorTo = (agent: string): NodeState => nodeStateFor(agent)
  const colorOf = (agent: string): string =>
    PIPELINE_NODES.find((n) => n.name === agent)?.color ?? 'hsl(var(--primary))'

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
        @keyframes radar-pulse {
          0%   { transform: scale(1);   opacity: 0.55; }
          100% { transform: scale(2.2); opacity: 0;    }
        }
        .radar-pulse   { animation: radar-pulse 1.6s ease-out infinite; }
        .radar-pulse-2 { animation: radar-pulse 1.6s ease-out infinite; animation-delay: 0.8s; }
        @keyframes flow-dash {
          0%   { background-position: 0 0;  }
          100% { background-position: 0 24px; }
        }
        .flow-dash { animation: flow-dash 1.2s linear infinite; }
        @keyframes flow-dash-svg {
          0%   { stroke-dashoffset: 0;   }
          100% { stroke-dashoffset: -16; }
        }
        .flow-dash-svg { animation: flow-dash-svg 1.2s linear infinite; }
        @keyframes input-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0;  }
        }
        .input-shimmer {
          background: linear-gradient(90deg, transparent, currentColor 40%, transparent 80%);
          background-size: 200% 100%;
          animation: input-shimmer 2.4s linear infinite;
          opacity: 0.18;
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

      {/* Router — entry point of the topology */}
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
        question={questionFor('router')}
      />

      {/* ── Pipeline subgraph: Discovery → Investigation → Validator → Final Brief ── */}
      <FlowConnector
        state={connectorTo('discovery')}
        color={colorOf('discovery')}
        onPath={isOnPath('discovery', routeName)}
      />
      <AgentCard
        icon={PIPELINE_NODES[0].icon}
        color={PIPELINE_NODES[0].color}
        label={PIPELINE_NODES[0].label}
        role="agent"
        sublabel={PIPELINE_NODES[0].sublabel}
        state={nodeStateFor('discovery')}
        question={questionFor('discovery')}
        onPath={isOnPath('discovery', routeName)}
      />

      <FlowConnector
        state={connectorTo('investigation')}
        color={colorOf('investigation')}
        onPath={isOnPath('investigation', routeName)}
      />
      <AgentCard
        icon={PIPELINE_NODES[1].icon}
        color={PIPELINE_NODES[1].color}
        label={PIPELINE_NODES[1].label}
        role="agent"
        sublabel={PIPELINE_NODES[1].sublabel}
        state={nodeStateFor('investigation')}
        question={questionFor('investigation')}
        onPath={isOnPath('investigation', routeName)}
      />

      <FlowConnector
        state={connectorTo('validator')}
        color={colorOf('validator')}
        onPath={isOnPath('validator', routeName)}
      />
      <AgentCard
        icon={PIPELINE_NODES[2].icon}
        color={PIPELINE_NODES[2].color}
        label={PIPELINE_NODES[2].label}
        role="agent"
        sublabel={PIPELINE_NODES[2].sublabel}
        state={nodeStateFor('validator')}
        question={questionFor('validator')}
        onPath={isOnPath('validator', routeName)}
      />

      {/* Final Brief terminator — only meaningful on the pipeline route */}
      {pipelineActive && (
        <>
          <FlowConnector
            state={finalBriefState}
            color={'hsl(var(--chart-5))'}
            onPath={routeName === 'pipeline'}
          />
          <FinalBriefNode state={finalBriefState} />
        </>
      )}

      {/* ── Alt path: Narrative branches off the Router ── */}
      <div className="relative my-3">
        <div className="absolute inset-x-0 top-1/2 h-[1px] bg-border/40" />
        <div className="relative flex justify-center">
          <span
            className="bg-card/50 px-2 text-[8px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            alt route
          </span>
        </div>
      </div>

      <FlowConnector
        state={nodeStateFor('narrative')}
        color={colorOf('narrative')}
        onPath={isOnPath('narrative', routeName)}
        variant="branch"
      />
      <AgentCard
        icon={PIPELINE_NODES[3].icon}
        color={PIPELINE_NODES[3].color}
        label={PIPELINE_NODES[3].label}
        role="agent"
        sublabel={PIPELINE_NODES[3].sublabel}
        state={nodeStateFor('narrative')}
        question={questionFor('narrative')}
        onPath={isOnPath('narrative', routeName)}
      />
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

// Status sentence keyed to the running agent. Reads as a stream-of-work,
// not a generic "thinking" — the user sees what the backend is actually
// doing while the first card is still in flight.
const AGENT_NARRATION: Record<string, string> = {
  router: 'Routing your question',
  discovery: 'Mapping high-concentration categories',
  investigation: 'Computing HHI, CR-n, and Gini',
  validator: 'Cross-checking against sibling tables',
  narrative: 'Composing the brief',
}

function spotlightFor(activeAgent: string[] | null | undefined):
  { name: string; label: string; color: string } | null {
  const name = activeAgent?.[0]
  if (!name) return null
  if (name === 'router') return { name, label: 'Router', color: 'hsl(var(--primary))' }
  const node = PIPELINE_NODES.find((n) => n.name === name)
  return node
    ? { name, label: node.label, color: node.color }
    : { name, label: name, color: 'hsl(var(--primary))' }
}

// Empty assistant bubble while the agents are working. The whole subtree
// is keyed on `spot.name` so every agent transition triggers a fresh
// word-rise + pen-stroke reveal — each pipeline phase gets its own
// small narrative beat.
function ThinkingBlock({
  activeAgent,
}: {
  activeAgent?: string[] | null
}) {
  const spot = spotlightFor(activeAgent)
  const status = (spot && AGENT_NARRATION[spot.name]) ?? 'Thinking'
  const color = spot?.color ?? 'hsl(var(--primary))'
  const words = status.split(' ')

  return (
    <div className="relative" key={`${spot?.name ?? 'idle'}-${status}`}>
      <style>{`
        @keyframes word-rise {
          0%   { opacity: 0; transform: translateY(8px); filter: blur(4px); }
          100% { opacity: 1; transform: translateY(0);   filter: blur(0); }
        }
        .word-rise {
          opacity: 0;
          animation: word-rise 460ms cubic-bezier(0.22,1,0.36,1) forwards;
        }
        @keyframes cursor-blink {
          0%, 49%   { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .cursor-blink { animation: cursor-blink 0.85s step-end infinite; }
        @keyframes pen-stroke {
          0%   { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
        .pen-stroke {
          transform-origin: left center;
          animation: pen-stroke 800ms cubic-bezier(0.22,1,0.36,1) forwards;
        }
        @keyframes freq-bar {
          0%, 100% { transform: scaleY(0.28); opacity: 0.45; }
          50%      { transform: scaleY(1);    opacity: 1;    }
        }
        .freq-bar {
          transform-origin: bottom center;
          animation: freq-bar 1.05s ease-in-out infinite;
        }
      `}</style>

      {/* Status line — word-by-word reveal in the display font */}
      <p
        className="text-[14px] font-semibold tracking-tight leading-snug text-foreground/90 flex flex-wrap items-baseline"
        style={{ fontFamily: 'var(--font-syne)' }}
      >
        {words.map((w, i) => (
          <span
            key={i}
            className="word-rise inline-block whitespace-pre"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            {w}
            {i < words.length - 1 && ' '}
          </span>
        ))}
        {/* Block cursor in the agent color */}
        <span
          className="cursor-blink inline-block ml-1 h-[14px] w-[8px] align-baseline translate-y-[2px]"
          style={{
            background: color,
            animationDelay: `${words.length * 70 + 80}ms`,
          }}
        />
      </p>

      {/* Pen-stroke underline in the agent color — draws in after words land */}
      <div className="relative mt-2 h-[1.5px] overflow-hidden rounded-full">
        <div
          className="absolute inset-0 pen-stroke"
          style={{
            background: `linear-gradient(90deg, transparent, ${color} 40%, ${color} 60%, transparent)`,
            animationDelay: `${words.length * 70 + 200}ms`,
          }}
        />
      </div>

      {/* Frequency visualiser + agent label */}
      <div className="flex items-end gap-[3px] mt-3 h-[14px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="freq-bar block w-[3px] h-full rounded-full"
            style={{
              background: color,
              animationDelay: `${i * 110}ms`,
            }}
          />
        ))}
        {spot && (
          <span
            className="ml-2.5 text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ color, fontFamily: 'var(--font-syne)' }}
          >
            {spot.label}
          </span>
        )}
      </div>
    </div>
  )
}

function AssistantBlocks({
  blocks,
  streaming,
  activeAgent,
}: {
  blocks: Block[]
  streaming?: boolean
  activeAgent?: string[] | null
}) {
  // Empty + streaming = the agents are working but no card has arrived
  // yet. Show the narration block, not a static skeleton.
  if (blocks.length === 0 && streaming) {
    return <ThinkingBlock activeAgent={activeAgent} />
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

    // Capture the prior conversation BEFORE we push the new turn into
    // state. The backend gets this via /chat → orchestrator → specialists
    // so follow-up questions can refer to "that finding", "the IBM one",
    // "show me the trend" etc. without losing thread.
    const context = buildContext(messages)

    setInput('')
    setLoading(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', blocks: [{ type: 'text', value: query }] },
      { role: 'assistant', blocks: [], streaming: true, toolCalls: [] },
    ])

    try {
      for await (const update of pollChat(query, context)) {
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

  // What's the spotlight agent right now? Used to label the input scrim.
  const spotlight = spotlightFor(activeAgent)

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
                    <AssistantBlocks
                      blocks={msg.blocks}
                      streaming={msg.streaming}
                      activeAgent={msg.activeAgent}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right: trace panel — wider so the spotlight card breathes */}
          <div className="w-[400px] shrink-0 border-l border-border bg-card/50 overflow-y-auto px-5 py-5">
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

        {/* Input — when loading, the field dims and the submit button swaps
            to a spinner. The "what's running" signal lives in the right
            panel, so the input doesn't repeat it. */}
        <div className="relative shrink-0">
          <form onSubmit={handleSubmit} className="relative px-4 py-3.5 border-t border-border bg-card">
            <div
              className={cn(
                'relative flex items-center gap-2 bg-muted rounded-xl px-3.5 py-2.5 transition-all duration-300',
                loading
                  ? 'opacity-40 cursor-not-allowed'
                  : 'focus-within:ring-2 focus-within:ring-primary/30',
              )}
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={loading ? 'Waiting for the agent to finish…' : 'Ask about vendor concentration…'}
                disabled={loading}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 text-primary-foreground animate-spin" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5 text-primary-foreground" />
                )}
              </button>
            </div>

            {/* Bottom-edge shimmer in the active agent's color — a subtle
                'work happening' bar that reads even with the scrim. */}
            {loading && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
                <div
                  className="absolute inset-0 input-shimmer"
                  style={{ color: spotlight?.color ?? 'hsl(var(--primary))' }}
                />
              </div>
            )}
          </form>
        </div>
      </div>
    </div>,
    document.body
  )
}
