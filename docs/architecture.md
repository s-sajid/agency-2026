# Architecture — Vendor Concentration

> Source of truth for v4.0. Every decision in this document was derived from
> `docs/judges-context.md` (organizers' brief, datasets, scoring rubric) and the
> verbatim text of Challenge 5 (Vendor Concentration) fetched from the
> hackathon Luma page on 2026-04-28.
>
> All implementation choices below are load-bearing. Do not deviate without
> updating this file first.

---

## 1. Mission

Build an autonomous agent system that answers Challenge 5:

> *"In any given category of government spending, how many vendors are actually
> competing? Identify areas where a single supplier or a small group of
> suppliers receives a disproportionate share of contracts. Measure
> concentration by category, department, and region. Where has incumbency
> replaced competition? Where has government become dependent on a vendor it
> cannot walk away from?"*

The system must score **5/5 on each of the four scoring axes** (Impact, Agent
autonomy, Innovation, Presentation) — total 20/20.

---

## 2. Single-frame architecture

```
══════════════════════════════════════════════════════════════════════════════════════════════════════
                                  SYSTEM ARCHITECTURE  ·  one frame
            Vendor Concentration · Agency 2026 · AWS Bedrock + Strands + Next.js
══════════════════════════════════════════════════════════════════════════════════════════════════════

                                                  ┌─── EXTERNAL DATA SOURCES (read-only) ───────────┐
                                                  │                                                  │
                                                  │  ┌──────────────┐  ┌──────────────┐             │
                                                  │  │  Organizer   │  │ open.canada  │             │
                                                  │  │  Postgres    │  │   .ca PDC    │             │
                                                  │  │  AB · FED ·  │  │  federal     │             │
                                                  │  │  CRA · gen.  │  │  contracts   │             │
                                                  │  └──────┬───────┘  └──────┬───────┘             │
                                                  │         │ TLS SQL          │ HTTPS              │
                                                  │  ┌──────┴──────────────────┴───────────────┐    │
                                                  │  │ Government reference documents          │    │
                                                  │  │ TBS contracting · AB TB directives ·    │    │
                                                  │  │ DOJ HHI guidelines · StatCan Gini doc   │    │
                                                  │  └────────────────────┬─────────────────────┘   │
                                                  └───────────────────────┼─────────────────────────┘
                                                                          │ HTTPS
                                                                          ▼
   ┌────────────┐                                    ╔══════════════════════════════════════════════════╗
   │            │                                    ║   BACKEND  (deployed: AWS Bedrock AgentCore)     ║
   │   JUDGE    │                                    ║                       │                          ║
   │     👤     │                                    ║   ┌───────────────────▼──────────────────────┐   ║
   │            │                                    ║   │ INGEST + REFERENCES                      │   ║
   └─────┬──────┘                                    ║   │   live_sql.py     ── psycopg2 read-only  │   ║
         │ HTTPS                                     ║   │   open_canada_slicer.py ── parquet cache │   ║
         ▼                                           ║   │   build_references.py ── fetch+excerpt   │   ║
   ┌──────────────────────────────────┐              ║   │       │              │                   │   ║
   │  FRONTEND  (Next.js, GC-themed)  │              ║   │       ▼              ▼                   │   ║
   │                                  │              ║   │   DuckDB hot     references.json         │   ║
   │  ┌──────────────────────────┐    │              ║   │   cache          + excerpts/*.txt        │   ║
   │  │ Homepage                 │    │              ║   └────────────┬───────────────┬─────────────┘   ║
   │  │  3 sub-theme rows ×      │    │   POST /ask  ║                │ rows          │ id→URL+excerpt  ║
   │  │  story cards             │    │   GET /story ║                ▼               ▼                 ║
   │  │  click → replay recorded │◀───┼──/reference──╣   ┌──────────────────────────────────────────┐   ║
   │  │  SSE stream + chart      │    │   /audit     ║   │ MATH  (deterministic · no LLM · trust    │   ║
   │  └──────────────────────────┘    │   over SSE   ║   │        boundary)                         │   ║
   │                                  │              ║   │  hhi · cr_n · gini ·                     │   ║
   │  ┌──────────────────────────┐    │              ║   │  sole_source_rate · incumbency_streak ·  │   ║
   │  │ Chat (sticky bottom)     │    │              ║   │  vendor_footprint · competition_count ·  │   ║
   │  │  ask → live D→I→V→N      │    │              ║   │  cross_dataset_lookup · divergence_check │   ║
   │  │  trace + chart at end    │    │              ║   │  + explainers.py (formula_id → popover   │   ║
   │  └──────────────────────────┘    │              ║   │                    + reference_id)       │   ║
   │                                  │              ║   │  every fn returns:                       │   ║
   │  Shared components:              │              ║   │  { value, sql, rows, trace, refs[] }     │   ║
   │  • StoryTrace                    │              ║   └────────────────────┬─────────────────────┘   ║
   │  • ⓘ FormulaInfo popover         │              ║                        │ Strands @tool           ║
   │  • Audit drawer (SQL + rows)     │              ║                        ▼                          ║
   │  • ChartView (Recharts, gov)     │              ║   ┌──────────────────────────────────────────┐   ║
   │  • ReferencesList                │              ║   │ AGENT PIPELINE                           │   ║
   │                                  │              ║   │ Strands SDK · Claude Sonnet 4 (Bedrock)  │   ║
   │  Theme: Alberta-blue primary,    │              ║   │                                          │   ║
   │  maple-red risk-only, Inter,     │              ║   │   ┌─────┐  ┌──────┐  ┌─────┐  ┌─────┐    │   ║
   │  WCAG AA, restrained cards       │              ║   │   │  D  │─▶│  I   │─▶│  V  │─▶│  N  │    │   ║
   └──────────────────────────────────┘              ║   │   └─────┘  └──────┘  └──┬──┘  └──┬──┘    │   ║
                                                     ║   │      ▲                  │        │       │   ║
                                                     ║   │      └─── divergence ───┘        │       │   ║
                                                     ║   │                                  │ trace │   ║
                                                     ║   │  Validator gates (block ship if):│ bus   │   ║
                                                     ║   │  ✗ numeric claim w/o tool_call_id│       │   ║
                                                     ║   │  ✗ context claim w/o ref_id 200  │       │   ║
                                                     ║   │  ✗ formula w/o explainer entry   │       │   ║
                                                     ║   └──────────────────────────────────┼───────┘   ║
                                                     ║                                      │ events    ║
                                                     ║   ┌──────────────────────────────────▼───────┐   ║
                                                     ║   │ API SERVICE (FastAPI on AgentCore)       │   ║
                                                     ║   │  POST /ask     start pipeline → SSE      │   ║
                                                     ║   │  GET  /story/:id   replay recorded run   │   ║
                                                     ║   │  GET  /reference/:id  URL + excerpt      │   ║
                                                     ║   │  GET  /audit/:call_id  SQL + raw rows    │   ║
                                                     ║   └──────────────────────────────────────────┘   ║
                                                     ║                                                  ║
                                                     ║   ┌── OFFLINE / CI ───────────────────────────┐  ║
                                                     ║   │ stories/*.sse.jsonl   recorded pipeline   │  ║
                                                     ║   │                       runs → homepage     │  ║
                                                     ║   │ eval/known_cases.py   pytest regression   │  ║
                                                     ║   │ build_references.py   fail build on 4xx   │  ║
                                                     ║   └────────────────────────────────────────────┘  ║
                                                     ╚══════════════════════════════════════════════════╝
```

**Reading the diagram in 5 hops, left to right:**

1. Judge interacts with the Frontend (HTTPS).
2. Frontend calls four backend endpoints over SSE/HTTPS: `/ask` (live trace),
   `/story/:id` (recorded story replay), `/reference/:id` (resolve URL +
   excerpt), `/audit/:call_id` (SQL + raw rows).
3. API Service receives `/ask` → spins up the Agent Pipeline
   (Discovery → Investigation → Validator → Narrative, with V→D loop on
   divergence).
4. Agents call deterministic Math functions (Strands `@tool`); Math reads
   from the DuckDB hot cache or live Postgres, plus the references registry.
   Math is the trust boundary — agents never invent numbers.
5. Validator gates fire before Narrative ships; any unsourced claim is
   dropped, not softened. Output streams back as SSE events the Frontend
   renders into the StoryTrace.

---

## 3. Data scope

| Source | Tables / endpoint | Used for |
|---|---|---|
| **Organizer Postgres — AB** | `ab.ab_sole_source`, `ab.ab_contracts`, `ab.ab_grants`, `ab.ab_non_profits` | Provincial procurement concentration (sole-source AND competitive — a "competitive" category with one repeat winner is still concentrated). Provincial grants because vendor lock-in hides there too. |
| **Organizer Postgres — FED** | `fed.grants_contributions` | Federal recipient concentration; cross-jurisdiction lock-in checks. |
| **Organizer Postgres — CRA** | `cra.t3010` filings | Context-only lookup: confirm a recipient is a real operating charity vs. a shell. |
| **Organizer Postgres — general** | `general.entity_match` golden records | The spine for every cross-table comparison. |
| **Augmentation** | `open.canada.ca` Proactive Disclosure of Contracts (federal procurement contracts) | Federal *contracts* (not in the organizer DB) — ingested as a parquet slice on event day so cross-jurisdiction story works for contracts, not just grants. |
| **Reference docs** (citation, not data) | TBS contracting policy · Alberta Treasury Board procurement directives · DOJ/FTC HHI guidelines · Statistics Canada Gini methodology · NAICS code definitions | Quoted with URL + accessed-date in `references/`; resolved via `/reference/:id`. |

**Homepage banner reads:** *"Vendor Concentration — Canadian government
spending across Alberta procurement, federal grants & contracts, and charity
filings."* Not "Alberta sole-source."

---

## 4. The 4-agent pipeline (every chat question runs this)

```
USER QUESTION
   │
   ▼
DISCOVERY — "How do I unravel this question? What slice of data matters?"
   ─ reframes question into a measurable claim
   ─ picks the relevant dataset(s), category, dimension
   ─ decides which deterministic tool(s) to invoke
   ─ output: investigation plan + first SQL
   │
   ▼
INVESTIGATION — "What does the data actually say?"
   ─ runs the deterministic math tools
   ─ pulls candidate rows, vendors, ministries
   ─ returns numbers WITH SOURCES — every figure carries a tool_call_id
   ─ output: findings table + the surprising entities
   │
   ▼
VALIDATOR — "Is this real or an artifact? Cross-check it."
   ─ re-runs the same question against a SECOND source:
       • finer-grained SQL on the same table
       • sibling table (ab.ab_contracts vs ab.ab_sole_source)
       • cross-jurisdiction (general.entity_match → fed.* / open.canada.ca)
   ─ compares numbers via divergence_check; reports MATCH / DIVERGE / PARTIAL
   ─ rules out by-design singletons (RCMP, Receiver General, etc.)
   ─ programmatic gates (must pass before Narrative ships):
       ✓ every numeric claim has a tool_call_id
       ✓ every context claim has a reference_id (URL 200 + excerpt present)
       ✓ every formula has math/explainers.py entry
   ─ on DIVERGE: loops back to Discovery for one refinement turn
   │
   ▼
NARRATIVE — "Tell me the story. Show me the picture."
   ─ one-paragraph plain-English story for non-technical Minister
   ─ surfaces the "Huh, that's interesting" line explicitly
   ─ picks ONE chart type that fits the finding (table / bar / timeline / heatmap)
   ─ tags every finding with its sub-theme (Efficiency / Integrity / Alignment)
   ─ cites every number back to a tool_call_id
```

The agent layer is Strands SDK on AWS Bedrock (Claude Sonnet 4). Agents
**reason about which tools to call**; tools compute deterministic numbers.
Agents never produce a number that did not come back from a tool result.

---

## 5. The math layer (deterministic, the trust boundary)

Pure SQL/Python. No LLM. Every function returns:

```python
{
    "value": <number>,
    "sql": <string>,              # the exact query that produced it
    "source_rows": [...],         # sample of underlying rows for audit
    "trace_steps": [...],         # per-term arithmetic for the ⓘ popover
    "formula_id": "hhi",          # key into math/explainers.py
    "references": ["doj_hhi"],    # registry IDs (may be empty for pure counts)
}
```

**Functions ship in v4.0:**

| Module | Function | What it computes | Reference |
|---|---|---|---|
| `math/concentration.py` | `hhi(category)` | Σ(market_shareᵢ)² over vendors | DOJ/FTC Horizontal Merger Guidelines §5.3 |
| `math/concentration.py` | `cr_n(category, n)` | Top-n combined share (CR1, CR4) | Standard industrial-org textbook |
| `math/concentration.py` | `gini(category)` | Inequality of contract value distribution | Statistics Canada Gini methodology |
| `math/procurement.py` | `sole_source_rate(scope)` | $ sole-source / $ total | Pure ratio — no external citation |
| `math/procurement.py` | `incumbency_streak(vendor, category)` | Max consecutive fiscal years same vendor wins | Pure count |
| `math/procurement.py` | `vendor_footprint(vendor)` | Distinct (ministry, category) pairs | Pure count |
| `math/procurement.py` | `competition_count(category)` | Distinct vendors who ever won | Pure count |
| `math/crosscheck.py` | `cross_dataset_lookup(entity)` | Same entity totals across AB / FED / open.canada.ca via `general.entity_match` | — |
| `math/crosscheck.py` | `divergence_check(a, b)` | Δ% between two computations of "same" number | Pure arithmetic |
| `math/explainers.py` | (registry) | `formula_id → { plain_english, formula_text, interpretation_bands, reference_id, compute_trace_template }` | — |

**No invented metrics.** No `lockin_score`, no `temporal_zscore`, no custom
"risk index". If a formula isn't in a textbook, government policy doc, or
standard methodology page, it doesn't ship.

---

## 6. Sourcing discipline — references registry

Every claim made on a card or in a chat answer falls into one of two types:

| Claim type | Example | Source = |
|---|---|---|
| **Data claim** | "Vendor X holds 100% of category Y, $40M over 6 years." | The SQL + raw rows, exposed via the `/audit/:call_id` drawer. |
| **Context claim** | "This violates Alberta's competitive-bidding policy." | A real public document — URL + accessed-date + quoted excerpt in `references/`. |

**Hard rule: no context claim without a `reference_id` that resolves in
`references/references.json`. If we cannot find a real source on event day,
the claim is dropped, not softened.** No exceptions.

```
references/
├── references.json        registry: id → { title, url, accessed_date, excerpt_file }
└── excerpts/
    ├── doj_hhi.txt        actual paragraph quoted, with URL header
    ├── statcan_gini.txt
    ├── ab_tb_directive.txt
    └── ...
```

`build_references.py` runs at build time:
- fetches every URL in `references.json`
- archives the response excerpt
- **fails the build** if any URL returns 4xx/5xx
- Validator agent re-resolves on every pipeline run

References are fetched live on event day from real sources. **Never
pre-written from memory.**

---

## 7. Validator gates (programmatic, block-on-fail)

Before any Narrative output is emitted to the frontend, the Validator runs
three programmatic checks. Failure on any check drops the offending claim or
holds the entire card back from display.

| Gate | Condition | Failure mode |
|---|---|---|
| **Numeric sourcing** | Every number in Narrative output is tagged with a `tool_call_id` that resolves in this run's trace | Drop the claim |
| **Context sourcing** | Every context claim has a `reference_id` resolving in `references.json`; URL responded 200 within last N hours; excerpt is non-empty | Drop the claim |
| **Formula explainability** | Every `formula_id` used has a non-empty entry in `math/explainers.py` with `plain_english` and (where required) a resolvable `reference_id` | Hold the card; alert in trace |

Unsourced claims never reach a judge's screen.

---

## 8. The frontend (Next.js · Canadian-government themed)

### Visual language

| Element | Choice | Rationale |
|---|---|---|
| Type | Inter (system fallback) | Close to GC Design System Lato; Tailwind default; WCAG-accessible |
| Primary color | `#005FA3` (Alberta blue) | Alberta judges in the room; primary actions only |
| Risk accent | `#D52B1E` (maple red) | High-concentration warnings ONLY; never decorative |
| Neutrals | `#F5F5F5` page bg, `#1A1A1A` text, `#D9D9D9` borders | High contrast, WCAG AA |
| Cards | white bg, 1px `#D9D9D9` border, `rounded-md` | Restrained — no gradients, no glassmorphism |
| Charts | Recharts; mono blue gradient; red on `risk = high` | Govt restraint, signal-only color |
| Icons | lucide-react (line, not filled) | Clean, neutral |
| Density | Generous whitespace, max-w-5xl, 16px base | Reads like a government publication, not a SaaS dashboard |
| Accessibility | WCAG AA contrast minimum, semantic HTML, keyboard nav, focus rings, no color-only signaling, ≥44px tap targets | Mandatory |

### Page layout

1. **Identifier strip (top)** — *"Built for Agency 2026 · National AI
   Hackathon · Government of Alberta · Datasets: open.alberta.ca ·
   open.canada.ca · CRA T3010"*
2. **Hero** — Challenge title and subtitle.
3. **Three sub-theme sections** — each headed with the verbatim
   organizers' definition (from `judges-context.md` Source 1):
   - **Efficiency** — *"Is the money being well spent? Identifying areas
     where funding may not be delivering expected public value."*
   - **Integrity** — *"Are there opportunities to strengthen or put
     safeguards in place to ensure those gaps are closed?…"*
   - **Alignment** — *"Does the spending align with what is being
     stated?…"*
   Each section holds 1–2 story cards. Click a card → expands inline,
   replays the recorded SSE trace (Discovery → Investigation → Validator
   → Narrative), ends with the chart.
4. **Chat panel (sticky bottom)** — single text input → live `/ask`
   pipeline trace renders in the same UI as the cards.
5. **Footer — References + Datasets + Repo link** — every URL we cited,
   accessed-date, repo link.

### Shared components

- `StoryTrace` — renders D→I→V→N events from SSE / replay
- `FormulaInfo` — `ⓘ` popover (plain English + formula + interpretation
  bands + **live computation trace** + reference URL & excerpt)
- `Audit` — drawer showing SQL + sample rows for any `tool_call_id`
- `ChartView` — Recharts, gov palette, mono blue + red on risk
- `ReferencesList` — footer citation list

---

## 9. Sub-theme mapping (Vendor Concentration ↔ organizers' three sub-themes)

| Sub-theme | What it means for Vendor Concentration | Tools used |
|---|---|---|
| **Efficiency** — is the money well spent? | Is government overpaying because there's no competition? Are sole-source rates rising in categories that *could* be competitive? | `sole_source_rate`, `competition_count`, `hhi` |
| **Integrity** — safeguards & gaps | Categories with only 1–2 capable suppliers (capacity gap). Same vendor winning under multiple legal entity names (entity-match shenanigans). | `competition_count`, `cross_dataset_lookup`, `vendor_footprint`, entity-match dedup |
| **Alignment** — does spend match policy? | Sole-source share trending against stated procurement-modernization preference (only claimed when the actual policy text is fetched and quoted in `references/`). Where federal/provincial spend priorities diverge from procurement reality. | `sole_source_rate` time series, ministry breakdown, `cross_dataset_lookup` |

Narrative tags every finding with which sub-theme it speaks to → homepage
groups stories under those three headings.

---

## 10. Repo layout (≤10 source files in agent + web)

```
hackathon-agency-2026/
├── docs/
│   ├── judges-context.md          ✓ verbatim source material
│   ├── architecture.md            ✓ this document
│   └── pitch.md                   3-min demo script
├── math/
│   ├── concentration.py           hhi, cr_n, gini
│   ├── procurement.py             sole_source_rate, incumbency_streak,
│   │                               vendor_footprint, competition_count
│   ├── crosscheck.py              cross_dataset_lookup, divergence_check
│   └── explainers.py              formula_id → popover content
├── references/
│   ├── references.json            registry (id → URL + excerpt path)
│   └── excerpts/                  fetched paragraphs (immutable, git'd)
├── ingest/
│   ├── live_sql.py                psycopg2 read-only runner
│   ├── open_canada_slicer.py      federal contracts → parquet
│   └── build_references.py        fetch + archive + URL validation
├── agents/
│   ├── pipeline.py                Strands D→I→V→N + divergence loop
│   ├── prompts.py                 per-agent system prompts
│   └── server.py                  FastAPI + SSE + AgentCore entrypoint
├── web/app/
│   ├── page.tsx                   homepage + chat
│   ├── components/
│   │   ├── StoryTrace.tsx
│   │   ├── FormulaInfo.tsx        ⓘ popover
│   │   ├── Audit.tsx              SQL + rows drawer
│   │   ├── ChartView.tsx
│   │   └── ReferencesList.tsx
│   └── api/ask/route.ts           SSE proxy
├── stories/                       recorded SSE traces for homepage cards
├── eval/known_cases.py            pytest regression on 5 known monopolies
├── .env.example
├── README.md
└── CLAUDE.md
```

---

## 11. Build sequence (6 hours on event day)

| Hour | Deliverable | Verification |
|---|---|---|
| 1 | Postgres probe live, AB sole-source signal confirmed; `math/concentration.py` + `math/procurement.py` (3 of the 7 functions) | Each function callable, returns shape contract |
| 2 | Remaining math functions; `math/explainers.py`; `references/` registry seeded with HHI, Gini, NAICS; `build_references.py` passing | `pytest eval/known_cases.py` passes for 3+ findings |
| 3 | `agents/pipeline.py` D→I→V→N + Validator gates wired; one end-to-end run on a known prompt; SSE event schema locked | Live `POST /ask` returns ordered events; Validator drops a planted unsourced claim |
| 4 | Frontend scaffold (Next.js, GC theme), StoryTrace + FormulaInfo + Audit + Chart components; SSE wiring | Live demo of one chat question end-to-end |
| 5 | Pre-bake 6 stories (`bake_story.py` × 6 prompts → `stories/*.sse.jsonl`); homepage 3 sub-theme rows render replays; cached fallback verified | All 6 cards replay without backend |
| 6 | `pitch.md` written; demo rehearsal ×3; `eval/known_cases.py` green; AgentCore deployment confirmed | Demo runs in 3:00 ±15s |

---

## 12. What we are explicitly not doing

| Dropped | Why |
|---|---|
| Pre-computed parquet "Atlas" | Hides the agent's work; judges want to see the work happen |
| Invented composite metrics (`lockin_score`, `temporal_zscore`, custom risk indices) | Client rejected v3.x for this; non-technical judges can't verify; not in any textbook |
| Sunburst, heatmap, complex charts | "Pretty over substance" warned against; sortable tables and bar charts are auditable |
| Pre-written policy references "from memory" | Hallucination risk; references are fetched live, validated by `build_references.py`, or the claim is dropped |
| Eval-vs-Validator architectural split | Over-engineered; one pytest harness + Validator gates is enough |
| Three-cloud demo (AWS + GCP + Azure) | 6 hours; pick AWS (we already learned Bedrock + Strands + AgentCore in v3.x) |
| 30+ source files | Client said v3.x structure was too confusing; ≤10 source files in agent + web |
