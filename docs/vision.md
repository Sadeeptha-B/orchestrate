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
- **Browser-only, no backend.** All persistence is `localStorage`. No cross-device sync, no shared state, no multi-user features.
- **Single-user.** Auth is a personal Todoist API token. No accounts, no multi-tenancy.

## Core concepts (durable vocabulary)

These ideas have survived across iterations and shape future direction. They are part of the product, not an implementation detail.

- **Intention** — a high-level goal for *today*. Today-scoped, not epic-scoped. Owned by Orchestrate.
- **Task** — a concrete unit of work, owned by Todoist. Linked to an intention inside Orchestrate.
- **Session** — a fixed time block in the day. Defaults are early-morning (6–8), morning (9–13), afternoon (14:30–18:30), night (20:30–23); these are user-configurable. Tasks are assigned to sessions.
- **Main vs background task** — *main* tasks are primary work threads, exclusive to one session. *Background* tasks are habit/nudge tasks that can recur across multiple sessions in a day.
- **Music protocol** — a deliberate state machine of six curated playlists mapped to work types. Music is treated as a focus-state trigger, not ambience. See [music_routine.md](./music_routine.md).
- **Hourly check-in** — a through-the-day prompt: how do you feel, what kind of work are you doing? Yields a playlist suggestion and an opportunity to recontextualize the plan.

## What the app does (in one sentence)

Orchestrate walks the user from a fresh-day haze into a contextualized, scheduled, music-cued plan, then nudges hour-by-hour to keep that context from decaying.
