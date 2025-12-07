// Application configuration

export const CLIENT_ID = 'e21bf88870a94703bc0cdcf317075a5e';
export const REDIRECT_URI = 'https://albocanegra.github.io/spotify-organizer';
// Only request necessary scopes (principle of least privilege)
export const SCOPES = 'user-follow-read playlist-read-private playlist-modify-private';

// Optional: Restrict access to specific Spotify user IDs (leave empty for public access)
// Add your Spotify user ID here to restrict access
export const ALLOWED_USER_IDS = [
  // 'your_spotify_user_id_here'  // Uncomment and add your ID to restrict access
];

export const APP_VERSION = 'v4.1.1';

// Playlist naming conventions
export const CATEGORY_PREFIX = '🎸 ArtistOrganizer/';  // Visual category playlists
export const DATA_PLAYLIST_PREFIX = '__ArtistOrganizer_Data';  // Hidden data storage

// Spotify description limit (with safety margin)
export const DESCRIPTION_MAX_LENGTH = 280;
