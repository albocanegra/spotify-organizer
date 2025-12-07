// Main React Application Component

import { APP_VERSION } from './config.js';
import { initiateLogin, exchangeCodeForToken, getStoredToken } from './auth.js';
import * as spotify from './spotify-api.js';

const { useState, useEffect, createElement: h } = React;

export function SpotifyOrganizer() {
  const [accessToken, setAccessToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [artists, setArtists] = useState([]);
  const [categories, setCategories] = useState({});
  const [categoryPlaylists, setCategoryPlaylists] = useState({});
  const [loading, setLoading] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    
    if (code) {
      handleOAuthCallback(code);
    } else {
      const token = getStoredToken();
      if (token) {
        setAccessToken(token);
        initializeApp(token);
      }
    }
  }, []);

  const showStatus = (message, duration = 3000) => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(''), duration);
  };

  const handleOAuthCallback = async (code) => {
    setLoading(true);
    try {
      const token = await exchangeCodeForToken(code);
      setAccessToken(token);
      await initializeApp(token);
    } catch (err) {
      console.error('Auth error:', err);
      showStatus('✗ Authentication failed');
    }
    setLoading(false);
  };

  const initializeApp = async (token) => {
    setLoading(true);
    try {
      const userData = await spotify.getCurrentUser(token);
      setUserId(userData.id);
      
      // Load categories and artists
      const { categories: loadedCategories, playlistIds } = await spotify.loadCategoriesFromPlaylists(token, userData.id);
      const allArtists = await spotify.getFollowedArtists(token);
      setArtists(allArtists);
      
      // Find uncategorized artists
      const categorizedIds = new Set(Object.values(loadedCategories).flat());
      const uncategorizedArtists = allArtists.filter(a => !categorizedIds.has(a.id));
      
      if (uncategorizedArtists.length > 0) {
        const updatedPlaylists = { ...playlistIds };
        
        if (!updatedPlaylists['Uncategorized']) {
          const playlist = await spotify.createPlaylist(
            token, 
            userData.id, 
            'Uncategorized',
            'Artists not yet categorized - managed by Artist Organizer'
          );
          updatedPlaylists['Uncategorized'] = playlist.id;
        }
        
        await spotify.addArtistsToPlaylist(token, updatedPlaylists['Uncategorized'], uncategorizedArtists);
        
        loadedCategories['Uncategorized'] = [
          ...(loadedCategories['Uncategorized'] || []),
          ...uncategorizedArtists.map(a => a.id)
        ];
        
        setCategoryPlaylists(updatedPlaylists);
      } else {
        setCategoryPlaylists(playlistIds);
      }
      
      setCategories(loadedCategories);
    } catch (err) {
      console.error('Init error:', err);
      showStatus('✗ Failed to load data');
    }
    setLoading(false);
  };

  const addCategory = async () => {
    if (!newCategoryName.trim() || categories[newCategoryName]) return;
    
    const categoryName = newCategoryName.trim();
    showStatus('Creating category...');
    
    try {
      const playlist = await spotify.createPlaylist(
        accessToken,
        userId,
        categoryName,
        `Artists categorized as "${categoryName}" - managed by Artist Organizer`
      );
      
      setCategories(prev => ({ ...prev, [categoryName]: [] }));
      setCategoryPlaylists(prev => ({ ...prev, [categoryName]: playlist.id }));
      setNewCategoryName('');
      setShowNewCategory(false);
      showStatus('✓ Category created');
    } catch (err) {
      console.error('Error creating category:', err);
      showStatus('✗ Error creating category');
    }
  };

  const deleteCategory = async (categoryName) => {
    if (categoryName === 'Uncategorized') return;
    
    const playlistId = categoryPlaylists[categoryName];
    const uncategorizedPlaylistId = categoryPlaylists['Uncategorized'];
    const artistsToMove = categories[categoryName] || [];
    
    if (!playlistId) {
      showStatus('✗ Category playlist not found');
      return;
    }
    
    showStatus('Deleting category...');
    
    try {
      if (artistsToMove.length > 0 && uncategorizedPlaylistId) {
        const artistObjects = artistsToMove.map(id => artists.find(a => a.id === id)).filter(Boolean);
        await spotify.addArtistsToPlaylist(accessToken, uncategorizedPlaylistId, artistObjects);
      }
      
      await spotify.deletePlaylist(accessToken, playlistId);
      
      setCategories(prev => {
        const { [categoryName]: deleted, ...rest } = prev;
        return {
          ...rest,
          'Uncategorized': [...(rest['Uncategorized'] || []), ...artistsToMove]
        };
      });
      setCategoryPlaylists(prev => {
        const { [categoryName]: deleted, ...rest } = prev;
        return rest;
      });
      showStatus('✓ Category deleted');
    } catch (err) {
      console.error('Error deleting category:', err);
      showStatus('✗ Error deleting category');
    }
  };

  const moveArtist = async (artistId, fromCategory, toCategory) => {
    if (fromCategory === toCategory) return;
    
    const artist = artists.find(a => a.id === artistId);
    if (!artist) return;
    
    const fromPlaylistId = categoryPlaylists[fromCategory];
    const toPlaylistId = categoryPlaylists[toCategory];
    
    if (!fromPlaylistId || !toPlaylistId) {
      showStatus('✗ Playlist not found');
      return;
    }

    showStatus('Moving artist...', 1500);

    try {
      await spotify.removeArtistFromPlaylist(accessToken, fromPlaylistId, artistId);
      await spotify.addArtistsToPlaylist(accessToken, toPlaylistId, [artist]);
      
      setCategories(prev => {
        const updated = { ...prev };
        updated[fromCategory] = updated[fromCategory].filter(id => id !== artistId);
        updated[toCategory] = [...(updated[toCategory] || []), artistId];
        return updated;
      });
      showStatus('✓ Artist moved', 1500);
    } catch (err) {
      console.error('Error moving artist:', err);
      showStatus('✗ Error moving artist');
    }
  };

  const syncWithSpotify = async () => {
    if (!accessToken || !userId) return;
    
    setSyncing(true);
    showStatus('🔄 Syncing with Spotify...');
    
    try {
      const { categories: loadedCategories, playlistIds } = await spotify.loadCategoriesFromPlaylists(accessToken, userId);
      const allArtists = await spotify.getFollowedArtists(accessToken);
      setArtists(allArtists);
      
      // Find uncategorized artists
      const categorizedIds = new Set(Object.values(loadedCategories).flat());
      const currentArtistIds = new Set(allArtists.map(a => a.id));
      
      // Remove unfollowed artists from categories
      Object.keys(loadedCategories).forEach(cat => {
        loadedCategories[cat] = loadedCategories[cat].filter(id => currentArtistIds.has(id));
      });
      
      const uncategorizedArtists = allArtists.filter(a => !categorizedIds.has(a.id));
      
      if (uncategorizedArtists.length > 0) {
        const updatedPlaylists = { ...playlistIds };
        
        if (!updatedPlaylists['Uncategorized']) {
          const playlist = await spotify.createPlaylist(
            accessToken,
            userId,
            'Uncategorized',
            'Artists not yet categorized - managed by Artist Organizer'
          );
          updatedPlaylists['Uncategorized'] = playlist.id;
        }
        
        await spotify.addArtistsToPlaylist(accessToken, updatedPlaylists['Uncategorized'], uncategorizedArtists);
        
        loadedCategories['Uncategorized'] = [
          ...(loadedCategories['Uncategorized'] || []),
          ...uncategorizedArtists.map(a => a.id)
        ];
        
        setCategoryPlaylists(updatedPlaylists);
      } else {
        setCategoryPlaylists(playlistIds);
      }
      
      setCategories(loadedCategories);
      showStatus('✓ Sync complete!');
    } catch (err) {
      console.error('Sync error:', err);
      showStatus('✗ Sync failed');
    }
    setSyncing(false);
  };

  const scrollToCategory = (categoryName) => {
    const element = document.getElementById(`category-${categoryName}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const getArtistById = (id) => artists.find(a => a.id === id);

  // Render: Login screen
  if (!accessToken) {
    return h('div', { className: 'min-h-screen bg-gradient-to-br from-green-900 via-black to-black flex items-center justify-center p-4' },
      h('div', { className: 'bg-gray-900 rounded-lg p-8 max-w-md w-full text-center shadow-2xl' },
        h('div', { className: 'text-6xl mb-4' }, '🎸'),
        h('h1', { className: 'text-3xl font-bold text-white mb-2' }, 'Spotify Artist Organizer'),
        h('p', { className: 'text-gray-400 mb-6' }, 'Organize your followed artists into custom categories'),
        h('div', { className: 'bg-gray-800 border border-gray-700 rounded p-4 mb-6 text-left text-sm' },
          h('p', { className: 'text-gray-300 mb-2' }, 'Connect your Spotify account to start organizing your followed artists into custom categories.'),
          h('p', { className: 'text-green-400 text-xs font-semibold mb-2' }, '✓ Categories saved as playlists in your Spotify'),
          h('p', { className: 'text-green-400 text-xs font-semibold mb-2' }, '✓ Syncs across all your devices'),
          h('p', { className: 'text-gray-400 text-xs mb-2' }, 'Each category becomes a playlist with tracks from your categorized artists.'),
          h('p', { className: 'text-gray-500 text-xs text-right' }, APP_VERSION)
        ),
        h('button', {
          onClick: initiateLogin,
          className: 'bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-full transition'
        }, 'Connect with Spotify')
      )
    );
  }

  // Render: Loading screen
  if (loading) {
    return h('div', { className: 'min-h-screen bg-gradient-to-br from-green-900 via-black to-black flex items-center justify-center' },
      h('div', { className: 'text-center' },
        h('div', { className: 'text-6xl mb-4 animate-pulse' }, '🎸'),
        h('p', { className: 'text-white' }, 'Loading your artists...')
      )
    );
  }

  // Sort categories (Uncategorized always last)
  const categoryEntries = Object.entries(categories);
  categoryEntries.sort((a, b) => {
    if (a[0] === 'Uncategorized') return 1;
    if (b[0] === 'Uncategorized') return -1;
    return a[0].localeCompare(b[0]);
  });

  // Render: Main app
  return h('div', { className: 'min-h-screen bg-gradient-to-br from-green-900 via-black to-black p-4' },
    h('div', { className: 'max-w-6xl mx-auto' },
      // Status message toast
      statusMessage && h('div', { className: 'fixed top-4 right-4 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg z-50 border border-gray-700' },
        statusMessage
      ),
      
      // Header
      h('div', { className: 'flex items-center justify-between mb-6 flex-wrap gap-4' },
        h('div', { className: 'flex items-center gap-3' },
          h('div', { className: 'text-4xl' }, '🎸'),
          h('h1', { className: 'text-2xl font-bold text-white' }, 'My Artist Library'),
          h('span', { className: 'bg-green-500 text-black px-3 py-1 rounded-full text-sm font-semibold' }, `${artists.length} artists`),
          h('span', { className: 'bg-gray-800 text-gray-400 px-2 py-1 rounded text-xs' }, APP_VERSION)
        ),
        h('div', { className: 'flex gap-2 flex-wrap' },
          h('select', {
            onChange: (e) => {
              if (e.target.value) {
                scrollToCategory(e.target.value);
                e.target.value = '';
              }
            },
            className: 'bg-gray-800 text-white px-4 py-2 rounded-full border border-gray-700 cursor-pointer text-sm'
          },
            h('option', { value: '' }, '📂 Jump to Category...'),
            categoryEntries.map(([cat, artistIds]) => 
              h('option', { key: cat, value: cat }, `${cat} (${artistIds.length})`)
            )
          ),
          h('button', {
            onClick: syncWithSpotify,
            disabled: syncing,
            className: 'bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-full text-sm disabled:opacity-50'
          }, syncing ? '🔄 Syncing...' : '🔄 Sync'),
          h('button', {
            onClick: () => setShowNewCategory(!showNewCategory),
            className: 'bg-green-500 hover:bg-green-600 text-black font-semibold py-2 px-4 rounded-full'
          }, '➕ New Category')
        )
      ),
      
      // New category form
      showNewCategory && h('div', { className: 'bg-gray-900 rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-2' },
        h('input', {
          type: 'text',
          value: newCategoryName,
          onChange: (e) => setNewCategoryName(e.target.value),
          onKeyPress: (e) => e.key === 'Enter' && addCategory(),
          placeholder: 'Category name (e.g., Rock, Jazz, Electronic...)',
          className: 'flex-1 bg-gray-800 text-white px-4 py-2 rounded border border-gray-700 focus:border-green-500 outline-none'
        }),
        h('button', {
          onClick: addCategory,
          className: 'bg-green-500 hover:bg-green-600 text-black font-semibold px-4 py-2 rounded'
        }, 'Add'),
        h('button', {
          onClick: () => setShowNewCategory(false),
          className: 'bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded'
        }, 'Cancel')
      ),
      
      // Categories
      categoryEntries.length === 0 
        ? h('div', { className: 'bg-gray-900 rounded-lg p-8 text-center' },
            h('p', { className: 'text-gray-400 mb-4' }, 'No categories yet. Create your first category to start organizing!'),
            h('button', {
              onClick: () => setShowNewCategory(true),
              className: 'bg-green-500 hover:bg-green-600 text-black font-semibold py-2 px-4 rounded-full'
            }, '➕ Create First Category')
          )
        : h('div', { className: 'space-y-6' },
            categoryEntries.map(([categoryName, artistIds]) => {
              const categoryArtists = artistIds.map(id => getArtistById(id)).filter(Boolean);
              return h('div', { 
                key: categoryName, 
                id: `category-${categoryName}`,
                className: 'bg-gray-900 rounded-lg p-4 scroll-mt-6'
              },
                h('div', { className: 'flex items-center justify-between mb-4' },
                  h('div', { className: 'flex items-center gap-2' },
                    h('div', { className: 'text-2xl' }, categoryName === 'Uncategorized' ? '📥' : '📁'),
                    h('h2', { className: 'text-xl font-bold text-white' }, categoryName),
                    h('span', { className: 'text-gray-400 text-sm' }, `(${categoryArtists.length})`),
                    categoryPlaylists[categoryName] && h('a', {
                      href: `https://open.spotify.com/playlist/${categoryPlaylists[categoryName]}`,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      className: 'text-green-400 hover:text-green-300 text-xs ml-2'
                    }, '↗ Open Playlist')
                  ),
                  categoryName !== 'Uncategorized' && h('button', {
                    onClick: () => deleteCategory(categoryName),
                    className: 'text-red-400 hover:text-red-300 text-xl'
                  }, '🗑️')
                ),
                categoryArtists.length === 0
                  ? h('p', { className: 'text-gray-500 text-sm italic' }, 'No artists in this category')
                  : h('div', { className: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3' },
                      categoryArtists.map(artist =>
                        h('div', { key: artist.id, className: 'bg-gray-800 rounded-lg p-3' },
                          h('img', {
                            src: artist.images[0]?.url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23374151" width="100" height="100"/%3E%3C/svg%3E',
                            alt: artist.name,
                            className: 'w-full aspect-square object-cover rounded mb-2'
                          }),
                          h('p', { className: 'text-white font-semibold text-sm mb-1 truncate' }, artist.name),
                          h('a', {
                            href: artist.external_urls.spotify,
                            target: '_blank',
                            rel: 'noopener noreferrer',
                            className: 'block bg-green-500 hover:bg-green-600 text-black text-xs py-1 px-2 rounded text-center mb-2'
                          }, '🔗 Open in Spotify'),
                          h('select', {
                            value: categoryName,
                            onChange: (e) => moveArtist(artist.id, categoryName, e.target.value),
                            className: 'w-full bg-gray-700 text-white text-xs py-1 px-2 rounded border border-gray-600 outline-none'
                          }, categoryEntries.map(([cat]) => h('option', { key: cat, value: cat }, cat)))
                        )
                      )
                    )
              );
            })
          )
    )
  );
}

