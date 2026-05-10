// SSE client for the Modal-hosted backend.
//
// POST /chat returns {job_id}; the frontend opens an EventSource on
// GET /chat/stream/:job_id and consumes events in real time. The same
// ChatEvent shape (text / tool / tool_done / tool_result) is preserved
// so ChatDrawer keeps working unchanged.
//
// On Vercel the frontend lives at a different origin from the backend,
// so set NEXT_PUBLIC_BACKEND_URL to the Modal endpoint (e.g.
// https://<workspace>--vendor-agent-web.modal.run). For `pnpm dev`
// against a local uvicorn, use http://localhost:8000.

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

// A single tick yields either a chat event extracted from the SSE
// stream, or a status update carrying the authoritative `active_agent`
// field that the right-side panel uses to show what's running.
// The shape is unchanged from the polling era, so ChatDrawer doesn't
// know the transport flipped.
export type PollUpdate =
  | { type: 'event'; event: ChatEvent }
  | { type: 'status'; activeAgent: string[] | null; status: JobStatus['status'] }

interface SseStatusPayload {
  status: JobStatus['status']
  result?: unknown
  route?: { route: string; reason: string }
  error?: string
}

interface SseActivePayload {
  agents: string[] | null
}

// Bridge an EventSource into an async generator. Yields PollUpdate
// values matching the previous polling contract.
export async function* pollChat(query: string, context = ''): AsyncGenerator<PollUpdate, void, unknown> {
  const jobId = await createJob(query, context)
  const url = `${BACKEND_URL}/chat/stream/${jobId}`
  const source = new EventSource(url)

  // Single-slot async queue: producer (onmessage) hands off to consumer
  // (the generator). If the consumer hasn't taken the previous item yet,
  // we buffer in `pending`.
  const pending: Array<PollUpdate | { type: '__end'; error?: Error }> = []
  let resolver: (() => void) | null = null
  const wake = () => {
    if (resolver) {
      const r = resolver
      resolver = null
      r()
    }
  }

  source.onmessage = (e) => {
    let raw: RawEvent | { kind: 'status'; payload: SseStatusPayload } | { kind: 'active_agent'; payload: SseActivePayload }
    try {
      raw = JSON.parse(e.data)
    } catch {
      return
    }
    if (raw.kind === 'status') {
      const p = raw.payload as SseStatusPayload
      pending.push({ type: 'status', activeAgent: null, status: p.status })
      if (p.status === 'error') {
        pending.push({ type: '__end', error: new Error(p.error ?? 'job failed') })
      } else if (p.status === 'complete') {
        pending.push({ type: '__end' })
      }
    } else if (raw.kind === 'active_agent') {
      const p = raw.payload as SseActivePayload
      pending.push({ type: 'status', activeAgent: p.agents, status: 'running' })
    } else if (raw.kind === 'error') {
      const err = String((raw.payload as { error?: string }).error ?? 'agent error')
      pending.push({ type: '__end', error: new Error(err) })
    } else {
      const ev = rawToChatEvent(raw as RawEvent)
      if (ev) pending.push({ type: 'event', event: ev })
    }
    wake()
  }

  source.onerror = () => {
    // Treat connection drop as terminal — caller can retry by reissuing
    // the query (which will hit the prompt cache and pick up the
    // already-running job).
    pending.push({ type: '__end', error: new Error('SSE connection lost') })
    wake()
  }

  try {
    while (true) {
      if (pending.length === 0) {
        await new Promise<void>((r) => { resolver = r })
      }
      const next = pending.shift()!
      if (next.type === '__end') {
        if (next.error) throw next.error
        return
      }
      yield next
    }
  } finally {
    source.close()
  }
}

// Backwards-compat shim — strips status updates so existing tests and
// any chat-event-only callers keep working unchanged.
export async function* streamChatEvents(query: string, context = ''): AsyncGenerator<ChatEvent, void, unknown> {
  for await (const u of pollChat(query, context)) {
    if (u.type === 'event') yield u.event
  }
}

// Retained for the notification-dossier modal, which fetches a
// historical job snapshot rather than streaming.
export async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  return fetchStatus(jobId)
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

// ── Auto-scan notifications ───────────────────────────────────────────────────

export interface NotificationHit {
  metric: string
  value: number
  interpretation?: string
  call_id?: string
}

export interface Notification {
  notification_id: string
  created_at: string
  source_job_id: string
  question: string
  headline?: string
  summary?: string
  verdict?: 'MATCH' | 'PARTIAL' | 'DIVERGE' | 'INSUFFICIENT_DATA'
  confidence?: 'high' | 'medium' | 'low'
  sub_theme?: 'Efficiency' | 'Integrity' | 'Alignment'
  entity?: string
  hits: NotificationHit[]
}

export interface NotificationsResponse {
  items: Notification[]
  count: number
}

// Bypass the disk cache here — notifications are the one place a user
// actively wants up-to-the-second freshness when the panel is open.
export async function fetchNotifications(limit = 25): Promise<NotificationsResponse> {
  const res = await fetch(`${BACKEND_URL}/notifications?limit=${limit}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<NotificationsResponse>
}
