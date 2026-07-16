# graphify — the repo's knowledge graph

This repo carries a queryable knowledge graph of its own code and docs, built with [graphify](https://github.com/sponsors/safishamsi) (the `graphifyy` Python package plus the `/graphify` Claude Code skill). The graph turns "read 80K tokens of source to answer one architecture question" into "traverse a ~15K-token subgraph" — measured at **~5.6× fewer tokens per query** on this corpus, and far higher for broad questions ("what are the core abstractions" benchmarked at ~96×).

Everything lives in `graphify-out/` (gitignored — the graph is a **local, per-machine artifact**; each clone rebuilds its own, and a cache makes rebuilds cheap).

## What the graph contains

Two extraction layers feed one graph:

- **Structural (AST)** — deterministic tree-sitter parsing of all code (`.ts`, `.tsx`, configs, `.sql`). Functions, components, types, imports, calls, re-exports. Free: no LLM, no API key, runs in seconds.
- **Semantic (LLM)** — concept extraction from `docs/`, `README`s, and images. Named concepts (e.g. *Schema Supported-Floor Posture*, *D1 Sync Sidecar*), design rationale, cross-document links, and inferred connections between docs and code.

Every edge carries an honesty tag — `EXTRACTED` (explicit in source), `INFERRED` (reasoned, with a calibrated confidence score), or `AMBIGUOUS` (flagged uncertain) — so you can always tell a fact from a guess. Nodes are grouped into labeled communities (e.g. *Focus Mode Concepts*, *D1 Sync Sidecar*, *Backup Guards & Fingerprints*), and the report surfaces **god nodes** (most-connected abstractions — `useDayPlan()` is this repo's biggest by far) and **surprising connections** across community boundaries.

## Outputs

| File | What it is |
|---|---|
| `graphify-out/graph.html` | Interactive visualization — open directly in a browser, no server. Search, zoom, community coloring. |
| `graphify-out/GRAPH_REPORT.md` | The audit report: god nodes, surprising connections, community cohesion scores, suggested questions, token cost. |
| `graphify-out/graph.json` | Raw graph data (GraphRAG-ready node-link JSON). What queries traverse. |
| `graphify-out/cache/` | Per-file extraction cache — unchanged files are never re-extracted, so rebuilds only pay for what changed. |
| `graphify-out/cost.json` | Cumulative token-spend ledger across runs. |

## Quick start

All commands below are Claude Code slash commands (the skill drives the `graphify` CLI for you):

```
/graphify .                    # full build (first time, or full rebuild)
/graphify . --update           # incremental — re-extract only new/changed files
/graphify query "<question>"   # answer a question from the graph
/graphify path "A" "B"         # shortest path between two concepts
/graphify explain "<node>"     # plain-language explanation of one node
```

The skill installs `graphifyy` automatically (via `uv` or `pip`) if missing. **No API key is required** — code extraction is pure AST, and doc/image extraction is done by the agent itself (this repo's first full build of ~50 docs/images cost ~790K session tokens). Keys are optional and change *who pays*: the skill auto-detects `GEMINI_API_KEY`/`GOOGLE_API_KEY` and offloads semantic extraction to cheap headless Gemini calls; the standalone CLI goes further — `graphify extract` accepts `--backend gemini|kimi|claude|openai|deepseek|ollama` (including self-hosted OpenAI-compatible servers; `ollama` is fully local and zero-cost). With no key at all, the agent is the LLM — nothing ever blocks a build.

## Using the graph with an agent

This is the primary use case. When `graphify-out/graph.json` exists, the `/graphify` skill takes a **fast path**: a natural-language question skips the build pipeline entirely and goes straight to query.

```
/graphify query "How does the habit reconciliation flow work?"
/graphify query "What calls guardIdentitySwitch?" --dfs
/graphify query "Trace data flow from Dashboard to D1" --budget 3000
```

- **BFS (default)** — broad context: "what is X connected to?"
- **`--dfs`** — trace a specific chain: "how does X reach Y?"
- **`--budget N`** — cap the traversal output at ~N tokens (default 2000).

Good agent-shaped questions play to the graph's strengths:

- *Impact analysis* — "what touches `useDayPlan`?" before refactoring a god node. `graphify affected "X"` is purpose-built for this: a **reverse traversal** (what depends on X), with `--relation` and `--depth` filters.
- *Cross-boundary tracing* — "what connects Focus Mode to the engagement history archive?"
- *Doc↔code drift* — "which concepts in data-model.md have no corresponding code node?"
- *Onboarding* — "what are the core abstractions?" answered structurally instead of by reading everything.

Two things to know about how querying works under the hood:

1. **Vocabulary matching is literal** — substring-based, no synonyms or stemming. The skill compensates by expanding your question against the graph's actual vocabulary first (and shows you the expansion), but questions phrased in the repo's own vocabulary (entity names from [data-model.md](./data-model.md), component names) get the best starting nodes.
2. **Answers feed back into the graph.** The agent saves each Q&A via `graphify save-result` with an outcome tag (`useful` / `dead_end` / `corrected`); `graphify reflect` distills these into `graphify-out/reflections/LESSONS.md` — preferred sources, known dead ends, prior corrections — which future sessions read before graph work. The graph gets better at answering the more it is used.

For always-on integration, `graphify claude install` writes a `## graphify` section into `CLAUDE.md`; this repo keeps a hand-written pointer there instead (see [CLAUDE.md](../CLAUDE.md)). For access from other tools, `/graphify . --mcp` exposes query/path/explain as an MCP stdio server.

## Where model quality matters (construction vs. traversal)

- **Construction, AST layer** — deterministic parsing; model-irrelevant. ~80% of this repo's nodes.
- **Construction, semantic layer** — fully model-dependent. A stronger model gives better concept selection, calibrated confidence, more genuine cross-document links, and better **node-ID discipline** (weak models drift from the ID format and create orphan ghost nodes — the main avoidable source of dangling edges).
- **Traversal (query time)** — the graph fixes what gets retrieved; the model synthesizes the answer. A stronger model reasons better over the same subgraph, but can't recover links that extraction never made.

The asymmetry that matters: **construction quality is durable** — extraction errors persist across sessions and compound into every future query, while traversal quality is paid per-question. If budgeting model strength, spend it on construction; a code-heavy corpus like this one is forgiving because AST dominates.

## Maintaining the graph

Four maintenance tiers, cheapest first:

| Mechanism | Covers | Cost |
|---|---|---|
| `graphify hook install` (git hooks) | Code — AST re-run on each commit and branch switch, automatic | Free |
| `graphify update .` (bare CLI) | Code — same AST re-run, by hand; `--force` permits a shrinking rebuild after deleting code | Free |
| `/graphify . --update` (skill) | Everything — docs included | Tokens for changed docs only |
| `/graphify .` (full rebuild) | Everything, from re-detection | Cache absorbs unchanged files |

### Full rebuild vs. incremental — which and when

- **`--update` (incremental)** diffs the corpus against the saved manifest: re-extracts only new/changed files, prunes deleted ones. Use for routine maintenance.
- **Full `/graphify .`** re-detects everything. Use when the *rules of the build* change rather than the files — `.graphifyignore` edits, a newly installed parser (e.g. the SQL extra), a graphifyy upgrade, or a graph that looks structurally wrong. Incremental can't apply these, because unchanged files are skipped by design. "Full" is rarely expensive: the cache absorbs everything unchanged.
- **Exports never rebuild.** `graphify export wiki|html`, `tree`, and `callflow-html` render the existing `graph.json`. Passing an export flag to a bare build (`/graphify . --wiki`) runs the whole pipeline *and then* exports — to refresh just the artifact, call the export directly.

Practical cadence for this repo:

- **Install the git hooks once per clone** (`graphify hook install`) — hooks live in `.git/hooks` and don't travel with the repo. Once installed, code maintains itself; doc changes are ignored by the hooks by design. The hook pins `PYTHONHASHSEED=0` so clustering is reproducible.
- **Refresh docs at milestones, not per edit.** The documentation discipline updates docs in the same commit as code — but the doc *concept* layer drifts far slower than doc prose (concepts like the schema floor are stable; wording churns). Run `--update` when a plan lands in `history/`, a living doc is substantially rewritten, or the session-start staleness nudge fires.
- **`--cluster-only`** re-runs community detection and regenerates report/HTML with no re-extraction — for when community labels feel stale.
- **`--watch`** runs a background watcher: code rebuilds instantly (AST-only); doc changes set a `needs_update` flag. Suited to long agentic sessions.
- **`/graphify add <url>`** pulls external material (webpage, arXiv paper, PDF, tweet, video) into `./raw` and merges it into the graph.

One safety property worth knowing: the exporter **refuses to shrink** `graph.json` (override with `--force` when the shrink is intentional), and an empty extraction aborts before writing. A stale graph is recoverable; a corrupted one is not.

### Automating doc updates (`--update`)

The hooks keep code current for free, but semantic re-extraction needs an LLM, so it can't be free *and* automatic. Options, most automatic first:

1. **Headless with an API key** — wire `graphify extract . --backend gemini` (or `claude`/`openai`/`deepseek`/`ollama`) into the post-commit hook or a scheduled task; the cache means only changed docs cost anything, and `--update` disappears as a manual step.
2. **Automate the trigger, not the LLM** — a Claude Code SessionStart hook probes staleness; when it fires, the session opens with a "graph is stale" nudge the agent handles in-session. No key needed; token cost on the plan. (graphify's own `check-update` only reads a flag that `--watch` sets — the git hooks never set it — hence an mtime-based probe.)
3. **Headless Claude per commit** (`claude -p "/graphify . --update"`) — works, but spawns a full session per doc commit; expensive relative to option 1.

**This repo wires option 2, deliberately coarse.** Because the documentation discipline touches docs on most passes, a per-edit trigger would nudge constantly for marginal gain. The probe (in `.claude/settings.json`) stays silent below a threshold and only nudges when **≥3 docs are newer than `graph.json`, or at least one is and the graph is >7 days old** — batching doc refreshes toward milestones.

## The CLI beyond the skill

The `/graphify` skill drives the common flows; the `graphify` CLI has a wider surface (`graphify --help` for everything):

| Command | What it does |
|---|---|
| `graphify query` / `path` / `explain` | The traversal trio — usable directly in any shell. |
| `graphify affected "X"` | **Reverse** traversal: everything impacted by X. The pre-refactor question. |
| `graphify extract <path>` | Headless full pipeline for CI/scripts — `--backend`, `--mode deep`, `--code-only`, even `--postgres DSN` to map a live database schema. |
| `graphify update <path>` | Code-only incremental re-extraction, no LLM. What the git hook runs. |
| `graphify check-update <path>` | Cron-safe probe: is semantic re-extraction pending? |
| `graphify label` / `cluster-only --backend=…` | (Re)name communities with an LLM backend headlessly. |
| `graphify tree` | D3 collapsible-tree HTML — filesystem-hierarchy navigation, complementary to `graph.html`. |
| `graphify export callflow-html` | Mermaid-based architecture/call-flow HTML. |
| `graphify save-result` / `reflect` | The work-memory loop: persist Q&A outcomes, distill into `LESSONS.md`. |
| `graphify global add/list/remove` | Cross-repo global graph (`~/.graphify/global-graph.json`) for cross-project queries. |
| `graphify benchmark` | Measure token reduction vs. reading the corpus naively. |
| `graphify diagnose multigraph` | The graph-health diagnostic on demand. |
| `graphify uninstall --purge` | Remove graphify from all platforms and delete `graphify-out/`. |

`hook install` also registers a git merge driver that union-merges two `graph.json` files — relevant only if a repo commits its graph (this one doesn't).

## Reading the report honestly

`GRAPH_REPORT.md` is designed as an audit trail, not a sales pitch:

- **Cohesion scores** are raw numbers (0–1). A low score means the community is weakly interconnected — a genuine "should this be split?" signal, not noise.
- **INFERRED edges carry calibrated confidence** (0.55–0.95 rubric); **AMBIGUOUS** edges are kept and flagged, never silently dropped.
- **Token costs are always shown** — per run in the report, cumulatively in `cost.json`.
- A **graph health check** runs on every build and reports dangling/missing/collapsed edges. Known dangling-edge cases on this repo (~227 of ~3,700 raw edges, v0.9.16): (1) *external-library stubs* — import edges to `ref_react`-style nodes graphify never materializes; low-value by design. (2) *Windows absolute-path IDs* — a few dozen real cross-file edges (e.g. to `formStyles`, `requireUser`) emitted with drive-letter-prefixed endpoint IDs that don't match their relatively-registered nodes. Class 2 is an upstream bug worth reporting; the vast majority of edges are unaffected.

## What a human gets vs. what an agent gets

**Human (visual / exploratory):** `graph.html` for searching and spotting god nodes visually; `GRAPH_REPORT.md` (the suggested-questions section is a good curiosity prompt); optional exports — `--obsidian` (vault, one note per node), `--wiki` (one article per community), `--svg`, `--graphml` (Gephi/yEd), `--neo4j`/`--falkordb` (Cypher). The wiki earns its keep on *uncurated* corpora with no docs; this repo's curated docs tree already covers that ground, so it skips the wiki.

**Agent (retrieval / reasoning):** `query`/`path`/`explain`/`affected` traversals with `source_location` citations; the self-improving lessons loop; incremental maintenance and MCP access. Agents don't need the wiki either — querying `graph.json` directly is cheaper than crawling pages.

## Repo-specific notes

- **Current setup (primary dev machine):** git hooks installed (post-commit + post-checkout), skill installed globally via `graphify install --platform claude`, staleness probe in `.claude/settings.json`. The integration is deliberately split — global config says "the skill exists", [CLAUDE.md](../CLAUDE.md) says "this repo has a graph, query it first", this doc owns everything else. One home per fact.
- `graphify-out/` is **gitignored**: graph, cache, and cost ledger are per-machine. A fresh clone runs `/graphify .` once and inherits nothing stale.
- **`.graphifyignore` (repo root, committed)** excludes the PWA/brand icons under `public/` and starter-template SVGs in `src/assets/` — they produced isolated 2–3-node "branding" communities. Same syntax as `.gitignore`, exclude-only.
- The `db/*.sql` files need the SQL parser extra (`uv tool install "graphifyy[sql]"` here; `pip install "graphifyy[sql]"` generally) — without it they silently contribute nothing. Both this and `.graphifyignore` edits are *build-rule* changes: applied by a full rebuild, never by `--update`.
- Doc extraction mirrors the repo's own tiering: `history/` plans become narrative concepts linked to the living docs' current-state concepts — which is how the graph surfaces "this mechanism evolved from that plan" connections (e.g. the historical client-side AES-GCM token encryption linking to today's Cloudflare Access gate).
- The corpus-size warning and per-run cost print are part of the skill's honesty rules — if a rebuild ever looks expensive, the skill says so before spending.
