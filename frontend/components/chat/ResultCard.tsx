'use client'

/**
 * Renders a structured card for a {tool_result} SSE event. Per-kind
 * dispatch. The chat thread interleaves these with Narrative text.
 *
 * Goals:
 *   - Compact (one card = ~3 lines tall)
 *   - Bounded width (never overflows the chat bubble)
 *   - Verifiable (every number has its tool_call_id under the hood)
 *
 * No prose, no JSON dumps in the UI.
 */

import { cn } from '@/lib/utils'
import type { ToolResult } from '@/lib/api'

// ─── HHI band helper (DOJ/FTC) ───────────────────────────────────────────
function hhiBand(v: number): { label: string; color: string } {
  if (v > 2500) return { label: 'highly concentrated', color: 'hsl(var(--destructive))' }
  if (v >= 1500) return { label: 'moderately concentrated', color: 'hsl(var(--chart-1))' }
  return { label: 'competitive', color: 'hsl(var(--chart-3))' }
}

function fmtMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtPct(n: number): string {
  return `${n.toFixed(n < 10 ? 2 : 1)}%`
}

// ─── Reusable shells ─────────────────────────────────────────────────────
function Shell({
  title,
  pill,
  pillColor,
  children,
}: {
  title: string
  pill?: string
  pillColor?: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-border/60 bg-card rounded-md px-3 py-2 my-2 max-w-full overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          {title}
        </span>
        {pill && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              color: pillColor ?? 'hsl(var(--muted-foreground))',
              border: `1px solid ${pillColor ?? 'hsl(var(--border))'}`,
            }}
          >
            {pill}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{label}</span>
      <span className="text-sm font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  )
}

/** Two-column key/value table — used for every "this is one finding" card.
 *  Field on the left (uppercase, muted), value on the right (foreground).
 *  Bounded width, breaks on words. The visual primitive for everything
 *  the user wants in "Excel" form.
 */
function KvTable({ rows, header }: { rows: Array<{ k: string; v: React.ReactNode }>; header?: [string, string] }) {
  if (rows.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border border-border/40 rounded">
        {header && (
          <thead>
            <tr className="bg-muted text-foreground">
              <th className="text-left font-semibold px-2 py-1 w-[140px]">{header[0]}</th>
              <th className="text-left font-semibold px-2 py-1">{header[1]}</th>
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn(i > 0 && 'border-t border-border/30')}>
              <td className="px-2 py-1.5 align-top font-semibold text-muted-foreground uppercase tracking-wider text-[10px] bg-muted/40 w-[140px]">
                {r.k}
              </td>
              <td className="px-2 py-1.5 align-top text-foreground break-words leading-snug">
                {r.v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Per-kind cards ──────────────────────────────────────────────────────

function HhiCard({ data }: { data: any }) {
  const v = Number(data.value ?? 0)
  const band = hhiBand(v)
  const cat = data.inputs?.category as string | undefined
  return (
    <Shell title="HHI (Herfindahl-Hirschman Index)" pill={band.label} pillColor={band.color}>
      <KvTable rows={[
        { k: 'Metric', v: 'HHI' },
        { k: 'Value', v: <span className="font-bold tabular-nums" style={{ color: band.color }}>{v.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> },
        { k: 'Range', v: '0 – 10,000 (raw integer, NOT a percentage)' },
        { k: 'Interpretation', v: band.label },
        ...(cat ? [{ k: 'Category', v: cat }] : []),
      ]} />
    </Shell>
  )
}

function CrNCard({ data }: { data: any }) {
  const v = Number(data.value ?? 0)
  const n = data.inputs?.n as number | undefined
  const cat = data.inputs?.category as string | undefined
  return (
    <Shell title={`CR_${n ?? 'n'} — Concentration Ratio`} pill={n === 1 ? 'top vendor share' : `top ${n} share`}>
      <KvTable rows={[
        { k: 'Metric', v: `CR_${n ?? 'n'}` },
        { k: 'Value', v: <span className="font-bold tabular-nums">{fmtPct(v)}</span> },
        { k: 'Meaning', v: n === 1 ? "Largest single vendor's share of category spend" : `Top ${n} vendors' combined share` },
        ...(cat ? [{ k: 'Category', v: cat }] : []),
      ]} />
    </Shell>
  )
}

function GiniCard({ data }: { data: any }) {
  const v = Number(data.value ?? 0)
  const cat = data.inputs?.category as string | undefined
  return (
    <Shell title="Gini coefficient" pill={v > 0.6 ? 'highly unequal' : v > 0.3 ? 'moderate' : 'equal'}>
      <KvTable rows={[
        { k: 'Metric', v: 'Gini' },
        { k: 'Value', v: <span className="font-bold tabular-nums">{v.toFixed(4)}</span> },
        { k: 'Range', v: '0 (equal) – 1 (one vendor takes everything)' },
        ...(cat ? [{ k: 'Category', v: cat }] : []),
      ]} />
    </Shell>
  )
}

function SoleSourceRateCard({ data }: { data: any }) {
  const v = Number(data.value ?? 0)
  const ministry = data.inputs?.ministry as string | undefined
  const fy = data.inputs?.fiscal_year as string | undefined
  return (
    <Shell title="Sole-source rate" pill={v > 30 ? 'sole-source dominant' : v > 10 ? 'mixed' : 'mostly competitive'}>
      <KvTable rows={[
        { k: 'Metric', v: 'Sole-source rate' },
        { k: 'Value', v: <span className="font-bold tabular-nums">{fmtPct(v)}</span> },
        { k: 'Meaning', v: 'Share of procurement $ awarded WITHOUT competitive bid' },
        { k: 'Scope', v: ministry ?? 'all of Alberta' },
        ...(fy ? [{ k: 'Fiscal year', v: fy }] : []),
      ]} />
    </Shell>
  )
}

function CompetitionCountCard({ data }: { data: any }) {
  const v = Number(data.value ?? 0)
  const cat = data.inputs?.category as string | undefined
  return (
    <Shell title="Distinct vendor count" pill={v <= 2 ? 'very thin' : v < 10 ? 'limited' : 'healthy'}>
      <KvTable rows={[
        { k: 'Metric', v: 'Distinct vendors' },
        { k: 'Value', v: <span className="font-bold tabular-nums">{v.toLocaleString()}</span> },
        { k: 'Meaning', v: 'Number of unique vendors that have ever appeared in this category' },
        ...(cat ? [{ k: 'Category', v: cat }] : []),
      ]} />
    </Shell>
  )
}

function IncumbencyCard({ data }: { data: any }) {
  const v = Number(data.value ?? 0)
  const vendor = data.inputs?.vendor as string | undefined
  const cat = data.inputs?.category as string | undefined
  return (
    <Shell title="Incumbency streak" pill={v > 5 ? 'entrenched' : v >= 3 ? 'established' : 'short'}>
      <KvTable rows={[
        { k: 'Metric', v: 'Incumbency streak' },
        { k: 'Value', v: <span className="font-bold tabular-nums">{v} year{v === 1 ? '' : 's'}</span> },
        { k: 'Meaning', v: 'Longest run of consecutive fiscal years where this vendor held contracts in this category' },
        ...(vendor ? [{ k: 'Vendor', v: vendor }] : []),
        ...(cat ? [{ k: 'Category', v: cat }] : []),
      ]} />
    </Shell>
  )
}

function VendorFootprintCard({ data }: { data: any }) {
  const d = data.value ?? {}
  const ministries: string[] = d.ministries ?? []
  return (
    <Shell title="Vendor footprint">
      <KvTable rows={[
        { k: 'Vendor', v: <span className="font-semibold">{data.inputs?.vendor ?? '—'}</span> },
        { k: 'Contracts', v: <span className="tabular-nums">{Number(d.contract_count ?? 0).toLocaleString()}</span> },
        { k: 'Total awarded', v: <span className="tabular-nums">{fmtMoney(Number(d.total_amount ?? 0))}</span> },
        { k: 'Ministries', v: <span className="tabular-nums">{Number(d.ministry_count ?? 0)}</span> },
        { k: 'Categories', v: <span className="tabular-nums">{Number(d.category_count ?? 0)}</span> },
        { k: 'Year range', v: `${d.first_year ?? '?'} → ${d.last_year ?? '?'}` },
        ...(ministries.length > 0 ? [{
          k: 'Ministry list',
          v: <span className="leading-relaxed">{ministries.join(', ')}</span>
        }] : []),
      ]} />
    </Shell>
  )
}

function CrossDatasetCard({ data }: { data: any }) {
  const d = data.value ?? {}
  const sources: string[] = d.dataset_sources ?? []
  return (
    <Shell title="Cross-dataset lookup" pill={d.matched ? 'matched' : 'no match'}>
      <KvTable rows={d.matched ? [
        { k: 'Searched', v: data.inputs?.vendor_name ?? '—' },
        { k: 'Canonical name', v: <span className="font-semibold">{d.canonical_name}</span> },
        { k: 'Entity type', v: d.entity_type ?? '—' },
        { k: 'Datasets', v: <span className="font-mono">{sources.join(', ')}</span> },
        { k: 'In CRA', v: d.appears_in_cra ? 'Yes' : 'No' },
        { k: 'In FED', v: d.appears_in_fed ? 'Yes' : 'No' },
        { k: 'In AB', v: d.appears_in_ab ? 'Yes' : 'No' },
        { k: 'Source links', v: <span className="tabular-nums">{Number(d.source_link_count ?? 0).toLocaleString()}</span> },
      ] : [
        { k: 'Searched', v: d.vendor_name_searched ?? '—' },
        { k: 'Result', v: <span className="text-muted-foreground italic">No entity_golden_records hit for that name.</span> },
      ]} />
    </Shell>
  )
}

function DivergenceCard({ data }: { data: any }) {
  const d = data.value ?? {}
  const v = (d.verdict ?? 'MATCH') as 'MATCH' | 'PARTIAL' | 'DIVERGE'
  const colors = {
    MATCH: 'hsl(var(--chart-3))',
    PARTIAL: 'hsl(var(--chart-1))',
    DIVERGE: 'hsl(var(--destructive))',
  }
  const labels = data.labels ?? { a: 'A', b: 'B' }
  return (
    <Shell title="Cross-check (divergence)" pill={v} pillColor={colors[v]}>
      <KvTable rows={[
        { k: 'Verdict', v: <span className="font-bold uppercase tracking-wider" style={{ color: colors[v] }}>{v}</span> },
        { k: labels.a ?? 'A', v: <span className="tabular-nums">{Number(d.value_a ?? 0).toLocaleString()}</span> },
        { k: labels.b ?? 'B', v: <span className="tabular-nums">{Number(d.value_b ?? 0).toLocaleString()}</span> },
        { k: 'Δ absolute', v: <span className="tabular-nums">{Number(d.delta_abs ?? 0).toLocaleString()}</span> },
        { k: 'Δ percent', v: <span className="tabular-nums" style={{ color: colors[v] }}>{(d.delta_pct ?? 0).toFixed(2)}%</span> },
      ]} />
    </Shell>
  )
}

function CategoriesCard({ data }: { data: any }) {
  const rows: any[] = Array.isArray(data.value) ? data.value : []
  return (
    <Shell title="Top concentrated categories">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border border-border/40 rounded">
          <thead>
            <tr className="bg-muted text-foreground">
              <th className="text-left font-semibold px-2 py-1 w-[28px]">#</th>
              <th className="text-left font-semibold px-2 py-1">Top vendor</th>
              <th className="text-right font-semibold px-2 py-1 w-[90px]">Total spend</th>
              <th className="text-right font-semibold px-2 py-1 w-[80px]" title="Top-1 vendor's share of total spend in this category">
                Top-1 share
              </th>
              <th className="text-left font-semibold px-2 py-1">Category</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((r, i) => (
              <tr key={i} className="border-t border-border/30 align-top">
                <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-2 py-1.5 break-words leading-snug">{r.top_vendor}</td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtMoney(Number(r.cat_total))}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">{fmtPct(Number(r.top1_share_pct))}</td>
                <td className="px-2 py-1.5 break-words leading-snug text-muted-foreground">{r.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  )
}

function DiscoveryPlanCard({ data }: { data: any }) {
  const candidates: any[] = data.candidates ?? []
  return (
    <Shell title="Discovery plan" pill={data.sub_theme}>
      {data.scope && (
        <div className="text-[11px] text-muted-foreground mb-2 break-words leading-snug">
          {data.scope}
        </div>
      )}
      {candidates.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border border-border/40 rounded">
            <thead>
              <tr className="bg-muted text-foreground">
                <th className="text-left font-semibold px-2 py-1 w-[28px]">#</th>
                <th className="text-left font-semibold px-2 py-1">Top vendor</th>
                <th className="text-right font-semibold px-2 py-1 w-[90px]">Total spend</th>
                <th className="text-right font-semibold px-2 py-1 w-[80px]" title="Top-1 vendor's share of total spend in this category">
                  Top-1 share
                </th>
                <th className="text-left font-semibold px-2 py-1">Category</th>
              </tr>
            </thead>
            <tbody>
              {candidates.slice(0, 5).map((c, i) => (
                <tr key={i} className="border-t border-border/30 align-top">
                  <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-2 py-1.5 break-words leading-snug">{c.top_vendor}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtMoney(Number(c.cat_total ?? 0))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">{fmtPct(Number(c.top1_share_pct ?? 0))}</td>
                  <td className="px-2 py-1.5 break-words leading-snug text-muted-foreground">{c.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-muted-foreground/70 italic mt-1 px-1 leading-snug">
            <strong>Top-1 share</strong> = the largest single vendor's share of all spend in that category. 100% means a single supplier holds the entire category.
          </div>
        </div>
      )}
    </Shell>
  )
}

function FindingsCard({ data }: { data: any }) {
  const metrics: any[] = data.metrics ?? []
  const facts: any[] = data.supporting_facts ?? []
  const moments: string[] = data.interesting_moments ?? []
  return (
    <Shell title="Findings">
      {data.headline && (
        <KvTable rows={[
          { k: 'Headline', v: <span className="font-semibold">{data.headline}</span> },
        ]} />
      )}
      {metrics.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase mb-1">Metrics</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border border-border/40 rounded">
              <thead>
                <tr className="bg-muted text-foreground">
                  <th className="text-left font-semibold px-2 py-1">Metric</th>
                  <th className="text-right font-semibold px-2 py-1 w-[90px]">Value</th>
                  <th className="text-left font-semibold px-2 py-1">Interpretation</th>
                </tr>
              </thead>
              <tbody>
                {metrics.slice(0, 6).map((m, i) => (
                  <tr key={i} className="border-t border-border/30 align-top">
                    <td className="px-2 py-1.5 break-words leading-snug font-medium">{m.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {typeof m.value === 'number'
                        ? (String(m.name).toLowerCase().includes('hhi')
                            ? m.value.toLocaleString(undefined, { maximumFractionDigits: 0 })
                            : m.value.toLocaleString(undefined, { maximumFractionDigits: 2 }))
                        : String(m.value)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground break-words leading-snug">{m.interpretation ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {facts.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase mb-1">Supporting facts</div>
          <table className="w-full text-[11px] border border-border/40 rounded">
            <tbody>
              {facts.slice(0, 5).map((f, i) => (
                <tr key={i} className={cn(i > 0 && 'border-t border-border/30')}>
                  <td className="px-2 py-1.5 align-top text-muted-foreground tabular-nums text-[10px] bg-muted/40 w-[28px]">{i + 1}</td>
                  <td className="px-2 py-1.5 align-top text-foreground break-words leading-snug">{f.fact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {moments.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase mb-1">Notable patterns</div>
          <table className="w-full text-[11px] border border-border/40 rounded">
            <tbody>
              {moments.slice(0, 3).map((m, i) => (
                <tr key={i} className={cn(i > 0 && 'border-t border-border/30')}>
                  <td className="px-2 py-1.5 align-top text-muted-foreground tabular-nums text-[10px] bg-muted/40 w-[28px]">{i + 1}</td>
                  <td className="px-2 py-1.5 align-top text-foreground break-words leading-snug">{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}

function VerdictCard({ data }: { data: any }) {
  const v = (data.verdict ?? 'MATCH') as 'MATCH' | 'PARTIAL' | 'DIVERGE' | 'INSUFFICIENT_DATA'
  const colors: Record<string, string> = {
    MATCH: 'hsl(var(--chart-3))',
    PARTIAL: 'hsl(var(--chart-1))',
    DIVERGE: 'hsl(var(--destructive))',
    INSUFFICIENT_DATA: 'hsl(var(--muted-foreground))',
  }
  const checks: any[] = data.checks_run ?? []
  const xd = data.cross_dataset
  const ruled: string[] = data.ruled_out ?? []
  return (
    <Shell title="Validator verdict" pill={`${v} · ${data.confidence ?? '—'}`} pillColor={colors[v]}>
      <KvTable rows={[
        { k: 'Verdict', v: <span className="font-bold uppercase tracking-wider" style={{ color: colors[v] }}>{v}</span> },
        { k: 'Confidence', v: data.confidence ?? '—' },
        ...(xd?.canonical_name ? [
          { k: 'Cross-jurisdiction', v: <span className="font-semibold">{xd.canonical_name}</span> },
          { k: 'Appears in', v: <span className="font-mono">{(xd.appears_in ?? []).join(', ') || '—'}</span> },
        ] : []),
      ]} />
      {checks.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase mb-1">Checks run</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border border-border/40 rounded">
              <thead>
                <tr className="bg-muted text-foreground">
                  <th className="text-left font-semibold px-2 py-1 w-[90px]">Check verdict</th>
                  <th className="text-left font-semibold px-2 py-1">What was compared</th>
                  <th className="text-right font-semibold px-2 py-1 w-[90px]">Value A</th>
                  <th className="text-right font-semibold px-2 py-1 w-[90px]">Value B</th>
                </tr>
              </thead>
              <tbody>
                {checks.slice(0, 3).map((c, i) => (
                  <tr key={i} className="border-t border-border/30 align-top">
                    <td className="px-2 py-1.5 font-bold uppercase tracking-wider" style={{ color: colors[c.verdict] }}>
                      {c.verdict}
                    </td>
                    <td className="px-2 py-1.5 break-words leading-snug">{c.what}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {typeof c.value_a === 'number' ? c.value_a.toLocaleString() : c.value_a}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {typeof c.value_b === 'number' ? c.value_b.toLocaleString() : c.value_b}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {ruled.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase mb-1">Ruled out</div>
          <table className="w-full text-[11px] border border-border/40 rounded">
            <tbody>
              {ruled.slice(0, 3).map((r, i) => (
                <tr key={i} className={cn(i > 0 && 'border-t border-border/30')}>
                  <td className="px-2 py-1.5 align-top text-muted-foreground tabular-nums text-[10px] bg-muted/40 w-[28px]">{i + 1}</td>
                  <td className="px-2 py-1.5 align-top text-foreground break-words leading-snug">{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}

// ─── Final Brief — the headline answer card for full pipeline runs ───────
// Fully tabular. Every field is a row in either a key-value summary
// table or the metrics table or the caveats table. No prose paragraphs.

function FinalBriefCard({ data }: { data: any }) {
  const verdict = (data.verdict ?? null) as 'MATCH' | 'PARTIAL' | 'DIVERGE' | null
  const conf = data.confidence as string | undefined
  const sub = data.sub_theme as string | undefined
  const metrics: Array<{ metric: string; value: string; interpretation?: string }> = data.metrics_table ?? []
  const caveats: string[] = data.caveats ?? []
  const verdictColor = verdict === 'DIVERGE' ? 'hsl(var(--destructive))'
                     : verdict === 'PARTIAL' ? 'hsl(var(--chart-1))'
                     : verdict === 'MATCH'   ? 'hsl(var(--chart-3))' : undefined

  // Build the summary key-value rows from whichever fields are present
  const summaryRows: Array<{ k: string; v: React.ReactNode }> = []
  if (data.headline) summaryRows.push({ k: 'Headline', v: <span className="font-semibold">{data.headline}</span> })
  if (data.summary) summaryRows.push({ k: 'Summary', v: data.summary })
  if (sub) summaryRows.push({
    k: 'Sub-theme',
    v: <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">{sub}</span>,
  })
  if (verdict) summaryRows.push({
    k: 'Verdict',
    v: <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border"
        style={{ color: verdictColor, borderColor: verdictColor }}>{verdict}</span>,
  })
  if (conf) summaryRows.push({
    k: 'Confidence',
    v: <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">{conf}</span>,
  })
  if (data.recommendation) summaryRows.push({ k: 'Recommendation', v: <span className="italic">{data.recommendation}</span> })

  return (
    <div className="border border-border/70 bg-card rounded-lg px-3 py-2.5 my-2 w-full">
      <div className="text-[10px] font-bold tracking-[0.12em] text-primary uppercase mb-2">
        Final Brief
      </div>

      {/* Summary key-value table */}
      {summaryRows.length > 0 && (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-[11px] border border-border/40 rounded table-fixed">
            <colgroup>
              <col style={{ width: '110px' }} />
              <col />
            </colgroup>
            <tbody>
              {summaryRows.map((r, i) => (
                <tr key={i} className={cn(i > 0 && 'border-t border-border/30')}>
                  <td className="px-2 py-1.5 align-top font-semibold text-muted-foreground uppercase tracking-wider text-[10px] bg-muted/40">
                    {r.k}
                  </td>
                  <td className="px-2 py-1.5 align-top text-foreground break-words leading-snug">
                    {r.v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Metrics table */}
      {metrics.length > 0 && (
        <>
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase mb-1">Metrics</div>
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-[11px] border border-border/40 rounded">
              <thead>
                <tr className="bg-muted text-foreground">
                  <th className="text-left font-semibold px-2 py-1">Metric</th>
                  <th className="text-right font-semibold px-2 py-1 w-[80px]">Value</th>
                  <th className="text-left font-semibold px-2 py-1">Interpretation</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m, i) => (
                  <tr key={i} className="border-t border-border/30">
                    <td className="px-2 py-1 font-medium align-top break-words">{m.metric}</td>
                    <td className="px-2 py-1 text-right tabular-nums align-top whitespace-nowrap">{m.value}</td>
                    <td className="px-2 py-1 text-muted-foreground align-top break-words leading-snug">{m.interpretation ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Caveats table */}
      {caveats.length > 0 && (
        <>
          <div className="text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase mb-1">Caveats</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border border-border/40 rounded">
              <tbody>
                {caveats.slice(0, 4).map((c, i) => (
                  <tr key={i} className={cn(i > 0 && 'border-t border-border/30')}>
                    <td className="px-2 py-1.5 align-top text-muted-foreground tabular-nums text-[10px] bg-muted/40 w-[28px]">
                      {i + 1}
                    </td>
                    <td className="px-2 py-1.5 align-top text-foreground break-words leading-snug">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// Route is intentionally NOT rendered in the chat thread — the Router card
// in the right-side trace panel already conveys "the agent classified the
// question." The route metadata is captured in `useRouteFromBlocks` below
// and used by PipelinePanel to badge the Router card.

// ─── Dispatch ────────────────────────────────────────────────────────────

const RENDERERS: Record<string, (props: { data: any }) => React.ReactElement> = {
  hhi: HhiCard,
  cr_n: CrNCard,
  gini: GiniCard,
  sole_source_rate: SoleSourceRateCard,
  competition_count: CompetitionCountCard,
  incumbency_streak: IncumbencyCard,
  vendor_footprint: VendorFootprintCard,
  cross_dataset_lookup: CrossDatasetCard,
  divergence_check: DivergenceCard,
  top_concentrated_categories: CategoriesCard,
  discovery_plan: DiscoveryPlanCard,
  findings: FindingsCard,
  verdict: VerdictCard,
  final_brief: FinalBriefCard,
  // 'route' kind has no renderer — the chat thread skips it via
  // the early-return in ResultCard below; the trace panel uses it
  // as a badge on the Router card.
}

export function ResultCard({ result }: { result: ToolResult }) {
  // route metadata is shown in the trace panel, not the chat thread
  if (result.kind === 'route') return null
  const R = RENDERERS[result.kind]
  if (!R) {
    return (
      <Shell title={result.kind}>
        <span className="text-[11px] text-muted-foreground">(no specialized renderer)</span>
      </Shell>
    )
  }
  return <R data={(result as any).data} />
}
