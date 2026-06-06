import { useContext } from 'react';
import {
    GoogleCalendarDataContext,
    GoogleCalendarActionsContext,
    type GoogleCalendarDataValue,
    type GoogleCalendarActionsValue,
} from '../context/GoogleCalendarContext';

/** Read-only Google Calendar state (connection status, available calendars). */
export function useGoogleCalendarData(): GoogleCalendarDataValue {
    const ctx = useContext(GoogleCalendarDataContext);
    if (!ctx) throw new Error('useGoogleCalendarData must be used within GoogleCalendarProvider');
    return ctx;
}

/** Google Calendar actions (connect/disconnect, refresh, createEvent). */
export function useGoogleCalendarActions(): GoogleCalendarActionsValue {
    const ctx = useContext(GoogleCalendarActionsContext);
    if (!ctx) throw new Error('useGoogleCalendarActions must be used within GoogleCalendarProvider');
    return ctx;
}
