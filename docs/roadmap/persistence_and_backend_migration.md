> **What is this?** A forward-looking roadmap document — analysis and framing for an infrastructure decision. It is not current-state documentation. For the current state see [../synthesis.md](../synthesis.md); for the durable "why" see [../vision.md](../vision.md). Companion roadmap doc: [engagement_record_strategy.md](./engagement_record_strategy.md).

> **STATUS (v7.9): partially implemented.** The **sync-only layer (option E)** shipped as a **D1 sync sidecar** — localStorage stays the offline-first working store, and the four slices are mirrored to a Cloudflare D1 table with whole-slice last-write-wins. This resolves the immediate driver (prod vs. local-dev diverging into separate installations, duplicating the Orchestrate calendar / habit tasks) and adds cross-device sync. It **supersedes** the doc's earlier "self-hosted default" lean for the *cloud* path, chosen because the app is already on Cloudflare Pages (no new credential/egress/host). Current-state details: [../synthesis.md](../synthesis.md) §11.1, [../data-model.md](../data-model.md) §7, [../reference/backend.md](../reference/backend.md) §4a. The analysis below is retained as the decision record.

# Persistence & Backend Migration Analysis

## Framing: infrastructure serves the purpose

Orchestrate is a personal, single-user **life-contextualization companion**. Its purpose is to counter task and time blindness, and — increasingly — to scaffold a sustainable life structure across days, weeks, and seasons.

Infrastructure choices are **subordinate to that purpose**. The right question is not *"how do we preserve the no-backend setup?"* — it is *"what storage best serves the purpose, at acceptable cost?"*

A few things follow from that, and they frame this entire document:

- **localStorage was the correct start.** It got a working companion shipped with zero infrastructure, zero cost, and zero friction. That was the right call and remains a perfectly good answer for now.
- **A backend is fully on the table.** If a backend — especially a low-cost, self-hosted one — serves the vision better, it should be adopted. "Browser-only" is a current implementation fact, not a principle to defend.
- **Self-hosting is a first-class, welcomed option.** For a personal tool, running a small datastore on hardware the user already owns is a natural fit, not a compromise.
- **Multi-user is explicitly out of scope.** Orchestrate stays single-user. No accounts management, no multi-tenancy, no sign-up flows, no roles. If the app ever networks, "auth" means at most a single shared secret protecting the user's own data — nothing more.
- **The core vision comes first.** Completing the v7/v8 arc (modes, rituals, recovery, reviews, drift detection) matters more than infrastructure right now. Infrastructure work should not pre-empt vision work.
- **Cost should be low to none** — but this document lays *all* options on the table rather than pre-filtering them.

## 1. Current setup

Orchestrate persists everything to `localStorage`. Eight keys (see [../synthesis.md](../synthesis.md) §11):

- Four reducer-managed slices — `orchestrate-day-plan`, `orchestrate-settings`, `orchestrate-history`, `orchestrate-life-context`.
- The Todoist cache — `orchestrate-todoist-cache`.
- Three auxiliary keys — theme + two music keys.

State is loaded lazily on cold start via `loadInitialState()`, persisted back through four `useEffect` hooks (one per slice), and run through the `migratePlan` version chain on every load. The Todoist personal token is AES-256-GCM "encrypted" — but the key, IV, and ciphertext all live in localStorage together, so this is obfuscation against casual inspection, not security against anyone with browser-profile access.

Honest assessment: **this was the right architecture to get a working companion fast.** It still works. The rest of this document is about whether, and when, the maturing vision outgrows it.

## 2. Concerns with localStorage-as-datastore

- **No cross-device sync.** The app is locked to a single browser profile on a single device. Plan on a laptop, none of it exists on a phone.
- **Eviction and loss risk.** "Clear browsing data" wipes everything. Private windows start empty. Browsers evict localStorage under storage pressure. The only backup is the **manual** Full Backup export — easy to forget.
- **Quota ceiling.** localStorage is capped at roughly 5–10 MB per origin. `history` grows with every saved day; a future `life.engagementHistory` ([engagement_record_strategy.md](./engagement_record_strategy.md) option A) grows continuously. Without trimming, the ceiling is a real eventual wall.
- **Token security.** Client-side encryption protects against a curious glance, not against anyone with access to the browser profile.
- **Migration chain on every load.** `migratePlan` runs the full v1→v6.3 chain on each cold start. Fine today; it accretes as the schema evolves.
- **Multi-tab races.** Cross-tab writes to the reducer slices can race. (Theme already guards this with `useSyncExternalStore`; the four core slices do not.)
- **No server-side surface for integrations that want one.** Holding an OAuth refresh token securely — e.g. for the Google Calendar write pathway in the companion doc — genuinely wants a server.

## 3. Would a backend serve the vision better?

This is a *purpose* question, not a constraint question.

As Orchestrate matures into a life-scaffolding companion, the **value of durable, longitudinal, multi-device data rises sharply**. The v8 vision — weekly and seasonal reviews, drift detection — is fundamentally retrospective: it is only as good as the history behind it. A review that can't trust its own data, or a drift detector watching a history that got evicted last week, is hollow. Cross-device access matters too: planning is a morning-desk activity, but execution and check-ins happen wherever the user is.

So a modest amount of infrastructure may *directly* serve the vision — durable history is review fuel, sync is reach.

The honest counter-point: a backend adds a maintenance surface, and maintenance attention is finite. Right now that attention belongs on building the v7/v8 features themselves. Infrastructure that makes those features *better* is worth it — but not at the cost of delaying them.

## 4. What a backend would introduce — the cost ledger

Costs to weigh, not blockers:

- **An API layer + a server-side data model.** Schema migrations would move (or be duplicated) server-side, alongside or replacing the client `migratePlan` chain.
- **Sync and conflict resolution** — *if* the app stays offline-capable (it should; it's a PWA). For a single user editing from a couple of devices, **last-write-wins on whole-slice snapshots is almost certainly enough**. Full CRDT-style merging is overkill.
- **A deployment and backup story for the server itself** — the server now needs its own uptime and its own backups.
- **Cost is largely avoidable.** Self-hosting on hardware the user already runs (a home server, a Raspberry Pi, a NAS) or a BaaS free tier keeps the dollar cost at or near zero. The real, unavoidable cost is **maintenance attention** — and that is exactly the resource that should stay pointed at the core vision for now.
- **Explicitly NOT in scope:** multi-user accounts, multi-tenancy, sign-up/onboarding flows, role management, sharing. Orchestrate is and stays single-user. "Auth," if the app networks, is at most one shared secret keeping the user's own data private over the wire.

## 5. Options — all on the table

Six options, lightest to heaviest. Each noted for cost, maintenance, sync quality, and fit.

### A. Stay localStorage-only (status quo)

Keep the current model; keep the manual Full Backup as the safety net.

- **Cost:** zero. **Maintenance:** zero. **Sync:** none.
- **Fit:** correct *for now*. Loss risk and the quota ceiling remain, and they sharpen as `history` / `engagementHistory` grow.

### B. File-sync

Write the Full Backup JSON to a user-controlled synced folder (Dropbox / iCloud / Google Drive) via the File System Access API — ideally automatically, not just on a manual click.

- **Cost:** near-zero (uses a sync service the user likely already has). **Maintenance:** minimal. **Sync:** coarse, semi-manual, no real-time; conflict handling is "newest file wins."
- **Fit:** a big durability win for very little work. Solves loss risk; only weakly solves multi-device (it's whole-file, not live).

### C. Self-hosted lightweight datastore — *recommended default*

Run a small datastore — e.g. PocketBase, or a tiny purpose-built sync server — on hardware the user already operates (home server, Pi, NAS).

- **Cost:** low-to-no marginal cost. **Maintenance:** a real but modest ongoing cost (updates, uptime). **Sync:** good — proper push/pull, can be near-real-time.
- **Fit:** strong. Data stays fully owned, aligns with the personal-tool identity, no third-party dependency, no recurring bill. **This is the recommended shape if and when a migration happens.**

### D. BaaS free tier

Supabase, Firebase, or similar — managed Postgres/storage/sync on a free tier.

- **Cost:** $0 on the free tier; single-user data volume sits comfortably within free limits. **Maintenance:** near-zero (managed). **Sync:** good, often real-time out of the box.
- **Fit:** strong if self-hosting maintenance proves unwelcome. Trade-off: a third-party dependency and an account, and data living on someone else's infrastructure.

### E. Sync-only layer over a hosted KV / object store

Keep localStorage as the working store; add a thin layer that pushes/pulls whole-slice snapshots to a hosted key-value or object store.

- **Cost:** low (object storage is cheap; can be self-hosted too). **Maintenance:** low. **Sync:** coarse-grained (whole-slice blobs), simplest possible conflict model (timestamp / last-write-wins).
- **Fit:** strong — preserves the local-first architecture almost entirely; the app stays localStorage-first and just gains a sync sidecar. Minimal disruption.

### F. Full client-server rebuild

Re-architect Orchestrate as a conventional client-server app with the server as the source of truth.

- **Cost:** high (build + hosting + maintenance). **Maintenance:** high. **Sync:** whatever you build.
- **Fit:** **almost certainly overkill** for a single-user personal tool. Listed only for completeness.

## 6. Factors to weigh

- **Single-user.** No multi-tenancy is ever needed — this eliminates the hardest, most expensive parts of "having a backend."
- **Personal tool.** Self-hosting is a natural fit, not a sacrifice. Data ownership is a feature.
- **Already a PWA.** The realistic target is *sync*, not *online-only*. Offline-first must survive any migration — options B, C, E all preserve it; F risks it.
- **Engagement history sharpens the case.** The durable engagement log (companion doc, option A) makes both the durability concern and the quota concern more pressing over time.
- **Cost sensitivity.** Favor self-host / free tier / file-sync. Avoid anything with a recurring bill unless it clearly earns it.

## 7. Roadmap placement & recommendation

**Priority: the core vision first.** Orchestrate's identity as an executive-function / life-scaffolding companion is completed by the v7 arc (modes, rituals, recovery) and the v8 arc (reviews, drift detection, hierarchical views) — see [../backlog.md](../backlog.md). That work is the priority. Infrastructure should not pre-empt it.

**A persistence migration is infrastructure, not vision.** It changes *how* data is stored, not *what the app does*. So the default placement is **after v8 — a v9-class "infrastructure" iteration.**

**Trigger conditions** can justify pulling a *lightweight slice* forward, in parallel, sooner — without derailing v7/v8:

- a genuine, recurring multi-device need;
- `history` / `engagementHistory` approaching the localStorage quota ceiling;
- the Google Calendar write pathway ([engagement_record_strategy.md](./engagement_record_strategy.md) option E) becoming a committed goal — it benefits substantially from a server holding the OAuth refresh token.

If a trigger fires, reach for the **smallest sufficient option**, not a rebuild. **Option B (file-sync)** is a near-free durability patch that could land almost anytime. **Option C (self-hosted lightweight datastore)** or **E (sync-only layer)** are the recommended shapes for a real migration — low/no cost, data fully owned, local-first preserved, no multi-user machinery. **Option D (BaaS free tier)** is the fallback if self-hosting maintenance proves unwelcome.

**Until a trigger fires, the current model plus the manual Full Backup is an acceptable, deliberate cost.** Keeping infrastructure minimal *right now* is the correct call — precisely because attention belongs on the v7/v8 vision work. The point of this document is that the decision is *staged and conditional*, not foreclosed: a backend is welcome when it earns its place.

## 8. Cross-reference

The companion doc, [engagement_record_strategy.md](./engagement_record_strategy.md), is the most concrete near-term driver of this question. Its **option E** (Google Calendar write via OAuth) is the single feature that most clearly benefits from infrastructure — a server holding the refresh token turns a fragile browser-only flow into a robust one.

But note: that doc's **option A** (durable `life.engagementHistory`) needs **no backend at all** — it works within the current localStorage model. So durable engagement records and the persistence-migration question can, and should, proceed on independent timelines. Building option A does not wait on anything in this document.

The multi-surface sequel to this document — the ambient Focus window, the browser extension, the LWW single-writer rules those surfaces demand, and the eventual Access→app-owned-sign-in swap — is [multi_surface_and_auth.md](./multi_surface_and_auth.md). Its conclusion extends this one: the shipped D1 sidecar covers that entire horizon with additive changes; no option-F-style migration appears on it.
