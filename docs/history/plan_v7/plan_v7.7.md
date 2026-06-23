# Google Calendar: event overlay + rendered calendar view

## Context

Today the Google Calendar integration is **read + auth only at the feature level**: OAuth works, the user picks calendars, and a *public iframe* embed ([GoogleCalendarEmbed.tsx](src/components/todoist/GoogleCalendarEmbed.tsx)) renders them. Two real gaps:

1. **The SessionTimelineBar has no day context.** Its purpose is to help the user organize sessions within the day, but it shows only sessions/tasks/habits — not the external commitments (meetings, appointments) that actually constrain the day. Those live in the user's Google calendars.
2. **The iframe can't show private/imported calendars** (e.g. the Todoist-synced one) because it's cookie-less and unauthenticated. There is **no OAuth-aware Google embed** — confirmed by research; the only official embed is the public iframe. The real fix is to render events ourselves via the Calendar API, which we can now do because OAuth + access tokens are in place.

This plan covers two phases. **Phase 3 (auto-create an "Orchestrate" calendar and write sessions back) is explicitly deferred** — its chosen direction is recorded at the end so the design here doesn't paint it into a corner.

Key constraint confirmed during investigation: the existing `calendar.events` scope already permits `events.list` (read) and `events.patch` (move/resize). **No scope bump is needed for Phases 1–2.**

---

## Phase 1 — Overlay external events on the SessionTimelineBar (read-only)

The bar gains a faded, non-interactive layer showing today's events from the selected calendars, positioned with the same percent-of-day math the sessions already use.

### 1a. API: fetch events
In [googleCalendarApi.ts](src/lib/googleCalendarApi.ts), add `listEvents` alongside `listCalendars`, reusing the existing `calFetch` helper (which already maps 401 → `GoogleAuthError`):

```ts
export interface CalendarEvent {
  id: string;
  calendarId: string;          // stamped by the caller for color/source attribution
  summary: string;
  start: string;               // ISO (dateTime) — all-day events filtered out (see note)
  end: string;                 // ISO
  color?: string;              // inherited from the calendar entry
}

// GET /calendars/{id}/events?timeMin&timeMax&singleEvents=true&orderBy=startTime&maxResults=...
export async function listEvents(token, calendarId, timeMinISO, timeMaxISO): Promise<CalendarEvent[]>
```
- Pass `singleEvents=true&orderBy=startTime` so recurring events are expanded into instances.
- **All-day events** (`start.date` with no `dateTime`) have no time-of-day position — filter them out for the timeline (they can resurface as header chips later; out of scope now).

### 1b. Context: a day-events fetcher
In [GoogleCalendarContext.tsx](src/context/GoogleCalendarContext.tsx), add an action that fetches across every selected calendar in parallel and merges results:

```ts
listDayEvents: (dateISO: string) => Promise<CalendarEvent[]>   // [] when not connected / no calendars
```
- Reuse `getAccessToken()` ([:103-133](src/context/GoogleCalendarContext.tsx#L103-L133)) and route failures through `handleError` exactly as `refreshCalendars`/`createEvent` already do ([:135-145](src/context/GoogleCalendarContext.tsx#L135-L145), [:201-213](src/context/GoogleCalendarContext.tsx#L201-L213)).
- Read `settings.googleCalendarIds` for the calendar list + per-calendar color; `Promise.all` one `listEvents` per calendar; flatten.
- Compute `timeMin`/`timeMax` as the local day bounds of `dateISO`.
- Add to `GoogleCalendarActionsValue` ([:37-50](src/context/GoogleCalendarContext.tsx#L37-L50)) and the `actionsValue` memo.

**No persistence / schema bump in Phase 1** — events are fetched live and held in component/hook memory (a small `dateISO → events` in-memory cache to avoid refetch on every render). This keeps the schema untouched and avoids stale-event storage.

### 1c. Hook: `useDayCalendarEvents(dateISO)`
A thin hook (new file `src/hooks/useDayCalendarEvents.ts`) that calls `listDayEvents` on mount / when the date or connection changes, with the in-memory cache and a manual refetch. Mirrors the existing data/actions hook pattern in [useGoogleCalendar.ts](src/hooks/useGoogleCalendar.ts).

### 1d. Render the overlay in [SessionTimelineBar.tsx](src/components/ui/SessionTimelineBar.tsx)
- New optional prop on `SessionTimelineBarProps` ([:246-279](src/components/ui/SessionTimelineBar.tsx#L246-L279)): `externalEvents?: CalendarEvent[]`. Optional ⇒ callers opt in; non-passing callers are unaffected.
- Convert each event's ISO start/end to minutes-of-day with the existing `isoLocalMinutes` helper ([:21-23](src/components/ui/SessionTimelineBar.tsx#L21-L23)); compute `left`/`width` with the **same formula as `slotPosition`** ([:351-358](src/components/ui/SessionTimelineBar.tsx#L351-L358)). Clamp to `[dayStart, dayEnd]`.
- Render as a **dedicated faded lane** below the hour axis and *behind* the session blocks (lower visual weight, `pointer-events-none`, calendar color at low opacity, title on hover via `title`). Block-shaped (they have width) — so this is a sessions-style layer, **not** the point-marker `packLaneMarkers` path. Overlapping events: a light greedy stack reusing the row-packing idea from `packLaneMarkers` ([:214-241](src/components/ui/SessionTimelineBar.tsx#L214-L241)), or simply layered with opacity — start simple (layered), refine only if it reads badly.

### 1e. Wire callers
- [SessionTimeline.tsx](src/components/dashboard/SessionTimeline.tsx) (dashboard): call `useDayCalendarEvents(todayISO())`, pass `externalEvents`.
- [Step3Schedule.tsx](src/components/wizard/Step3Schedule.tsx): same, optional — fine to include since the prop is additive.

---

## Phase 2 — Replace the iframe embed with a rendered FullCalendar view

Swap the public-iframe [GoogleCalendarEmbed.tsx](src/components/todoist/GoogleCalendarEmbed.tsx) for an OAuth-rendered calendar. This shows **private calendars** and supports **drag-to-move + resize** (the editing surface the user wanted to "reserve the embed for"). The timeline overlay stays read-only; editing lives here.

### 2a. Dependencies
Add FullCalendar (MIT free tier): `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/list`, `@fullcalendar/interaction`.

### 2b. New component `RenderedCalendar.tsx` (replaces the embed in place)
- Source events from the same `listDayEvents`/`listEvents` path, but over the **visible range** (week/month) rather than a single day — generalize the context action to accept an explicit `timeMin`/`timeMax` (FullCalendar's `datesSet` callback supplies the visible range).
- Map `settings.calendarViewMode` ('week' | 'month' | 'agenda') → FullCalendar views (`timeGridWeek` | `dayGridMonth` | `listWeek`); keep persisting the toggle via `UPDATE_SETTINGS` as the current embed does ([:70-72](src/components/todoist/GoogleCalendarEmbed.tsx#L70-L72)).
- Color events by their calendar entry; keep the "Open in Google Calendar ↗" link.
- **Editing:** set `editable`, handle `eventDrop` + `eventResize` → call a new context action `patchEvent(calendarId, eventId, { start, end })` → new `patchEvent` API fn in `googleCalendarApi.ts` (`PATCH /calendars/{id}/events/{eventId}`, covered by `calendar.events`). On failure, revert (FullCalendar's `info.revert()`) and surface via `handleError`.
- Empty/disconnected states reuse the current copy from the embed ([:45-68](src/components/todoist/GoogleCalendarEmbed.tsx#L45-L68)), including the `onSetup` link. The private-calendar warning ([:99-101](src/components/todoist/GoogleCalendarEmbed.tsx#L99-L101)) is **removed** — it no longer applies.

### 2c. Swap usages
Replace `GoogleCalendarEmbed` imports/usages in [Dashboard.tsx](src/components/dashboard/Dashboard.tsx#L289) and [Step3Schedule.tsx](src/components/wizard/Step3Schedule.tsx#L531) with `RenderedCalendar` (same props: `height`, `onSetup`). Delete the old embed once nothing references it.

### 2d. Docs
Update [docs/synthesis.md](docs/synthesis.md) (integrations / feature set) and the in-app guide [UserGuide.tsx](src/components/guide/UserGuide.tsx) to describe the timeline overlay + the editable calendar view. Note in synthesis §7 that the embed is now API-rendered (private calendars supported).

---

## Phase 3 — DEFERRED (recorded direction only)

Auto-create an **"Orchestrate"** secondary calendar on connect and write session blocks to it. Chosen approach when built:
- **Scope:** add `https://www.googleapis.com/auth/calendar.app.created` to `SCOPES` in [functions/api/auth/google/_lib.ts](functions/api/auth/google/_lib.ts) (lines 29-31) — least-privilege; lets the app create/manage only its own calendar while `calendar.events` keeps read access to others. Requires **one re-consent** (handle the scope-mismatch case in `checkConnection`/status).
- New API fns `createCalendar` (`POST /calendars`) + reuse `createCalendarEvent` ([:83-93](src/lib/googleCalendarApi.ts#L83-L93), the long-dormant plumbing).
- Persist the created calendar id + a `sessionId → googleEventId` map — this **is** a schema change: bump `SCHEMA_VERSION` (currently 7.4) and add one forward step in `migrateToCurrent` per the CLAUDE.md schema posture.
- Decide write triggers (on session edit vs. on day finalize) and conflict handling (user edits the event in Google) at that time.

---

## Files to touch (Phases 1–2)

| File | Change |
|---|---|
| [src/lib/googleCalendarApi.ts](src/lib/googleCalendarApi.ts) | `listEvents`, `patchEvent`, `CalendarEvent` type; reuse `calFetch` |
| [src/context/GoogleCalendarContext.tsx](src/context/GoogleCalendarContext.tsx) | `listDayEvents`/range fetch + `patchEvent` actions; extend `GoogleCalendarActionsValue` |
| `src/hooks/useDayCalendarEvents.ts` (new) | day-events hook + in-memory cache |
| [src/components/ui/SessionTimelineBar.tsx](src/components/ui/SessionTimelineBar.tsx) | `externalEvents` prop + faded read-only event lane |
| [src/components/dashboard/SessionTimeline.tsx](src/components/dashboard/SessionTimeline.tsx), [src/components/wizard/Step3Schedule.tsx](src/components/wizard/Step3Schedule.tsx) | pass `externalEvents` |
| `src/components/todoist/RenderedCalendar.tsx` (new) | FullCalendar view; deletes `GoogleCalendarEmbed.tsx` |
| [src/components/dashboard/Dashboard.tsx](src/components/dashboard/Dashboard.tsx), Step3Schedule.tsx | swap embed → `RenderedCalendar` |
| `package.json` | FullCalendar deps |
| [docs/synthesis.md](docs/synthesis.md), [src/components/guide/UserGuide.tsx](src/components/guide/UserGuide.tsx) | feature-set + mental-model updates |

## Reuse (don't reinvent)
- `calFetch` (401→`GoogleAuthError`), `getAccessToken` (token cache + dedup), `handleError` routing — all in the existing API client / context.
- `isoLocalMinutes`, `slotPosition` math, `packLaneMarkers` row-packing in SessionTimelineBar.
- `timeToMinutes`/`minutesOfDay`/`todayISO` in [src/lib/time.ts](src/lib/time.ts).
- `settings.googleCalendarIds` (id + color + name) and `calendarViewMode` are already populated by [GoogleCalendarSetup.tsx](src/components/settings/GoogleCalendarSetup.tsx) — no setup-UI change needed.

## Verification
1. `npm run lint` + `npm run build` clean.
2. `npm run dev`, connect Google in Settings → Integrations, select calendars incl. a **private** one.
3. **Phase 1:** Dashboard timeline shows faded event blocks at correct times; hover shows titles; all-day events excluded; nothing shown when disconnected or no calendars selected; bar unaffected when `externalEvents` omitted.
4. **Phase 2:** Calendar view renders events incl. the private calendar; week/month/agenda toggle persists; drag an event to a new time and resize it → reload/refetch confirms the change persisted in Google (events.patch); a forced failure reverts the drag and surfaces an error.
5. Disconnect → both surfaces fall back to empty/connect states cleanly.
