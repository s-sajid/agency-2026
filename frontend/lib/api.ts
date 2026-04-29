// Async-polling client for the App Runner backend.
//
// The original funding-loops repo streamed events over SSE from POST /chat.
// This deployment uses the agency-prep-deploy job-queue shape: POST /chat
// returns a job_id; the frontend polls GET /status/:id every ~1s and
// reconstructs the chat state from the appended `events` log.
//
// In production the static frontend is bundled into the same App Runner
// image as the FastAPI backend, so relative paths just work.
// For `pnpm dev`, set NEXT_PUBLIC_BACKEND_URL=http://localhost:8000.

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ''

export type ToolResult =
  | {
      kind: 'discovery_plan'
      data: {
        scope?: string
        candidates?: Array<{ category: string; top_vendor: string; cat_total: number; top1_share_pct: number; call_id?: string }>
        next_actions?: string[]
        sub_theme?: string
        honest_caveats?: string[]
      }
      call_id?: string
    }
  | {
      kind: 'findings'
      data: {
        headline?: string
        metrics?: Array<{ name: string; value: number | string; call_id?: string; interpretation?: string }>
        supporting_facts?: Array<{ fact: string; call_id?: string }>
        interesting_moments?: string[]
      }
      call_id?: string
    }
  | {
      kind: 'verdict'
      data: {
        verdict?: 'MATCH' | 'PARTIAL' | 'DIVERGE'
        confidence?: 'high' | 'medium' | 'low'
        checks_run?: Array<{ what: string; value_a: number; value_b: number; verdict: string; call_id?: string }>
        cross_dataset?: { appears_in?: string[]; canonical_name?: string; call_id?: string }
        ruled_out?: string[]
        honest_caveats?: string[]
      }
      call_id?: string
    }
  | {
      kind:
        | 'hhi'
        | 'cr_n'
        | 'gini'
        | 'sole_source_rate'
        | 'incumbency_streak'
        | 'vendor_footprint'
        | 'competition_count'
        | 'cross_dataset_lookup'
        | 'divergence_check'
        | 'top_concentrated_categories'
      data: {
        value: unknown
        inputs?: Record<string, unknown>
        trace_preview?: Array<Record<string, unknown>>
        rows_preview?: Array<Record<string, unknown>>
        references?: string[]
      }
      call_id?: string
    }
  | {
      kind: 'final_brief'
      data: {
        headline?: string
        summary?: string
        metrics_table?: Array<{ metric: string; value: string; interpretation?: string; call_id?: string | null }>
        sub_theme?: 'Efficiency' | 'Integrity' | 'Alignment'
        verdict?: 'MATCH' | 'PARTIAL' | 'DIVERGE'
        confidence?: 'high' | 'medium' | 'low'
        recommendation?: string
        caveats?: string[]
      }
      call_id?: string
    }
  | {
      kind: 'route'
      data: { route: string; reason: string }
      call_id?: string
    }

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; label: string; question: string }
  | { type: 'tool_done'; name: string }
  | { type: 'tool_result'; result: ToolResult }

interface RawEvent {
  kind: 'text' | 'tool' | 'tool_done' | 'tool_result' | 'error' | 'route' | 'audit'
  payload: Record<string, unknown>
}

export interface JobStatus {
  job_id: string
  status: 'pending' | 'running' | 'complete' | 'error'
  events: RawEvent[]
  active_agent: string[] | null
  result: unknown
  route?: { route: string; reason: string }
  error?: string
}

function rawToChatEvent(raw: RawEvent): ChatEvent | null {
  const p = raw.payload as Record<string, unknown>
  switch (raw.kind) {
    case 'text':
      return { type: 'text', text: String(p.text ?? '') }
    case 'tool':
      return {
        type: 'tool',
        name: String(p.tool ?? ''),
        label: String(p.label ?? p.tool ?? ''),
        question: String(p.question ?? ''),
      }
    case 'tool_done':
      return { type: 'tool_done', name: String(p.tool_done ?? '') }
    case 'tool_result':
      return {
        type: 'tool_result',
        result: { kind: p.kind, data: p.data, call_id: p.call_id } as ToolResult,
      }
    default:
      return null
  }
}

export async function createJob(message: string, context = ''): Promise<string> {
  const r = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context }),
  })
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`)
  const j = (await r.json()) as { job_id: string }
  return j.job_id
}

async function fetchStatus(jobId: string): Promise<JobStatus> {
  const r = await fetch(`${BACKEND_URL}/status/${jobId}`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const POLL_MS = 1000

// A single tick in the polling cycle yields either a chat event extracted
// from the appended events log, or a status update with the authoritative
// `active_agent` field that the right-side panel uses to show what's
// currently running on the backend (vs. the cumulative events log, which
// only reflects what has *happened*).
export type PollUpdate =
  | { type: 'event'; event: ChatEvent }
  | { type: 'status'; activeAgent: string[] | null; status: JobStatus['status'] }

export async function* pollChat(query: string, context = ''): AsyncGenerator<PollUpdate, void, unknown> {
  const jobId = await createJob(query, context)
  let cursor = 0

  while (true) {
    const status = await fetchStatus(jobId)

    if (status.events.length > cursor) {
      for (let i = cursor; i < status.events.length; i++) {
        const raw = status.events[i]
        if (raw.kind === 'error') {
          throw new Error(String((raw.payload as { error?: string }).error ?? 'agent error'))
        }
        const ev = rawToChatEvent(raw)
        if (ev) yield { type: 'event', event: ev }
      }
      cursor = status.events.length
    }

    yield { type: 'status', activeAgent: status.active_agent, status: status.status }

    if (status.status === 'error') throw new Error(status.error ?? 'job failed')
    if (status.status === 'complete') return

    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

// Backwards-compat shim — strips poll-status updates so existing tests and
// any chat-event-only callers keep working unchanged.
export async function* streamChatEvents(query: string, context = ''): AsyncGenerator<ChatEvent, void, unknown> {
  for await (const u of pollChat(query, context)) {
    if (u.type === 'event') yield u.event
  }
}

// ── dashboards (formerly proxied through Next.js /api/* — now direct) ─────────

// Default fetch caching — browser respects the backend's `Cache-Control:
// public, max-age=300` so warm reloads serve from the disk cache instead
// of hitting the network. Server-side TTL cache + browser cache both
// expire on a 5-minute clock so they stay in sync.
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export function fetchMetrics() {
  return getJson<import('./types').DashboardMetrics>('/dashboard/metrics')
}

export function fetchTopVendors(limit = 10) {
  return getJson<Array<{ recipient: string; contract_count: number; total_amount: number }>>(
    `/dashboard/top-vendors?limit=${limit}`
  )
}

export function fetchConcentration(limit = 5) {
  return getJson<import('./types').ConcentrationResult[]>(`/dashboard/concentration?limit=${limit}`)
}

export function fetchSpendByYear() {
  return getJson<import('./types').SpendByYear[]>('/dashboard/spend-by-year')
}

export function fetchConcentrationTrend() {
  return getJson<import('./types').ConcentrationTrendPoint[]>('/dashboard/concentration-trend')
}

export function fetchConcentrationScatter() {
  return getJson<import('./types').ConcentrationScatterPoint[]>('/dashboard/concentration-scatter')
}

export function fetchVendorDominance(limit = 12) {
  return getJson<import('./types').VendorDominancePoint[]>(`/dashboard/vendor-dominance?limit=${limit}`)
}

export function fetchVendorCompetition() {
  return getJson<import('./types').VendorCompetitionPoint[]>('/dashboard/vendor-competition')
}

export function fetchContractDistribution() {
  return getJson<import('./types').ContractDistributionBucket[]>('/dashboard/contract-distribution')
}
