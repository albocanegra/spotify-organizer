// Main React Application Component

import { APP_VERSION } from './config.js';
import { initiateLogin, exchangeCodeForToken, getStoredToken, clearAuth } from './auth.js';
import * as spotify from './spotify-api.js';

const { useState, useEffect, createElement: h } = React;

export function SpotifyOrganizer() {
  const [accessToken, setAccessToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [artists, setArtists] = useState([]);
  const [categories, setCategories] = useState({});
  const [categoryPlaylists, setCategoryPlaylists] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [showMigration, setShowMigration] = useState(false);
  const [migrationData, setMigrationData] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false); // Background save indicator

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
    if (duration > 0) {
      setTimeout(() => setStatusMessage(''), duration);
    }
  };

  // Background save helper - updates UI immediately, syncs in background
  const saveInBackground = async (newCategories) => {
    setIsSaving(true);
    try {
      await spotify.saveCategoriesToSpotify(accessToken, userId, newCategories);
    } catch (err) {
      console.error('Background save failed:', err);
      showStatus('⚠️ Sync failed - changes may not be saved', 4000);
    }
    setIsSaving(false);
  };

  const handleOAuthCallback = async (code) => {
    setLoading(true);
    setLoadingMessage('Authenticating...');
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
      setLoadingMessage('Getting user info...');
      const userData = await spotify.getCurrentUser(token);
      setUserId(userData.id);
      
      // Check for old format and offer migration
      setLoadingMessage('Checking for existing data...');
      const migration = await spotify.migrateFromOldFormat(token, userData.id);
      
      if (migration) {
        setMigrationData(migration);
        setShowMigration(true);
        setLoading(false);
        return;
      }
      
      // Load data normally
      await loadData(token, userData.id);
    } catch (err) {
      console.error('Init error:', err);
      showStatus('✗ Failed to load data');
    }
    setLoading(false);
  };

  const loadData = async (token, uid) => {
    setLoadingMessage('Loading categories...');
    let loadedCategories = await spotify.loadCategoriesFromSpotify(token, uid);
    
    // Check if data was corrupted
    if (loadedCategories._corrupted) {
      console.warn('Data appears corrupted - starting with empty categories');
      showStatus('⚠️ Data issue detected - your categories may need to be restored', 5000);
      loadedCategories = {};
      // Don't auto-reset - let user decide
    }
    
    setLoadingMessage('Loading followed artists...');
    const allArtists = await spotify.getFollowedArtists(token);
    setArtists(allArtists);
    
    setLoadingMessage('Loading category playlists...');
    const playlists = await spotify.getCategoryPlaylists(token, uid);
    setCategoryPlaylists(playlists);
    
    // Find uncategorized artists
    const categorizedIds = new Set(Object.values(loadedCategories).flat());
    const uncategorizedArtists = allArtists.filter(a => !categorizedIds.has(a.id));
    
    // Ensure Uncategorized category exists
    if (!loadedCategories['Uncategorized']) {
      loadedCategories['Uncategorized'] = [];
    }
    
    // Add new uncategorized artists
    if (uncategorizedArtists.length > 0) {
      loadedCategories['Uncategorized'] = [
        ...loadedCategories['Uncategorized'],
        ...uncategorizedArtists.map(a => a.id)
      ];
      
      // Save updated categories
      setLoadingMessage('Saving changes...');
      await spotify.saveCategoriesToSpotify(token, uid, loadedCategories);
    }
    
    // Ensure Uncategorized playlist exists
    if (!playlists['Uncategorized']) {
      setLoadingMessage('Creating Uncategorized playlist...');
      const playlist = await spotify.createCategoryPlaylist(token, uid, 'Uncategorized');
      playlists['Uncategorized'] = playlist.id;
      setCategoryPlaylists(playlists);
    }
    
    // Remove unfollowed artists from categories
    const currentArtistIds = new Set(allArtists.map(a => a.id));
    let hasChanges = false;
    Object.keys(loadedCategories).forEach(cat => {
      const before = loadedCategories[cat].length;
      loadedCategories[cat] = loadedCategories[cat].filter(id => currentArtistIds.has(id));
      if (loadedCategories[cat].length !== before) hasChanges = true;
    });
    
    if (hasChanges) {
      await spotify.saveCategoriesToSpotify(token, uid, loadedCategories);
    }
    
    setCategories(loadedCategories);
  };

  const handleMigration = async (shouldMigrate) => {
    setShowMigration(false);
    setLoading(true);
    
    try {
      if (shouldMigrate && migrationData) {
        setLoadingMessage('Migrating data to new format...');
        
        // Save categories in new format
        await spotify.saveCategoriesToSpotify(accessToken, userId, migrationData.categories);
        
        // Create visual category playlists
        const playlists = {};
        for (const categoryName of Object.keys(migrationData.categories)) {
          setLoadingMessage(`Creating playlist: ${categoryName}...`);
          const playlist = await spotify.createCategoryPlaylist(accessToken, userId, categoryName);
          playlists[categoryName] = playlist.id;
        }
        setCategoryPlaylists(playlists);
        setCategories(migrationData.categories);
        
        // Delete old playlists
        setLoadingMessage('Cleaning up old playlists...');
        await spotify.deleteOldPlaylists(accessToken, migrationData.oldPlaylists);
        
        showStatus('✓ Migration complete!');
        
        // Now load the rest
        setLoadingMessage('Loading artists...');
        const allArtists = await spotify.getFollowedArtists(accessToken);
        setArtists(allArtists);
      } else {
        // User chose not to migrate, start fresh
        await loadData(accessToken, userId);
      }
    } catch (err) {
      console.error('Migration error:', err);
      showStatus('✗ Migration failed');
    }
    
    setLoading(false);
  };

  const addCategory = async () => {
    if (!newCategoryName.trim() || categories[newCategoryName]) return;
    
    const categoryName = newCategoryName.trim();
    
    // Optimistic update - UI updates immediately
    const updatedCategories = { ...categories, [categoryName]: [] };
    setCategories(updatedCategories);
    setNewCategoryName('');
    setShowNewCategory(false);
    showStatus('✓ Category created');
    
    // Background: Create playlist and save data
    (async () => {
      try {
        const playlist = await spotify.createCategoryPlaylist(accessToken, userId, categoryName);
        setCategoryPlaylists(prev => ({ ...prev, [categoryName]: playlist.id }));
        await saveInBackground(updatedCategories);
      } catch (err) {
        console.error('Error creating category:', err);
        showStatus('⚠️ Failed to sync category', 3000);
      }
    })();
  };

  const deleteCategory = (categoryName) => {
    if (categoryName === 'Uncategorized') return;
    
    const playlistId = categoryPlaylists[categoryName];
    const artistsToMove = categories[categoryName] || [];
    
    // Optimistic update - UI updates immediately
    const updatedCategories = { ...categories };
    delete updatedCategories[categoryName];
    updatedCategories['Uncategorized'] = [
      ...(updatedCategories['Uncategorized'] || []),
      ...artistsToMove
    ];
    
    setCategories(updatedCategories);
    setCategoryPlaylists(prev => {
      const { [categoryName]: deleted, ...rest } = prev;
      return rest;
    });
    showStatus('✓ Category deleted');
    
    // Background: Delete playlist and save data
    (async () => {
      try {
        await saveInBackground(updatedCategories);
        if (playlistId) {
          await spotify.deleteCategoryPlaylist(accessToken, playlistId);
        }
      } catch (err) {
        console.error('Error deleting category:', err);
        showStatus('⚠️ Failed to sync deletion', 3000);
      }
    })();
  };

  const moveArtist = (artistId, fromCategory, toCategory) => {
    if (fromCategory === toCategory) return;
    
    // Optimistic update - UI updates immediately
    const updatedCategories = { ...categories };
    updatedCategories[fromCategory] = updatedCategories[fromCategory].filter(id => id !== artistId);
    updatedCategories[toCategory] = [...(updatedCategories[toCategory] || []), artistId];
    
    setCategories(updatedCategories);
    
    // Background save
    saveInBackground(updatedCategories);
  };

  const handleReset = async () => {
    setShowResetConfirm(false);
    setLoading(true);
    setLoadingMessage('Resetting all data...');
    
    try {
      await spotify.resetAllData(accessToken, userId);
      setCategories({});
      setCategoryPlaylists({});
      
      // Reload fresh data
      await loadData(accessToken, userId);
      showStatus('✓ Reset complete');
    } catch (err) {
      console.error('Reset error:', err);
      showStatus('✗ Reset failed');
    }
    
    setLoading(false);
  };

  const syncWithSpotify = async () => {
    if (!accessToken || !userId) return;
    
    setSyncing(true);
    showStatus('🔄 Syncing...', 0);
    
    try {
      await loadData(accessToken, userId);
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

  const handleLogout = () => {
    clearAuth();
    setAccessToken(null);
    setUserId(null);
    setArtists([]);
    setCategories({});
    setCategoryPlaylists({});
  };

  // ============================================
  // RENDER: Reset Confirmation Dialog
  // ============================================
  if (showResetConfirm) {
    return h('div', { className: 'min-h-screen bg-gradient-to-br from-green-900 via-black to-black flex items-center justify-center p-4' },
      h('div', { className: 'bg-gray-900 rounded-lg p-8 max-w-lg w-full text-center shadow-2xl' },
        h('div', { className: 'text-6xl mb-4' }, '⚠️'),
        h('h1', { className: 'text-2xl font-bold text-white mb-4' }, 'Reset All Categories?'),
        h('p', { className: 'text-gray-300 mb-4' }, 
          'This will delete all your categories and playlists created by Artist Organizer.'
        ),
        h('p', { className: 'text-red-400 mb-6 text-sm font-semibold' }, 
          'This action cannot be undone!'
        ),
        h('div', { className: 'flex gap-4 justify-center' },
          h('button', {
            onClick: handleReset,
            className: 'bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full'
          }, '🗑️ Yes, Reset Everything'),
          h('button', {
            onClick: () => setShowResetConfirm(false),
            className: 'bg-gray-700 hover:bg-gray-600 text-white py-2 px-6 rounded-full'
          }, 'Cancel')
        )
      )
    );
  }

  // ============================================
  // RENDER: Migration Dialog
  // ============================================
  if (showMigration) {
    return h('div', { className: 'min-h-screen bg-gradient-to-br from-green-900 via-black to-black flex items-center justify-center p-4' },
      h('div', { className: 'bg-gray-900 rounded-lg p-8 max-w-lg w-full text-center shadow-2xl' },
        h('div', { className: 'text-6xl mb-4' }, '🔄'),
        h('h1', { className: 'text-2xl font-bold text-white mb-4' }, 'Migration Required'),
        h('p', { className: 'text-gray-300 mb-4' }, 
          `Found ${migrationData?.oldPlaylists?.length || 0} old category playlists with ${Object.values(migrationData?.categories || {}).flat().length} artists.`
        ),
        h('p', { className: 'text-gray-400 mb-6 text-sm' }, 
          'The new version stores data more efficiently. Would you like to migrate your existing categories?'
        ),
        h('div', { className: 'flex gap-4 justify-center' },
          h('button', {
            onClick: () => handleMigration(true),
            className: 'bg-green-500 hover:bg-green-600 text-black font-semibold py-2 px-6 rounded-full'
          }, '✓ Migrate'),
          h('button', {
            onClick: () => handleMigration(false),
            className: 'bg-gray-700 hover:bg-gray-600 text-white py-2 px-6 rounded-full'
          }, 'Start Fresh')
        )
      )
    );
  }

  // ============================================
  // RENDER: Login Screen
  // ============================================
  if (!accessToken) {
    return h('div', { className: 'min-h-screen bg-gradient-to-br from-green-900 via-black to-black flex items-center justify-center p-4' },
      h('div', { className: 'bg-gray-900 rounded-lg p-8 max-w-md w-full text-center shadow-2xl' },
        h('div', { className: 'text-6xl mb-4' }, '🎸'),
        h('h1', { className: 'text-3xl font-bold text-white mb-2' }, 'Spotify Artist Organizer'),
        h('p', { className: 'text-gray-400 mb-6' }, 'Organize your followed artists into custom categories'),
        h('div', { className: 'bg-gray-800 border border-gray-700 rounded p-4 mb-6 text-left text-sm' },
          h('p', { className: 'text-gray-300 mb-2' }, 'Connect your Spotify account to start organizing your followed artists into custom categories.'),
          h('p', { className: 'text-green-400 text-xs font-semibold mb-2' }, '✓ Categories stored in Spotify (syncs everywhere)'),
          h('p', { className: 'text-green-400 text-xs font-semibold mb-2' }, '✓ Clean folder structure in your playlists'),
          h('p', { className: 'text-gray-400 text-xs mb-2' }, 'Your data is stored privately in hidden playlists.'),
          h('p', { className: 'text-gray-500 text-xs text-right' }, APP_VERSION)
        ),
        h('button', {
          onClick: initiateLogin,
          className: 'bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-full transition'
        }, 'Connect with Spotify')
      )
    );
  }

  // ============================================
  // RENDER: Loading Screen
  // ============================================
  if (loading) {
    return h('div', { className: 'min-h-screen bg-gradient-to-br from-green-900 via-black to-black flex items-center justify-center' },
      h('div', { className: 'text-center' },
        h('div', { className: 'text-6xl mb-4 animate-pulse' }, '🎸'),
        h('p', { className: 'text-white mb-2' }, loadingMessage || 'Loading...'),
        h('p', { className: 'text-gray-500 text-sm' }, 'This may take a moment')
      )
    );
  }

  // Sort categories (Uncategorized always first)
  const categoryEntries = Object.entries(categories);
  categoryEntries.sort((a, b) => {
    if (a[0] === 'Uncategorized') return -1;
    if (b[0] === 'Uncategorized') return 1;
    return a[0].localeCompare(b[0]);
  });

  // ============================================
  // RENDER: Main App
  // ============================================
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
          }, '➕ New Category'),
          h('button', {
            onClick: () => setShowResetConfirm(true),
            className: 'bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-full text-sm'
          }, '🗑️ Reset'),
          h('button', {
            onClick: handleLogout,
            className: 'bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-full text-sm'
          }, '🚪 Logout'),
          // Saving indicator
          isSaving && h('span', { className: 'text-yellow-400 text-sm animate-pulse' }, '💾 Saving...')
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
                    }, '↗ Playlist')
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
