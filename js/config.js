// Application configuration

export const CLIENT_ID = 'e21bf88870a94703bc0cdcf317075a5e';
export const REDIRECT_URI = 'https://albocanegra.github.io/spotify-organizer';
export const SCOPES = 'user-follow-read playlist-read-private playlist-modify-private playlist-modify-public';

export const APP_VERSION = 'v4.1.0';

// Playlist naming conventions
export const CATEGORY_PREFIX = '🎸 ArtistOrganizer/';  // Visual category playlists
export const DATA_PLAYLIST_PREFIX = '__ArtistOrganizer_Data';  // Hidden data storage

// Spotify description limit (with safety margin)
export const DESCRIPTION_MAX_LENGTH = 280;
