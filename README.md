# 🎸 Spotify Artist Organizer

Organize your followed Spotify artists into custom categories.

**Live app:** https://albocanegra.github.io/spotify-organizer

## Features

- 📂 Create custom categories for your followed artists
- 🔄 Syncs across all devices via Spotify
- ⚡ Instant UI updates (background sync)
- 🔒 Private playlists (only you can see them)

## How It Works

1. Connect your Spotify account
2. Create categories (e.g., Rock, Jazz, Electronic)
3. Move artists between categories
4. Categories are stored as private playlists in your Spotify account

## Tech Stack

- Vanilla JavaScript + React (via CDN)
- Spotify Web API with OAuth PKCE flow
- GitHub Pages hosting
- No backend required

## Setup Your Own Instance

1. Create a Spotify app at [developer.spotify.com](https://developer.spotify.com/dashboard)
2. Set the redirect URI to your GitHub Pages URL
3. Update `js/config.js` with your Client ID and redirect URI
4. Deploy to GitHub Pages

## Security

- Uses OAuth 2.0 with PKCE (no client secret exposed)
- Only requests necessary permissions
- All playlists created are private
- Optional: Restrict access to specific Spotify user IDs in `config.js`

## Restricting Access

To limit who can use your instance, edit `js/config.js`:

```javascript
export const ALLOWED_USER_IDS = [
  'your_spotify_user_id'  // Add user IDs here
];
```

## File Structure

```
├── index.html          # App shell
└── js/
    ├── config.js       # Configuration (Client ID, etc.)
    ├── auth.js         # OAuth authentication
    ├── spotify-api.js  # Spotify API calls
    ├── app.js          # React UI component
    └── utils.js        # Utility functions
```

## License

MIT

