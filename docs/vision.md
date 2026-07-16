> **What is this?** The durable "why" of Orchestrate — the problem, the approach, and the constraints that have survived across iterations. Specific not-yet-built proposals live in [backlog.md](./backlog.md). The historical evolution of these requirements lives in [history/iterations.md](./history/iterations.md). For the current state of the implementation, see [synthesis.md](./synthesis.md).

# Orchestrate — Vision

## The problem

On a new day, it is essential to contextualize your tasks. Typical task-manager programs maintain lists, but they do not solve the friction of contextualizing for the *new day* — going through the todolist, comparing it against today's actual goals, and getting a holistic overview of what's relevant.

Two specific pain points:

- **Task and time blindness.** Hard to see what to do; hard to see how it fits in the day.
- **Epics vs intentions.** Todo lists accumulate epics. When starting a day, we don't think in terms of epics — we think in terms of *intentions*: specific goals for *today*.

## What Orchestrate is

A web app that walks the user through a structured contextualization process at the start of the day, and nudges them through the day to maintain that context.

The main goal: **contextualization and nudging the user towards their tasks, countering task and time blindness.**

## Constraints (intentional)

These are explicit opinions, not hedges. Proposals that violate them should be challenged before being added to the backlog.

- **Companion, not replacement.** The user's main todolist (Todoist) and calendar (Google Calendar) live in external software. Orchestrate sits alongside them and helps keep them consistent — it is *not* trying to be a fully-featured task or calendar manager.
- **Personal tool.** Specific to the author's needs. Default sessions, the playlist set, and the integration choices are opinionated and not aimed at general-purpose use.
- **Single-user.** Orchestrate is for one person — no accounts, no multi-tenancy, no sharing. This is durable. Even if the app ever networks, "auth" means at most a single secret protecting the user's own data; it never becomes account management.

## Infrastructure is subordinate to the vision

Infrastructure choices *serve* the purpose — they are not ends in themselves, and "how the data is stored" is not part of the vision.

Persistence began as `localStorage` only, with no backend — the right zero-friction, zero-cost start. Since then a **minimal serverless backend** has been added where it served the vision: a Cloudflare D1 sync sidecar so the user's real devices converge on one state, and server-side integration tokens fronted by Cloudflare Access. `localStorage` remains the offline-first working store (current implementation: [synthesis.md](./synthesis.md) §11, [reference/persistence.md](./reference/persistence.md)). That evolution *is* this principle in action: **"browser-only" is not a sacred constraint.** Where a backend serves the vision better — durable longitudinal history for reviews and drift detection, cross-device reach, a robust calendar integration — it is welcome. Self-hosting is a first-class, low-cost option.

The principle is **minimal infrastructure in service of the contextualization-companion purpose**, with two corollaries: keep cost low to none, and let achieving the core vision take priority over infrastructure work. The persistence question is analysed — options, costs, and roadmap placement — in [roadmap/persistence_and_backend_migration.md](./roadmap/persistence_and_backend_migration.md).

## Core concepts (durable vocabulary)

These ideas have survived across iterations and shape future direction. They are part of the product, not an implementation detail.

- **Intention** — a high-level goal for *today*. Today-scoped, not epic-scoped. Owned by Orchestrate. Always user-created (v6.1 removed habit-to-intention auto-injection).
- **Task** — a concrete unit of work, owned by Todoist. Linked to an intention inside Orchestrate.
- **Season** — a medium-horizon focus period (typically 4–12 weeks) with a primary theme, supporting goals, explicit non-goals, success criteria, and an optional capacity budget. Exactly one season is active at a time. Added in v5 as the bridge between life direction and daily execution.
- **Habit** — a first-class recurring entity discriminated by `kind`: a **habit** (synced to Todoist as a recurring task, surfaced as a `TodaysHabitInstance` on the day's timeline independent of session assignment; terminal once per day) or a **micro-gap** (a light, repeatable filler — no Todoist, never terminal). Owns recurrence rule, minimum-viable form, trigger cue, anchor flag, and season scope. Current entity semantics live in [data-model.md](./data-model.md).
- **Anchor** — a habit treated as load-bearing for the user's life (sleep, meditation, gym, shutdown, weekly review). Anchors are protected from accidental deletion and remain visible across modes.
- **Session** — a fixed time block in the day. Defaults are early-morning (6–8), morning (9–13), afternoon (14:30–18:30), night (20:30–23); these are user-configurable. Tasks are assigned to sessions.
- **Main vs background task** — *main* tasks are primary work threads, exclusive to one session. *Background* tasks are habit/nudge tasks that can recur across multiple sessions in a day.
- **Music protocol** — a deliberate state machine of six curated playlists mapped to work types. Music is treated as a focus-state trigger, not ambience. See [music_routine.md](./roadmap/music_routine.md).
- **Hourly check-in** — a through-the-day prompt: how do you feel, what kind of work are you doing? Yields a playlist suggestion and an opportunity to recontextualize the plan.
- **Mode** *(forward-looking, v7)* — the operating mode of the day: focus / maintenance / recovery / shutdown / review. Manually set by the user; v8 adds signal-driven suggestions but never auto-changes.
- **Ritual** *(forward-looking, v7)* — a templated sequence of state-transition steps (e.g. morning launch, evening shutdown, recovery reset). Generalizes the start-work music cue into a broader life-transition framework.

## What the app does (in one sentence)

Orchestrate walks the user from a fresh-day haze into a contextualized, scheduled, music-cued plan, then nudges hour-by-hour to keep that context from decaying — sitting beneath a season-and-habit scaffolding layer that holds the *why* across days, weeks, and months.
