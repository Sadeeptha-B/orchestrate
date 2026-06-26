/**
 * v7.8: reminder cadence constants. The hourly recontextualization check-in cadence is configurable
 * (Settings → Configuration → Reminders); `0` disables it entirely.
 */
export const DEFAULT_RECONTEXT_CADENCE_MINUTES = 60;

/** Idle minutes before the engagement nudge first fires. Configurable; `0` disables it. */
export const DEFAULT_ENGAGEMENT_NUDGE_MINUTES = 10;

/** How often the engagement nudge re-fires while the user stays idle past the threshold. */
export const ENGAGEMENT_NUDGE_REPEAT_MINUTES = 30;
