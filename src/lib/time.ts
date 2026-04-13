/** Convert "HH:mm" to total minutes since midnight. */
export function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}
