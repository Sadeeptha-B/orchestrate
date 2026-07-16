import { useEffect, useMemo, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useGoogleCalendarData, useGoogleCalendarActions } from '../../hooks/useGoogleCalendar';
import { AccountMismatchBanner } from '../ui/AccountMismatchBanner';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/formStyles';
import { isVisibleInCalendar, isVisibleOnTimeline, type CalendarSurface } from '../../lib/googleCalendar';
import { GoogleConnectCard } from './GoogleConnectCard';
import type { GoogleCalendarEntry } from '../../types';
import type { GoogleCalendarListEntry } from '../../lib/googleCalendarApi';

/**
 * Settings → Integrations: the Google Calendar panel. Composes the reusable GoogleConnectCard
 * (OAuth kick-off / status / callback handling — also used by onboarding) with the settings-only
 * configuration: per-calendar visibility (`settings.googleCalendarIds`, independent
 * `showOnTimeline` / `showInCalendar` flags) and the app-managed Orchestrate calendar.
 * Authentication is handled at the edge by Cloudflare Access; the Worker holds the OAuth client
 * secret + per-user refresh tokens (server-mediated flow, option E2).
 */
export function GoogleCalendarSetup() {
    const { settings, dispatch } = useDayPlan();
    const { isConnected, availableCalendars, hasCalendarManageScope, accountMismatch } = useGoogleCalendarData();
    const { connect, disconnect, refreshCalendars, ensureOrchestrateCalendar, recreateOrchestrateCalendar, renameOrchestrateCalendar, adoptCurrentAccount } =
        useGoogleCalendarActions();

    const orchestrateName = settings.orchestrateCalendarName ?? 'Orchestrate';
    const orchestrateCalendar = settings.orchestrateCalendarId
        ? availableCalendars.find((c) => c.id === settings.orchestrateCalendarId)
        : undefined;

    // The name is a local draft so we don't hit the Google API on every keystroke; committing it
    // (blur / Enter) renames the linked calendar in place (or relinks to a same-named one).
    const [nameDraft, setNameDraft] = useState(orchestrateName);
    useEffect(() => {
        setNameDraft(orchestrateName);
    }, [orchestrateName]);
    const commitName = () => {
        const next = nameDraft.trim();
        if (!next || next === orchestrateName) return;
        void renameOrchestrateCalendar(next);
    };

    const entriesById = useMemo(
        () => new Map((settings.googleCalendarIds ?? []).map((c) => [c.id, c] as const)),
        [settings.googleCalendarIds],
    );

    // A calendar is "visible on a surface" only if it's tracked (in googleCalendarIds) AND its flag
    // for that surface isn't explicitly off. Untracked calendars are off everywhere.
    const isOn = (cal: GoogleCalendarListEntry, surface: CalendarSurface): boolean => {
        const entry = entriesById.get(cal.id);
        if (!entry) return false;
        return surface === 'timeline' ? isVisibleOnTimeline(entry) : isVisibleInCalendar(entry);
    };

    // Flip one surface's visibility for a calendar. Adds the entry on first enable; drops it once both
    // surfaces are off, so googleCalendarIds stays "the calendars I show somewhere".
    const setSurface = (cal: GoogleCalendarListEntry, surface: CalendarSurface, on: boolean) => {
        const list = settings.googleCalendarIds ?? [];
        const existing = entriesById.get(cal.id);
        // Fresh metadata from the live list; a brand-new entry starts with the other surface off.
        const prevTimeline = existing ? isVisibleOnTimeline(existing) : false;
        const prevCalendar = existing ? isVisibleInCalendar(existing) : false;
        const next: GoogleCalendarEntry = {
            id: cal.id,
            name: cal.name,
            color: cal.color,
            primary: cal.primary,
            showOnTimeline: surface === 'timeline' ? on : prevTimeline,
            showInCalendar: surface === 'calendar' ? on : prevCalendar,
        };
        const keep = isVisibleOnTimeline(next) || isVisibleInCalendar(next);
        let updated: GoogleCalendarEntry[];
        if (existing) {
            updated = list
                .map((c) => (c.id === cal.id ? next : c))
                .filter((c) => isVisibleOnTimeline(c) || isVisibleInCalendar(c));
        } else {
            updated = keep ? [...list, next] : list;
        }
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: { googleCalendarIds: updated.length > 0 ? updated : undefined },
        });
    };

    return (
        <div>
            <h3 className="text-sm font-semibold mb-2">Google Calendar</h3>

            <div className="space-y-3">
                {/* v7.11: account-mismatch notice — calendar selections/provisioning are paused so a
                    foreign store's references aren't pruned or re-provisioned silently. */}
                {accountMismatch && (
                    <AccountMismatchBanner
                        provider="Google"
                        mismatch={accountMismatch}
                        intro="Your calendar setup was made on"
                        paused="Calendar selections and the Orchestrate calendar are left untouched until you reconnect the original account or adopt this one."
                        onAdopt={adoptCurrentAccount}
                    />
                )}
                <GoogleConnectCard
                    returnTo="settings"
                    manageControls={
                        <>
                            <button
                                type="button"
                                onClick={refreshCalendars}
                                className="text-xs text-text-light hover:text-accent cursor-pointer"
                                title="Re-fetch your calendar list"
                            >
                                ↻ Refresh calendars
                            </button>
                            <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
                                Disconnect
                            </Button>
                        </>
                    }
                />

                {isConnected && (
                    <>
                        <div>
                            <p className="text-xs text-text-light mb-2">
                                Choose where each calendar appears — as faded context on the{' '}
                                <strong>Timeline</strong> bar, in the full <strong>Calendar</strong> view, or both.
                            </p>
                            {availableCalendars.length === 0 ? (
                                <p className="text-xs text-text-light">No calendars found.</p>
                            ) : (
                                <ul className="space-y-1">
                                    {/* Column headings for the two surface toggles. */}
                                    <li className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-light/70 pr-1">
                                        <span className="flex-1" />
                                        <span className="w-16 text-center">Timeline</span>
                                        <span className="w-16 text-center">Calendar</span>
                                    </li>
                                    {availableCalendars.map((cal) => (
                                        <li key={cal.id} className="flex items-center gap-2 text-sm">
                                            <span
                                                className="w-3 h-3 rounded-sm flex-shrink-0 border border-border"
                                                style={{ backgroundColor: cal.color ?? 'transparent' }}
                                            />
                                            <span className="flex-1 min-w-0 truncate" title={cal.id}>
                                                {cal.name}
                                                {cal.primary && (
                                                    <span className="ml-1.5 text-[10px] text-text-light">(primary)</span>
                                                )}
                                            </span>
                                            <span className="w-16 flex justify-center">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`Show ${cal.name ?? 'calendar'} on the timeline`}
                                                    checked={isOn(cal, 'timeline')}
                                                    onChange={(e) => setSurface(cal, 'timeline', e.target.checked)}
                                                    className="cursor-pointer accent-accent"
                                                />
                                            </span>
                                            <span className="w-16 flex justify-center">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`Show ${cal.name ?? 'calendar'} in the calendar view`}
                                                    checked={isOn(cal, 'calendar')}
                                                    onChange={(e) => setSurface(cal, 'calendar', e.target.checked)}
                                                    className="cursor-pointer accent-accent"
                                                />
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* v7.7: dedicated app-managed calendar for written-back sessions. */}
                        <div className="pt-3 border-t border-border">
                            <label className={`block text-xs font-medium text-text mb-1`} htmlFor="orch-cal-name">
                                Orchestrate calendar
                            </label>
                            <p className="text-xs text-text-light mb-2">
                                Sessions are written back to this dedicated calendar (with any No Distraction
                                blocklist suffix appended). Use <strong>Sync</strong> on the timeline / calendar to push them.
                            </p>
                            <input
                                id="orch-cal-name"
                                type="text"
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                onBlur={commitName}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                    } else if (e.key === 'Escape') {
                                        setNameDraft(orchestrateName);
                                    }
                                }}
                                placeholder="Orchestrate"
                                className={inputClass}
                            />
                            <div className="mt-2 text-xs">
                                {!hasCalendarManageScope ? (
                                    <span className="text-amber-600 dark:text-amber-400">
                                        Reconnect to grant calendar-creation access, then the calendar is created automatically.{' '}
                                        <button
                                            type="button"
                                            onClick={() => void connect()}
                                            className="underline hover:text-accent cursor-pointer"
                                        >
                                            Reconnect
                                        </button>
                                    </span>
                                ) : orchestrateCalendar ? (
                                    <span className="text-success">
                                        Created — “{orchestrateCalendar.name}” is linked.
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void recreateOrchestrateCalendar(nameDraft.trim() || orchestrateName);
                                            }}
                                            className="ml-2 text-text-light underline hover:text-accent cursor-pointer"
                                        >
                                            Recreate
                                        </button>
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => void ensureOrchestrateCalendar(nameDraft.trim() || orchestrateName)}
                                        className="text-accent underline hover:text-accent/80 cursor-pointer"
                                    >
                                        Create the Orchestrate calendar now
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
