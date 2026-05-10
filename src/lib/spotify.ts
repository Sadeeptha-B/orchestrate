/** Extract the Spotify playlist ID from an `open.spotify.com/playlist/<id>` URL. */
export function spotifyPlaylistId(url: string): string {
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    return match?.[1] ?? '';
}

export function isValidSpotifyUrl(url: string): boolean {
    return /^https:\/\/open\.spotify\.com\/playlist\/[a-zA-Z0-9]+/.test(url.trim());
}
