import type { Playlist } from '../types';

export const playlists: Playlist[] = [
    {
        id: 'start-work',
        name: 'Start Work',
        workLabel: 'Getting Started',
        description: 'Electronic Focus — consistent, slightly energizing. Use to start your session and overcome inertia.',
        emoji: '\u{1F680}',
        spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX3Ogo9pFvBkY',
        workTypes: [],
    },
    {
        id: 'deep-focus',
        name: 'Deep Focus',
        workLabel: 'Coding & Problem Solving',
        description: 'Ambient, minimal, no lyrics. For coding and hard thinking.',
        emoji: '\u{1F9E0}',
        spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ',
        workTypes: ['coding'],
    },
    {
        id: 'lo-fi',
        name: 'Lo-Fi Beats',
        workLabel: 'Lectures & Light Work',
        description: 'For lectures and light work.',
        emoji: '\u{1F30A}',
        spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DWWQRwui0ExPn',
        workTypes: ['lecture'],
    },
    {
        id: 'brain-food',
        name: 'Brain Food',
        workLabel: 'Restless & High Energy',
        description: 'More stimulating but still controlled. For restless or high-energy days.',
        emoji: '\u{1F525}',
        spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX8tZsk68tuDw',
        workTypes: ['restless'],
    },
    {
        id: 'peaceful-piano',
        name: 'Peaceful Piano',
        workLabel: 'Foggy & Low Energy',
        description: 'For foggy or low-energy states.',
        emoji: '\u{1F9F1}',
        spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO',
        workTypes: ['low-energy'],
    },
    {
        id: 'white-noise',
        name: 'White Noise',
        workLabel: 'Deep Reading & Focus Lock',
        description: 'No-music alternative. For deep reading or when you are fully locked in.',
        emoji: '\u{1F507}',
        spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DWUZ5bk6qqDSy',
        workTypes: ['reading'],
    },
];

export function getPlaylistForWorkType(workType: string): Playlist | undefined {
    return playlists.find((p) => (p.workTypes as string[]).includes(workType));
}
