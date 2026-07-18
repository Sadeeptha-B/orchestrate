> **What is this?** A forward-looking roadmap document — analysis and framing for the **multi-surface horizon**: an ambient Focus window you can drag across screens, a browser extension for intentional browsing, and the auth rework those eventually pull in. It is not current-state documentation. For the current storage model see [../reference/persistence.md](../reference/persistence.md); for the server/auth side see [../reference/backend.md](../reference/backend.md); for the transfer-safety mechanisms see [../reference/backup_and_restore.md](../reference/backup_and_restore.md). Companion decision record: [persistence_and_backend_migration.md](./persistence_and_backend_migration.md).

# Multi-surface Orchestrate & the auth horizon

## 0. Why this document exists

Orchestrate today is **one surface**: the PWA window. Two roadmap ideas break that assumption:

1. **An ambient Focus window** — the Pomodoro timer + task context (see [../reference/focus-mode.md](../reference/focus-mode.md)) as a small, separate window you can drag to any screen, living alongside the main app rather than inside it.
2. **A browser extension** — a companion that knows the current focus state and nudges browsing back toward the day's intentions.

Both raise the same three questions, and this doc walks them in order:

- **Where does each surface get its state?** (§2–§4)
- **What happens when more than one surface *writes*?** (§5 — the last-write-wins considerations)
- **How does a surface that isn't the gated PWA authenticate?** (§6)

It closes with the migration ledger (§8): what, if anything, on this horizon actually requires outgrowing the current D1 setup. Spoiler: nothing does — the conclusion of this analysis is that **the database is not the bottleneck anywhere on this roadmap**; the two seams that evolve are *state granularity* and the *auth perimeter*, and both evolve in place.

## 1. Ground truth: what the D1 sidecar is actually for

This question sharpened after the backup/import/reset flows became robust (guards, fingerprints, markers — the whole [scenario catalog](../reference/backup_and_restore.md)): if a backup file can now move data safely across any boundary, what does the cloud mirror still uniquely provide?

The answer, stated once so the rest of the doc can lean on it: **the guards made the *bridge* safe; D1 is the *road*.**

- **Zero-discipline durability.** Backups are manual-only (a standing sharp edge — [backup_and_restore.md §6](../reference/backup_and_restore.md)); every file-level recovery depends on a recent export. The sidecar mirrors every edit within ~2.5s, so a cleared browser profile or evicted `localStorage` loses nothing.
- **Recovery you never took.** D1 Time Travel holds ~30 days of continuous point-in-time snapshots — the recovery path both destructive flows cite. A backup is one frozen point you chose in advance; Time Travel is every point, chosen retroactively.
- **Convergence, which restore structurally cannot do.** Import is an authoritative whole-slice replace stamped "now" — a *restore*, not a merge. Running two live devices on backup files alone would clobber one side on every import. Ongoing two-sided convergence needs the sync machinery (logical clock, skip-first-fire, LWW merge — [persistence.md §3, §5](../reference/persistence.md)), and there is no file-based equivalent.
- **A live dedup registry.** Devices sharing the database share `life`'s external-ID registry continuously — reconciliation finds every id present and does nothing (scenario A1, the one unconditionally clean multi-store row). Backup-bridged stores share the registry only as of the export moment; that gap is exactly where the residuals R1–R3 live.
- **The substrate for this roadmap.** An authenticated, per-user, strongly-consistent, same-origin data API that already exists. §4 is built on it.

One more ground truth that shapes everything below, easy to misremember: **the sidecar pulls only at cold start** and pushes on a ~2.5s debounce. It is a *convergence* layer, not a *live channel*. No surface on this roadmap should expect real-time state through D1 as it stands — each section below says what to use instead.

## 2. The ambient Focus window

### 2.1 Is a separate draggable window even possible as a PWA? — yes

Two browser mechanisms fit, both best (or only) supported in Chromium, which is acceptable for a personal tool:

- **Document Picture-in-Picture** (Chrome/Edge 116+). Despite the name, it hosts **arbitrary HTML**, not just video — a small, **always-on-top**, frameless window the user can drag to any screen. This is almost exactly the ambient-timer spec. Two caveats: it **closes when the opener tab closes** (it's a child of the main app's tab, not an independent window), and Firefox/Safari don't support it.

  The property that changes the whole cost calculus: the window `documentPictureInPicture.requestWindow()` returns is **scripted by the opener** — it is not a second page load but a blank document the main app populates directly. With React that means `createPortal(<AmbientFocus/>, pipWindow.document.body)` (plus copying the opener's stylesheets across): the ambient surface runs inside the **same JS context, same reducer instance, same persist pipeline** as the main app. No route, no second loader, no state synchronization of any kind.
- **A plain popup window** — `window.open(url, '_blank', 'popup,width=…,height=…')` from the installed PWA, or simply a second window of the PWA. Fully independent lifetime (survives the main tab closing), draggable anywhere, but *not* always-on-top — and it **is** a second page load with its own reducer, which is what drags in the cross-window state problem of §2.2.

The shape that follows: **v1 is the PiP portal** — a compact ambient component portalled from the running app, feature-detected (`'documentPictureInPicture' in window`) with the entry button hidden otherwise. The **popup variant** is deliberately deferred until living with v1 proves the need for independent lifetime; it is a real second installation of the app in miniature and pays §2.2's full price.

### 2.2 The real work is client-side — D1 is not the mechanism here

An ambient window on the **same device** is the *same origin*: it already shares `localStorage` with the main window. What it needs is **live** shared state, and the browser gives that locally for free:

- **`BroadcastChannel`** — a same-origin publish/subscribe pipe between windows/tabs. The engaged segment, phase machine position, and Pomodoro block state can stream over it with zero latency and zero backend involvement.
- **`storage` events** — fired in *other* windows whenever `localStorage` changes; a cruder fallback that piggybacks on the persistence the app already does.

D1 contributes nothing to this case — and *couldn't*: cold-start-only pulls mean a second window would never see the first window's edits through the cloud while both are open.

The **PiP portal variant sidesteps all of this** — same JS context, one reducer, one persist pipeline; there is nothing to synchronize and §5's ownership rule is satisfied by construction. That is why it's v1: it ships the feature without the architecture work.

What the **popup variant** (and any second full-app window) forces is solving a known gap: **the four slices have no cross-tab reconciliation** (each window holds independent in-memory reducer state; only `theme` guards this today, via `useSyncExternalStore` — noted as a multi-tab race in [persistence_and_backend_migration.md §2](./persistence_and_backend_migration.md)). Two live windows of the full app would silently diverge until one overwrote the other's slice. A read-mostly popup (§5's first design rule) softens but doesn't remove this. The honest sequencing: *cross-window state is the prerequisite task for the popup variant, and it is a client architecture task* — a `BroadcastChannel`-backed layer over the reducer (or `useSyncExternalStore` over the slices), no schema, no backend. Doing it also fixes the pre-existing multi-tab race for the main app itself.

Where D1 **does** become load-bearing: an ambient surface on a **different device** — the timer on a desk tablet while the laptop runs the dashboard. That's cross-device state, the sidecar's home turf, though the cold-start-only pull would want a lighter refresh loop (a periodic `GET /api/state` for the relevant slice is enough; see §7 before reaching for anything fancier).

## 3. The browser extension

### 3.1 The constraint that shapes everything: it's a different origin

An extension runs as `chrome-extension://…` — **not** the app's origin. It cannot read the app's `localStorage`, cannot join its `BroadcastChannel`, and does not automatically share its session. Everything the ambient window got for free, the extension has to earn. Its only path to Orchestrate state is the network surface — which is precisely where the D1 sidecar stops being a background convenience and becomes **the enabling piece**: `GET /api/state` / `PUT /api/state/:key` is already an authenticated, per-user, per-key data API.

### 3.2 What the extension needs, and what already exists

For "intentional browsing," the extension realistically needs:

- **Read**: the current focus state — engaged task, intention, session, maybe the day's intentions list. Freshness of 30–60 seconds is fine for nudging; this is plain polling of `GET /api/state` (or a narrower endpoint that returns just the focus summary, cheaper than shipping the whole `plan` slice).
- **Write**: small, append-flavoured events — "visited a distracting site during a focus block," "user snoozed the nudge," perhaps intentions-of-the-browsing-session. **These writes should not touch the four app slices** — §5 explains why, and what to do instead.

The `slices` table is keyed `(user_id, key)` and the endpoints are already per-key, so giving the extension its own key (or a small purpose-built table + Function) is an **additive** change — no migration, no rework of the existing sync.

### 3.3 Extension auth — workable now, properly solved by §6

The `/api/*` surface sits behind Cloudflare Access, and the per-request identity check *is* the security boundary ([backend.md §5](../reference/backend.md)) — it cannot simply be waived for the extension. Three options, in order of increasing effort:

1. **Ride the Access cookie.** With host permissions for the app's domain, extension `fetch`es carry `CF_Authorization` when the user has an active Access session. Workable, but clunky at the edges: when the session expires, the extension has no good way to re-run the SSO redirect — it just starts failing until the user opens the app.
2. **An Access service token** — Cloudflare's mechanism for non-browser clients: a client-id/secret pair the extension presents in headers, with its own Access policy. Solves expiry; the trade is a long-lived credential living in extension storage (acceptable for a personal tool; it authorizes only this API).
3. **The auth seam swap (§6)** — replace Access with app-owned Google sign-in, at which point the extension authenticates like any first-class client.

The pragmatic call: option 1 or 2 is fine for a first extension; the extension is also the thing that makes §6 genuinely worth doing, so plan them together.

## 4. Confirming the capability question: is D1 enough for all this?

**Yes — with one reframe that dissolves most of the worry.** "The current D1 is limited compared to a full DB and backend" conflates the *product* with the *usage*. D1 **is** a full relational SQLite database; Orchestrate currently *uses* it as an opaque blob store (one JSON row per slice) because that's all the sync sidecar needs. The limitation is the current schema and endpoints — both of which evolve additively in the same database:

| Roadmap item | D1 sufficient? | Where the actual work is |
|---|---|---|
| Ambient window v1 (PiP portal) | ✅ (D1 not even involved) | Compact component + portal; same JS context, no state layer at all (§2.2). **Prototyped & verified on branch `ambient-window-v1`, then parked** pending the planning-surface overhaul. |
| Ambient window, popup variant | ✅ (D1 not involved) | The §2.2 cross-window state layer (`BroadcastChannel` / `useSyncExternalStore`) |
| Ambient surface, another device | ✅ | A periodic pull for the relevant slice; §5 rules |
| Extension: read focus state | ✅ | Polling + optionally a narrow read endpoint |
| Extension: write browsing events | ✅ | Own key or small table + Function (§5) |
| v8 reviews / relational queries | ✅ | Real tables beside `slices` when the time comes; client-side query works even sooner |
| Sub-second live push between surfaces | ⚠️ not a DB problem | A transport problem — §7 — and only if genuinely needed |

Nothing here reaches for Postgres, an ORM, or an app server. The [persistence.md §9](../reference/persistence.md) outgrow-triggers remain the honest checklist, and none of them fire on this roadmap.

## 5. The last-write-wins considerations — the part to get right early

This is the one place the current design genuinely strains under this roadmap, so it gets its own section.

### 5.1 A quick recap of the model, and why new surfaces stress it

Sync is **whole-slice last-write-wins by wall-clock time** ([persistence.md §5.2](../reference/persistence.md)): a slice is pushed and adopted as one JSON blob; the newer timestamp wins the *entire* slice; there is no field-level merge. Its accepted failure mode — concurrent edits to the same slice, later write silently drops the earlier one — is essentially theoretical for *one person on a couple of devices used one at a time*. That's the assumption doing the load-bearing.

Every new surface is potentially a new **concurrent writer**, and unlike the two-devices case, these writers are concurrent *by design*: the whole point of an ambient window or an extension is that it's alive **while** the main app is open. An extension writing "snoozed nudge at 14:32" into the `plan` slice while the dashboard reorders a session would be a textbook LWW clobber — one of those writes fully overwrites the other, silently.

The same hazard exists in miniature on-device: two same-origin windows share `localStorage` but hold **independent in-memory reducer states**; whichever persists last overwrites the file, and the sync layer faithfully mirrors the overwrite. LWW isn't even needed for data loss there — plain write-after-write does it.

### 5.2 The design rules

Cheap to adopt before the second surface exists, expensive to retrofit after:

1. **One owner per slice — auxiliary surfaces are read-mostly.** The four app slices (`plan`, `settings`, `history`, `life`) stay owned by the main app. The ambient window and extension *read* them; they do not casually write them. Where an ambient window genuinely must mutate the plan (Stop/Complete from the timer), it should do so **through the main window's reducer** — one reducer instance applies the action, one window persists — rather than running a second reducer that races the first. (The PiP portal satisfies this *by construction* — there is only one reducer. The rule genuinely bites for the popup variant, where the channel is `BroadcastChannel`, and for the extension.)
2. **Every independent writing surface gets its own key.** The extension's browsing events go in their own slice key (or table) — e.g. `browsing-events` — that *no other surface writes*. LWW per key is perfectly safe when each key has exactly one writer; the entire hazard is shared keys. This is the single most important rule in this document, and the `slices` table already supports it (`(user_id, key)`) with zero migration.
3. **Prefer append-shaped data for cross-surface writes.** Events ("visited X at T", "snoozed at T") rather than mutated state. Append-only logs are order-insensitive and idempotent to re-push, so even a stale-clocked write can't destroy anything — the reader (the main app, a future review feature) folds them in whenever it likes. If event volume ever matters, this is also the natural first *real table* in D1 (`events(user_id, ts, kind, payload)` + a tiny append Function) — additive, beside `slices`, not a migration.
4. **When a surface must influence app state, hand off rather than write.** The extension wanting to say "add this to today's intentions" should enqueue it (its own key, per rule 2) for the main app to *adopt* into `life`/`plan` on next load — the same adopt-don't-write instinct the account fingerprints established at the integration boundary ([backup_and_restore.md §2](../reference/backup_and_restore.md)), applied to internal surfaces.
5. **Same-device windows coordinate locally, not through the cloud.** `BroadcastChannel`/`storage` events are the channel; the cloud never arbitrates between two windows sitting on the same `localStorage`. (It couldn't anyway — cold-start-only pulls.)

Follow these and LWW keeps holding exactly as designed: each key single-writer, devices one-at-a-time, the clobber scenario stays theoretical. Break rule 1 or 2 and the fix is field-level merge or CRDTs — the complexity cliff the whole persistence design deliberately walks away from.

## 6. The auth horizon: from the Access gate to app-owned Google sign-in

### 6.1 Why the gate exists, and why it can still be replaced

The gate is not bureaucracy: once integration tokens sit in KV, the `/api/*` endpoints are a **standing capability** to act on the user's Google and Todoist accounts, so *something* must authorize every invocation — the per-request identity check **is** the security boundary ([backend.md §5](../reference/backend.md)). But [backend.md](../reference/backend.md) itself notes the perimeter and the identity are separable: Access is the pragmatic way to get both at once, not the only way. "Remove the gate" really means "**replace Access's identity check with one the app owns**" — the boundary stays; the awkward approval choreography goes.

### 6.2 What makes the swap contained

There is **exactly one auth seam**: `requireUser()` in [`functions/_shared.ts`](../../functions/_shared.ts). Every endpoint — Google auth, the Todoist proxy, `/api/state`, `/api/me` — starts with the same three lines. Swapping "verify the `Cf-Access-Jwt-Assertion`" for "verify a Google ID token / an app-minted session JWT" touches that one function; the verified email remains the tenant key, so **KV keys, D1 rows, and every endpoint are untouched**. The allowlist survives as an env var or KV set — "pre-approved emails only" without Zero Trust.

### 6.3 What it costs, honestly

- **Session machinery becomes app code.** Login UI, session issuance, expiry, refresh — everything Access handles today. This is the real price; it's why the doc's advice was "don't rebuild what Access gives you free" *until a client that can't use Access exists*. The extension is that client.
- **The static bundle goes public.** Fine — it's inert JS with no secrets; only the `/api/*` gate was ever load-bearing ([backend.md §5](../reference/backend.md)).
- **The *other* awkward gate surfaces: Google's Testing mode.** Truly frictionless "sign in with Google" for anyone means publishing the OAuth app through Google's verification process — its own project, independent of anything Cloudflare. Until then the test-user list (cap 100) and the scary consent screen remain, gate or no gate.
- **Client details to re-solve:** the identity-switch guard currently keys off Access-verified `/api/state` responses ([persistence.md §5.4](../reference/persistence.md)) — same shape, new token source; the service worker's never-cache-redirects rule loses its reason but harms nothing.

### 6.4 When

**Bundle it with the extension work.** Doing it earlier buys nothing (the PWA is perfectly served by Access; the ambient window rides the same origin and session). Doing it never leaves the extension on cookie-riding or service tokens indefinitely — livable, but clunky. It sits naturally *after* the ambient window (which needs none of this) and *with or just before* the extension. It is also fully orthogonal to the database question — the swap touches no data code.

## 7. The one genuine platform edge: live push

Everything above assumes pull. If a future surface needs **real-time server push** — sub-second timer state on another device, instant extension nudges — that's the one requirement the current architecture can't meet by configuration: Pages Functions are stateless request/response and can't hold WebSocket/SSE connections meaningfully. The Cloudflare-native answer is a **Durable Object** (a stateful mini-server that holds connections and fans out updates), added *beside* everything else.

The reason this is a section and not a plan: no roadmap item above actually needs it. Same-device ambient state is `BroadcastChannel` (instant, free); the extension's nudging is fine at polling freshness; cross-device ambient display tolerates a periodic pull. Live push is the marker at the edge of the map — note where it is, don't walk there speculatively.

## 8. The migration ledger — what would actually move, and when

Pulling it together against the [persistence.md §9](../reference/persistence.md) triggers:

| Trigger | Fired by this roadmap? |
|---|---|
| Data outgrows the browser / queries the client can't run | No |
| Work with no browser open (schedulers, unattended nudges) | No — the extension runs in-browser; *if* unattended intervention ever appears, Cron Triggers + existing D1 is the minimal answer, not a platform move |
| Genuine concurrent multi-writer | **Avoided by design** — §5's rules exist precisely to keep every key single-writer |
| Server-enforced authority | No — all surfaces are still the same user hurting only themself |
| Real accounts at scale | No — the §6 swap keeps the allowlist; only public self-serve signup would cross this |

**Sequencing that falls out of the whole analysis:**

1. **Ambient window v1 — the PiP portal.** Client-only, **no architectural prerequisite**: a compact ambient component (props-driven and route-free, so it's reusable by the popup variant and as the extension's focus-summary view later) portalled into a Document PiP window from the running app. Same reducer ⇒ rule 5.1 holds by construction. Feature-detected; the entry point hides on unsupporting browsers. **Status — prototyped & verified, then parked on branch `ambient-window-v1`** (full design, verification, and caveats: `docs/history/plan_v7/plan_v7.12.md` *on that branch*). It was held back from the mainline deliberately: the in-flight planning-surface overhaul (wizard simplification + a more responsive dashboard) is expected to reshape the primitives it attaches to — the dashboard/Focus **entry points** and the **`findActiveFocusTask` derivation** — so it will be re-integrated *after* that lands rather than merged as-is. The decoupled pieces (the route-free `AmbientFocus` and the app-level `FocusSessionProvider` engine lift) should survive largely intact; the branch's `plan_v7.12.md` carries a re-integration checklist for the picking-up agent.
2. **Cross-window state layer** — pulled in only when v1's lived experience demands the popup variant (independent lifetime) or a second-device surface: `BroadcastChannel` / `useSyncExternalStore` over the slices. Also fixes the pre-existing multi-tab race for the main app.
3. **Extension, v1** — own slice key for its writes (rules 2–4), polling reads, auth via Access cookie or service token.
4. **Auth seam swap** — with or just before extension maturity: `requireUser` re-implementation, app-owned Google sign-in, allowlist retained; Google OAuth verification if the consent screen friction matters.
5. **Real tables in D1** — when event volume or v8 reviews ask for them; additive, beside `slices`.
6. **Durable Object for push** — only if a live-push requirement materializes (§7).

Each step is small, independent, and forecloses none of the others. A migration to a conventional database/backend stack appears **nowhere on this list** — the expensive rebuild (option F in the [decision record](./persistence_and_backend_migration.md)) stays exactly where that record put it: listed for completeness, almost certainly never. The standing risk to keep an eye on is not capability but **discipline**: every new surface will be tempted to write the app slices directly, and §5's rules are cheap only if adopted before the second writer ships.

## 9. Cross-references

- [../reference/persistence.md](../reference/persistence.md) — the storage model this doc extends: slices, the sync sidecar's merge/conflict model (§3, §5), the outgrow-triggers (§9).
- [../reference/backend.md](../reference/backend.md) — the auth model §6 modifies: Access, `requireUser`, why the gate is load-bearing (§5).
- [../reference/backup_and_restore.md](../reference/backup_and_restore.md) — the transfer-safety mechanisms whose relationship to D1 §1 clarifies.
- [../reference/focus-mode.md](../reference/focus-mode.md) — the execution surface the ambient window extracts.
- [persistence_and_backend_migration.md](./persistence_and_backend_migration.md) — the original persistence decision record; this doc is its multi-surface sequel.
