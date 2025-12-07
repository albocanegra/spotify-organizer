// Spotify API wrapper functions

import { 
  CATEGORY_PREFIX, 
  DATA_PLAYLIST_PREFIX, 
  DESCRIPTION_MAX_LENGTH 
} from './config.js';

// Simple delay helper for rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Rate-limited fetch with retry on 429
async function rateLimitedFetch(url, options, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
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
    
    if (nextUrl) await delay(100);
  }
  
  return results;
}

// ============================================
// USER & ARTISTS
// ============================================

export async function getCurrentUser(token) {
  const response = await rateLimitedFetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}

export async function getFollowedArtists(token) {
  // The following endpoint has a different pagination structure
  const results = [];
  let url = 'https://api.spotify.com/v1/me/following?type=artist&limit=50';
  
  while (url) {
    const response = await rateLimitedFetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    
    if (data.artists?.items) {
      results.push(...data.artists.items);
    }
    
    // Following endpoint uses data.artists.next, not data.next
    url = data.artists?.next || null;
    
    if (url) await delay(100);
  }
  
  return results;
}

// ============================================
// PLAYLIST OPERATIONS
// ============================================

export async function getUserPlaylists(token) {
  return fetchAllPages(
    'https://api.spotify.com/v1/me/playlists?limit=50',
    token
  );
}

async function createPlaylist(token, userId, name, description, isPublic = false) {
  const response = await rateLimitedFetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, description, public: isPublic })
  });
  return response.json();
}

async function updatePlaylistDescription(token, playlistId, description) {
  return rateLimitedFetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ description })
  });
}

async function deletePlaylist(token, playlistId) {
  return rateLimitedFetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

// ============================================
// CATEGORY PLAYLISTS (Visual markers - empty)
// ============================================

export async function createCategoryPlaylist(token, userId, categoryName) {
  const name = `${CATEGORY_PREFIX}${categoryName}`;
  const description = `Artists categorized as "${categoryName}" - managed by Artist Organizer`;
  const playlist = await createPlaylist(token, userId, name, description, false);
  return playlist;
}

export async function deleteCategoryPlaylist(token, playlistId) {
  if (!playlistId) return;
  return deletePlaylist(token, playlistId);
}

export async function getCategoryPlaylists(token, userId) {
  const allPlaylists = await getUserPlaylists(token);
  
  const categoryPlaylists = {};
  allPlaylists
    .filter(p => p?.name?.startsWith(CATEGORY_PREFIX) && p.owner.id === userId)
    .forEach(p => {
      const categoryName = p.name.substring(CATEGORY_PREFIX.length);
      categoryPlaylists[categoryName] = p.id;
    });
  
  return categoryPlaylists;
}

// ============================================
// DATA STORAGE (Chunked JSON in descriptions)
// ============================================

function chunkData(jsonString, maxLength) {
  const chunks = [];
  for (let i = 0; i < jsonString.length; i += maxLength) {
    chunks.push(jsonString.substring(i, i + maxLength));
  }
  return chunks;
}

function getDataPlaylistName(index) {
  return index === 0 ? DATA_PLAYLIST_PREFIX : `${DATA_PLAYLIST_PREFIX}_${index + 1}`;
}

// Get valid data playlist names (exact matches only)
function isValidDataPlaylistName(name) {
  if (name === DATA_PLAYLIST_PREFIX) return true;
  const match = name.match(new RegExp(`^${DATA_PLAYLIST_PREFIX}_(\\d+)$`));
  return match !== null;
}

function getDataPlaylistIndex(name) {
  if (name === DATA_PLAYLIST_PREFIX) return 0;
  const match = name.match(new RegExp(`^${DATA_PLAYLIST_PREFIX}_(\\d+)$`));
  if (match) return parseInt(match[1], 10) - 1;
  return -1;
}

export async function saveCategoriesToSpotify(token, userId, categories) {
  const jsonString = JSON.stringify(categories);
  const chunks = chunkData(jsonString, DESCRIPTION_MAX_LENGTH);
  
  // Get existing data playlists
  const allPlaylists = await getUserPlaylists(token);
  const dataPlaylists = allPlaylists
    .filter(p => p?.name?.startsWith(DATA_PLAYLIST_PREFIX) && p.owner.id === userId)
    .sort((a, b) => a.name.localeCompare(b.name));
  
  // Update or create playlists for each chunk
  for (let i = 0; i < chunks.length; i++) {
    const playlistName = getDataPlaylistName(i);
    const existingPlaylist = dataPlaylists.find(p => p.name === playlistName);
    
    if (existingPlaylist) {
      await updatePlaylistDescription(token, existingPlaylist.id, chunks[i]);
    } else {
      await createPlaylist(token, userId, playlistName, chunks[i], false);
    }
    
    await delay(100);
  }
  
  // Delete any extra data playlists that are no longer needed
  for (let i = chunks.length; i < dataPlaylists.length; i++) {
    const playlistName = getDataPlaylistName(i);
    const playlistToDelete = dataPlaylists.find(p => p.name === playlistName);
    if (playlistToDelete) {
      await deletePlaylist(token, playlistToDelete.id);
      await delay(100);
    }
  }
}

async function getPlaylistDetails(token, playlistId) {
  const response = await rateLimitedFetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,description`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  return response.json();
}

export async function loadCategoriesFromSpotify(token, userId) {
  const allPlaylists = await getUserPlaylists(token);
  
  // Find data playlists with EXACT name matches only
  const dataPlaylistRefs = allPlaylists
    .filter(p => p?.owner?.id === userId && isValidDataPlaylistName(p?.name))
    .sort((a, b) => getDataPlaylistIndex(a.name) - getDataPlaylistIndex(b.name));
  
  console.log('Found data playlists:', dataPlaylistRefs.map(p => p.name));
  
  if (dataPlaylistRefs.length === 0) {
    return {};
  }
  
  // Fetch full details for each data playlist to get complete descriptions
  // Sort by index to ensure correct order
  const descriptions = new Array(dataPlaylistRefs.length);
  for (const playlistRef of dataPlaylistRefs) {
    const index = getDataPlaylistIndex(playlistRef.name);
    const fullPlaylist = await getPlaylistDetails(token, playlistRef.id);
    console.log(`Playlist ${playlistRef.name} (index ${index}):`, fullPlaylist.description?.substring(0, 50) + '...');
    descriptions[index] = fullPlaylist.description || '';
    await delay(50);
  }
  
  // Reconstruct JSON from chunks (filter out any undefined slots)
  let jsonString = descriptions.filter(d => d !== undefined).join('');
  
  // Spotify sometimes HTML-encodes the description, decode common entities
  jsonString = jsonString
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#38;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  
  // Debug logging
  console.log('Reconstructed JSON:', jsonString.substring(0, 200) + '...');
  console.log('Total length:', jsonString.length);
  
  if (!jsonString || jsonString.trim() === '') {
    console.log('No data found in playlists');
    return {};
  }
  
  try {
    const parsed = JSON.parse(jsonString);
    console.log('Successfully parsed categories:', Object.keys(parsed));
    return parsed;
  } catch (e) {
    console.error('Failed to parse categories data:', e);
    console.error('Raw JSON:', jsonString);
    
    // Try to find a valid JSON object in the string
    // Look for balanced braces
    let braceCount = 0;
    let start = jsonString.indexOf('{');
    if (start === -1) {
      console.error('No JSON object found');
      return { _corrupted: true };
    }
    
    for (let i = start; i < jsonString.length; i++) {
      if (jsonString[i] === '{') braceCount++;
      else if (jsonString[i] === '}') braceCount--;
      
      if (braceCount === 0) {
        const validJson = jsonString.substring(start, i + 1);
        try {
          console.log('Attempting to parse valid portion...');
          const parsed = JSON.parse(validJson);
          console.log('Recovered categories:', Object.keys(parsed));
          return parsed;
        } catch (e2) {
          console.error('Recovery failed:', e2);
          break;
        }
      }
    }
    
    return { _corrupted: true };
  }
}

// ============================================
// MIGRATION: Clean up old track-based playlists
// ============================================

export async function migrateFromOldFormat(token, userId) {
  const allPlaylists = await getUserPlaylists(token);
  const OLD_PREFIX = '🎸 ';
  
  // Find old-format playlists (🎸 but not 🎸 ArtistOrganizer/)
  const oldPlaylists = allPlaylists.filter(p => 
    p?.name?.startsWith(OLD_PREFIX) && 
    !p.name.startsWith(CATEGORY_PREFIX) &&
    p.owner.id === userId
  );
  
  if (oldPlaylists.length === 0) {
    return null; // No migration needed
  }
  
  // Extract category data from old playlists by reading their tracks
  const categories = {};
  
  for (const playlist of oldPlaylists) {
    const categoryName = playlist.name.substring(OLD_PREFIX.length);
    
    // Get tracks and extract artist IDs
    const tracks = await fetchAllPages(
      `https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100`,
      token
    );
    
    const artistIds = [...new Set(
      tracks
        .filter(t => t.track?.artists?.[0])
        .map(t => t.track.artists[0].id)
    )];
    
    if (artistIds.length > 0) {
      categories[categoryName] = artistIds;
    }
    
    await delay(100);
  }
  
  return { categories, oldPlaylists };
}

export async function deleteOldPlaylists(token, playlists) {
  for (const playlist of playlists) {
    await deletePlaylist(token, playlist.id);
    await delay(200);
  }
}

// Clean up all data playlists (for resetting corrupted data)
export async function resetAllData(token, userId) {
  const allPlaylists = await getUserPlaylists(token);
  
  // Delete all data playlists
  const dataPlaylists = allPlaylists.filter(p => 
    p?.name?.startsWith(DATA_PLAYLIST_PREFIX) && p.owner.id === userId
  );
  
  for (const playlist of dataPlaylists) {
    console.log('Deleting data playlist:', playlist.name);
    await deletePlaylist(token, playlist.id);
    await delay(200);
  }
  
  // Delete all category playlists
  const categoryPlaylists = allPlaylists.filter(p => 
    p?.name?.startsWith(CATEGORY_PREFIX) && p.owner.id === userId
  );
  
  for (const playlist of categoryPlaylists) {
    console.log('Deleting category playlist:', playlist.name);
    await deletePlaylist(token, playlist.id);
    await delay(200);
  }
  
  return { deletedData: dataPlaylists.length, deletedCategories: categoryPlaylists.length };
}
