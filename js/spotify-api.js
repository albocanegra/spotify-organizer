// Spotify API wrapper functions

const PLAYLIST_PREFIX = '🎸 ';

// Simple delay helper for rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Rate-limited fetch with retry on 429
async function rateLimitedFetch(url, options, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      // Get retry-after header or default to 1 second
      const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
      console.log(`Rate limited, waiting ${retryAfter}s...`);
      await delay(retryAfter * 1000);
      continue;
    }
    
    return response;
  }
  
  throw new Error('Max retries exceeded');
}

// Helper for paginated fetches with rate limiting
async function fetchAllPages(url, token, getItems = data => data.items) {
  const results = [];
  let nextUrl = url;
  
  while (nextUrl) {
    const response = await rateLimitedFetch(nextUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    results.push(...(getItems(data) || []));
    nextUrl = data.next;
    
    // Small delay between pages to avoid rate limits
    if (nextUrl) await delay(100);
  }
  
  return results;
}

// User profile
export async function getCurrentUser(token) {
  const response = await rateLimitedFetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

// Followed artists
export async function getFollowedArtists(token) {
  return fetchAllPages(
    'https://api.spotify.com/v1/me/following?type=artist&limit=50',
    token,
    data => data.artists?.items
  );
}

// Get artist's top track
export async function getArtistTopTrack(token, artistId) {
  const response = await rateLimitedFetch(
    `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const data = await response.json();
  return data.tracks?.[0]?.uri || null;
}

// Playlist operations
export async function getUserPlaylists(token) {
  return fetchAllPages(
    'https://api.spotify.com/v1/me/playlists?limit=50',
    token
  );
}

export async function getPlaylistTracks(token, playlistId) {
  if (!playlistId) {
    console.warn('getPlaylistTracks called with undefined playlistId');
    return [];
  }
  
  return fetchAllPages(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`,
    token
  );
}

export async function createPlaylist(token, userId, name, description) {
  const response = await rateLimitedFetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: `${PLAYLIST_PREFIX}${name}`,
      description,
      public: false
    })
  });
  return response.json();
}

export async function deletePlaylist(token, playlistId) {
  if (!playlistId) {
    console.warn('deletePlaylist called with undefined playlistId');
    return;
  }
  
  return rateLimitedFetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

export async function addTracksToPlaylist(token, playlistId, trackUris) {
  if (!playlistId) {
    console.warn('addTracksToPlaylist called with undefined playlistId');
    return;
  }
  if (!trackUris.length) return;
  
  // Spotify allows max 100 tracks per request
  for (let i = 0; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100);
    await rateLimitedFetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: batch })
    });
    
    // Delay between batches
    if (i + 100 < trackUris.length) await delay(200);
  }
}

export async function removeTracksFromPlaylist(token, playlistId, trackUris) {
  if (!playlistId) {
    console.warn('removeTracksFromPlaylist called with undefined playlistId');
    return;
  }
  if (!trackUris.length) return;
  
  const tracks = trackUris.map(uri => ({ uri }));
  return rateLimitedFetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ tracks })
  });
}

// Category-specific operations
export async function loadCategoriesFromPlaylists(token, userId) {
  const allPlaylists = await getUserPlaylists(token);
  
  // Filter to only our category playlists
  const categoryPlaylists = allPlaylists.filter(p => 
    p?.name?.startsWith(PLAYLIST_PREFIX) && p.owner.id === userId
  );
  
  if (categoryPlaylists.length === 0) {
    return { categories: {}, playlistIds: {} };
  }

  const categories = {};
  const playlistIds = {};

  // Process playlists SEQUENTIALLY to avoid rate limits
  for (const playlist of categoryPlaylists) {
    const categoryName = playlist.name.substring(PLAYLIST_PREFIX.length);
    const tracks = await getPlaylistTracks(token, playlist.id);
    
    // Extract unique artist IDs from tracks
    const artistIds = [...new Set(
      tracks
        .filter(t => t.track?.artists?.[0])
        .map(t => t.track.artists[0].id)
    )];
    
    categories[categoryName] = artistIds;
    playlistIds[categoryName] = playlist.id;
    
    // Small delay between playlists
    await delay(100);
  }
  
  return { categories, playlistIds };
}

export async function addArtistsToPlaylist(token, playlistId, artists) {
  if (!playlistId) {
    console.warn('addArtistsToPlaylist called with undefined playlistId');
    return;
  }
  if (!artists.length) return;
  
  // Fetch top tracks SEQUENTIALLY to avoid rate limits
  const trackUris = [];
  for (const artist of artists) {
    const uri = await getArtistTopTrack(token, artist.id);
    if (uri) trackUris.push(uri);
    await delay(50); // Small delay between artist lookups
  }
  
  await addTracksToPlaylist(token, playlistId, trackUris);
}

export async function removeArtistFromPlaylist(token, playlistId, artistId) {
  if (!playlistId) {
    console.warn('removeArtistFromPlaylist called with undefined playlistId');
    return;
  }
  
  const tracks = await getPlaylistTracks(token, playlistId);
  
  const tracksToRemove = tracks
    .filter(t => t.track?.artists?.[0]?.id === artistId)
    .map(t => t.track.uri);
  
  await removeTracksFromPlaylist(token, playlistId, tracksToRemove);
}

export { PLAYLIST_PREFIX };
