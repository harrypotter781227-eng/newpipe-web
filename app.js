// SPDX-License-Identifier: GPL-3.0-or-later
(() => {
  const DEFAULT_API = 'https://api.piped.private.coffee';
  const DEFAULT_REGION = 'MY';
  const STORAGE = {
    settings: 'newpipe-web-settings-v1',
    saved: 'newpipe-web-saved-v1',
    history: 'newpipe-web-history-v1'
  };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const ui = {
    grid: $('#videoGrid'),
    errorPanel: $('#errorPanel'),
    errorMessage: $('#errorMessage'),
    connection: $('.connection-pill'),
    connectionLabel: $('#connectionLabel'),
    sectionTitle: $('#sectionTitle'),
    sectionKicker: $('#sectionKicker'),
    resultCount: $('#resultCount'),
    savedCount: $('#savedCount'),
    searchForm: $('#searchForm'),
    searchInput: $('#searchInput'),
    settingsDialog: $('#settingsDialog'),
    watchDialog: $('#watchDialog'),
    video: $('#videoPlayer'),
    playerMessage: $('#playerMessage')
  };

  function readJSON(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Local storage may be disabled. */ }
  }

  // Stored items are untrusted input (anyone can edit localStorage), so
  // re-validate every field before it can reach the DOM.
  function readStoredItems(key) {
    const raw = readJSON(key, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && typeof item.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(item.id))
      .map((item) => ({
        id: item.id,
        title: String(item.title || 'Untitled video'),
        channel: String(item.channel || 'Unknown channel'),
        avatar: safeHttpsUrl(item.avatar),
        thumbnail: safeHttpsUrl(item.thumbnail),
        duration: Number(item.duration) || 0,
        views: Number(item.views) || 0,
        uploaded: String(item.uploaded || ''),
        description: String(item.description || '')
      }));
  }

  const savedSettings = readJSON(STORAGE.settings, {});
  const state = {
    api: normaliseApiBase(savedSettings.api) || DEFAULT_API,
    region: /^[A-Z]{2}$/.test(savedSettings.region || '') ? savedSettings.region : DEFAULT_REGION,
    saved: readStoredItems(STORAGE.saved),
    history: readStoredItems(STORAGE.history),
    view: 'home',
    items: [],
    playerRequest: 0,
    listRequest: 0,
    currentItem: null,
    playerStreams: [],
    lastQuery: ''
  };

  function normaliseApiBase(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
      if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return null;
      url.pathname = url.pathname.replace(/\/+$/, '');
      return url.origin + url.pathname;
    } catch {
      return null;
    }
  }

  function setConnection(status, label) {
    ui.connection.classList.toggle('is-online', status === 'online');
    ui.connection.classList.toggle('is-offline', status === 'offline');
    ui.connectionLabel.textContent = label || (status === 'online' ? 'Connected' : status === 'offline' ? 'Service unavailable' : 'Connecting');
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function safeHttpsUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    const candidate = value.startsWith('//') ? `https:${value}` : value;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  async function apiGet(path, params = {}) {
    const url = new URL(`${state.api}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(14000) });
    if (!response.ok) throw new Error(`Video service returned ${response.status}.`);
    const payload = await response.json();
    if (payload && !Array.isArray(payload) && payload.error) throw new Error(payload.error);
    return payload;
  }

  function getVideoId(item) {
    if (item?.videoId && /^[A-Za-z0-9_-]{11}$/.test(item.videoId)) return item.videoId;
    const match = String(item?.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})/) || String(item?.url || '').match(/\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
    return match ? match[1] : '';
  }

  function normaliseItem(item) {
    const id = getVideoId(item);
    if (!id) return null;
    const avatar = safeHttpsUrl(item.uploaderAvatar || item.uploaderThumbnail || '');
    return {
      id,
      title: item.title || 'Untitled video',
      channel: item.uploaderName || item.uploader || item.author || 'Unknown channel',
      avatar,
      thumbnail: safeHttpsUrl(item.thumbnail || item.thumbnailUrl || item.thumbnailUrlHQ || ''),
      duration: Number(item.duration || item.durationSeconds || 0),
      views: Number(item.views || 0),
      uploaded: item.uploadedDate || item.uploadDate || item.uploaded || '',
      description: item.shortDescription || item.description || ''
    };
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
  }

  function formatViews(count) {
    if (!Number.isFinite(count) || count <= 0) return '';
    return `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(count)} views`;
  }

  function showLoading() {
    ui.errorPanel.hidden = true;
    ui.grid.classList.remove('is-error');
    ui.grid.setAttribute('aria-busy', 'true');
    ui.grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton" aria-hidden="true"><div class="skeleton-thumb"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>').join('');
  }

  function showError(error) {
    const message = error?.name === 'TimeoutError'
      ? 'The video service took too long to respond. Try again or choose another API server in Settings.'
      : (error?.message || 'The selected API server may be unavailable. Choose another server in Settings and try again.');
    ui.errorMessage.textContent = message;
    ui.errorPanel.hidden = false;
    ui.grid.classList.add('is-error');
    ui.grid.removeAttribute('aria-busy');
    ui.grid.innerHTML = '';
    setConnection('offline', 'Service unavailable');
  }

  function emptyMarkup(title, description, actionLabel = '') {
    return `<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6z"/><circle cx="12" cy="12" r="9"/></svg></div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p>${actionLabel ? `<button class="subtle-button" data-action="retry" type="button">${escapeHTML(actionLabel)}</button>` : ''}</div>`;
  }

  function updateSavedCount() {
    ui.savedCount.textContent = String(state.saved.length);
  }

  function isSaved(id) {
    return state.saved.some((item) => item.id === id);
  }

  function cardMarkup(item, index) {
    const duration = formatDuration(item.duration);
    const avatar = item.avatar
      ? `<img src="${escapeHTML(item.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : escapeHTML((item.channel || 'N').trim().slice(0, 1).toUpperCase());
    const thumb = item.thumbnail
      ? `<img class="thumb-image" src="${escapeHTML(item.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : '';
    const saved = isSaved(item.id);
    const views = formatViews(item.views);
    const metadata = [views, item.uploaded].filter(Boolean).map(escapeHTML).join('<span aria-hidden="true">·</span>');
    return `<article class="video-card" style="animation-delay:${Math.min(index * 35, 280)}ms">
      <button class="thumb-button" data-action="play" data-index="${index}" type="button" aria-label="Play ${escapeHTML(item.title)}">
        <span class="thumb-fallback"><img src="/assets/new_pipe_icon_5.svg" alt=""></span>${thumb}
        ${duration ? `<span class="duration-badge">${escapeHTML(duration)}</span>` : '<span class="live-badge">VIDEO</span>'}
      </button>
      <div class="card-copy"><div class="channel-avatar">${avatar}</div>
        <div class="card-text"><h3 class="card-title">${escapeHTML(item.title)}</h3><div class="card-meta"><span class="channel-name">${escapeHTML(item.channel)}</span>${metadata ? `<span>${metadata}</span>` : ''}</div></div>
        <button class="card-menu ${saved ? 'is-saved' : ''}" data-action="save" data-index="${index}" type="button" aria-label="${saved ? 'Remove from' : 'Add to'} Watch later" title="${saved ? 'Remove from Watch later' : 'Save for later'}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-3.8L6 21z"/></svg>
        </button>
      </div>
    </article>`;
  }

  function renderItems(items, options = {}) {
    state.items = items;
    ui.errorPanel.hidden = true;
    ui.grid.classList.remove('is-error');
    ui.grid.removeAttribute('aria-busy');
    ui.resultCount.textContent = options.countLabel ?? (items.length ? `${items.length} videos` : '');
    if (!items.length) {
      ui.grid.innerHTML = emptyMarkup(options.emptyTitle || 'Nothing here yet', options.emptyDescription || 'Try another search or explore a different topic.');
      return;
    }
    ui.grid.innerHTML = items.map(cardMarkup).join('');
    ui.grid.querySelectorAll('.thumb-image, .channel-avatar img').forEach((image) => {
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    });
  }

  function regionName(code) {
    const option = $('#regionSelect')?.querySelector(`option[value="${code}"]`);
    if (option) return option.textContent;
    try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(code) || code; } catch { return code; }
  }

  function setHeading(kicker, title) {
    ui.sectionKicker.textContent = kicker;
    ui.sectionTitle.textContent = title;
  }

  async function loadTrending() {
    state.view = 'home';
    updateNavigation();
    setHeading('A LITTLE OF EVERYTHING', `Trending in ${regionName(state.region)}`);
    showLoading();
    setConnection('pending');
    const requestId = ++state.listRequest;
    try {
      const data = await apiGet('/trending', { region: state.region });
      if (requestId !== state.listRequest) return;
      if (!Array.isArray(data)) throw new Error('The API server returned an unexpected response.');
      const items = data.map(normaliseItem).filter(Boolean);
      setConnection('online');
      $$('.filter-chip').forEach((chip) => chip.classList.toggle('is-selected', !chip.dataset.query));
      renderItems(items, { emptyTitle: 'No trending videos right now', emptyDescription: 'Try a search or choose another API server in Settings.' });
    } catch (error) {
      if (requestId !== state.listRequest) return;
      showError(error);
    }
  }

  async function searchVideos(query) {
    const value = String(query || '').trim().slice(0, 160);
    if (!value) return loadTrending();
    const directId = extractVideoId(value);
    if (directId) {
      openVideo({ id: directId, title: 'Video from link', channel: 'Video source', duration: 0, description: '' });
      return;
    }
    state.lastQuery = value;
    state.view = 'search';
    updateNavigation();
    setHeading('SEARCH RESULTS', `Results for “${value}”`);
    showLoading();
    setConnection('pending');
    $$('.filter-chip').forEach((chip) => chip.classList.toggle('is-selected', chip.dataset.query === value));
    const requestId = ++state.listRequest;
    try {
      const data = await apiGet('/search', { q: value, filter: 'videos' });
      if (requestId !== state.listRequest) return;
      const results = Array.isArray(data) ? data : (data?.items || []);
      const items = results.filter((item) => !item.type || ['stream', 'video', 'shortVideo'].includes(item.type)).map(normaliseItem).filter(Boolean);
      setConnection('online');
      renderItems(items, { countLabel: items.length ? `${items.length} results` : '', emptyTitle: 'No videos found', emptyDescription: 'Try a shorter search or a different phrase.' });
    } catch (error) {
      if (requestId !== state.listRequest) return;
      showError(error);
    }
  }

  function extractVideoId(value) {
    const input = value.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
    const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|piped\.video\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/i);
    return match ? match[1] : '';
  }

  function updateNavigation() {
    $$('[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === state.view || (state.view === 'search' && button.dataset.view === 'explore')));
  }

  function navigate(view) {
    if (view === 'home') return loadTrending();
    state.listRequest++;
    state.view = view;
    updateNavigation();
    $$('.filter-chip').forEach((chip) => chip.classList.toggle('is-selected', !chip.dataset.query && view === 'explore'));
    if (view === 'explore') {
      setHeading('START WITH A SEARCH', 'What are you in the mood for?');
      renderItems([], { emptyTitle: 'Explore at your own pace', emptyDescription: 'Search for a video, paste a link, or pick a topic above. No account needed.' });
      ui.searchInput.focus({ preventScroll: true });
    } else if (view === 'saved') {
      setHeading('YOUR PERSONAL LIST', 'Watch later');
      renderItems([...state.saved], { emptyTitle: 'Your list is yours to build', emptyDescription: 'Use the bookmark on any video to save it here. It stays in this browser.' });
    } else if (view === 'history') {
      setHeading('ONLY ON THIS DEVICE', 'Recently watched');
      renderItems([...state.history], { emptyTitle: 'A fresh start', emptyDescription: 'Videos you open will show up here. Your history never leaves this browser.' });
    }
  }

  function toggleSaved(item) {
    const exists = isSaved(item.id);
    state.saved = exists ? state.saved.filter((saved) => saved.id !== item.id) : [item, ...state.saved].slice(0, 200);
    writeJSON(STORAGE.saved, state.saved);
    updateSavedCount();
    if (state.view === 'saved') {
      renderItems([...state.saved], { emptyTitle: 'Your list is yours to build', emptyDescription: 'Use the bookmark on any video to save it here. It stays in this browser.' });
    } else {
      renderItems([...state.items], { countLabel: ui.resultCount.textContent });
    }
    updateCurrentSaveButton();
  }

  function addToHistory(item) {
    if (!item?.id) return;
    state.history = [item, ...state.history.filter((saved) => saved.id !== item.id)].slice(0, 80);
    writeJSON(STORAGE.history, state.history);
  }

  // Videos opened from a pasted link start with placeholder text; fill in the
  // real details once the API responds so History and Watch later look right.
  function refreshStoredItem(id, details) {
    const patch = Object.fromEntries(Object.entries(details).filter(([, value]) => value));
    if (!Object.keys(patch).length) return;
    const update = (list) => list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
    if (state.currentItem?.id === id) state.currentItem = { ...state.currentItem, ...patch };
    state.history = update(state.history);
    writeJSON(STORAGE.history, state.history);
    if (isSaved(id)) {
      state.saved = update(state.saved);
      writeJSON(STORAGE.saved, state.saved);
    }
  }

  function updateCurrentSaveButton() {
    const button = $('#saveCurrent');
    const item = state.currentItem;
    if (!button || !item) return;
    const saved = isSaved(item.id);
    button.classList.toggle('is-saved', saved);
    button.querySelector('.save-icon').textContent = saved ? '✓' : '＋';
    button.querySelector('span:last-child').textContent = saved ? 'Saved' : 'Save';
  }

  function setPlayerMessage(message, isError = false) {
    ui.playerMessage.textContent = message;
    ui.playerMessage.classList.toggle('is-error', isError);
    ui.playerMessage.classList.remove('is-hidden');
  }

  function hidePlayerMessage() {
    ui.playerMessage.classList.add('is-hidden');
  }

  async function openVideo(item) {
    if (!item?.id || !/^[A-Za-z0-9_-]{11}$/.test(item.id)) return;
    state.currentItem = item;
    const requestId = ++state.playerRequest;
    state.playerStreams = [];
    ui.video.pause();
    ui.video.removeAttribute('src');
    ui.video.load();
    $('#watchTitle').textContent = item.title || 'Video';
    $('#watchByline').textContent = item.channel || 'Video source';
    $('#watchDescription').textContent = item.description || '';
    $('#qualityWrap').hidden = true;
    $('#qualitySelect').innerHTML = '';
    $('#playerFrame').classList.toggle('has-poster', Boolean(item.thumbnail));
    if (item.thumbnail) ui.video.poster = item.thumbnail;
    else ui.video.removeAttribute('poster');
    setPlayerMessage('Finding a browser-ready stream…');
    updateCurrentSaveButton();
    addToHistory(item);
    if (!ui.watchDialog.open) ui.watchDialog.showModal();
    try {
      const data = await apiGet(`/streams/${encodeURIComponent(item.id)}`);
      if (requestId !== state.playerRequest) return;
      const streams = Array.isArray(data.videoStreams) ? data.videoStreams : [];
      const progressive = streams
        .filter((stream) => stream && stream.videoOnly !== true && safeHttpsUrl(stream.url))
        .sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
      state.playerStreams = progressive;
      const hls = safeHttpsUrl(data.hls || '');
      if (!progressive.length && !hls) {
        setPlayerMessage('This source does not currently offer a browser-ready video stream. Try another API server.', true);
        return;
      }
      refreshStoredItem(item.id, {
        title: data.title,
        channel: data.uploader,
        description: data.description,
        thumbnail: safeHttpsUrl(data.thumbnailUrl),
        avatar: safeHttpsUrl(data.uploaderAvatar),
        duration: Number(data.duration) || 0,
        views: Number(data.views) || 0
      });
      if (data.title) $('#watchTitle').textContent = data.title;
      if (data.uploader) $('#watchByline').textContent = data.uploader;
      if (data.description) $('#watchDescription').textContent = data.description;
      if (safeHttpsUrl(data.thumbnailUrl)) ui.video.poster = safeHttpsUrl(data.thumbnailUrl);
      if (progressive.length > 1) {
        $('#qualityWrap').hidden = false;
        $('#qualitySelect').innerHTML = progressive.map((stream, index) => `<option value="${index}">${escapeHTML(stream.quality || (stream.height ? `${stream.height}p` : stream.format || 'Video'))}${stream.fps ? ` · ${escapeHTML(stream.fps)} fps` : ''}</option>`).join('');
        $('#qualitySelect').addEventListener('change', selectQuality);
      }
      ui.video.src = progressive[0]?.url || hls;
      ui.video.load();
      ui.video.play().catch(() => {});
    } catch (error) {
      if (requestId !== state.playerRequest) return;
      setPlayerMessage(error?.name === 'TimeoutError' ? 'The video service timed out. Try another instance in Settings.' : 'Could not load this video. The API server may be unavailable.', true);
    }
  }

  function selectQuality(event) {
    const index = Number(event.currentTarget.value);
    const stream = state.playerStreams[index];
    if (!stream) return;
    const resumeAt = ui.video.currentTime;
    const wasPaused = ui.video.paused;
    ui.video.addEventListener('loadedmetadata', () => {
      if (resumeAt > 0) ui.video.currentTime = resumeAt;
      if (!wasPaused) ui.video.play().catch(() => {});
    }, { once: true });
    ui.video.src = stream.url;
    ui.video.load();
  }

  function openSettings() {
    $('#apiInput').value = state.api;
    $('#regionSelect').value = state.region;
    ui.settingsDialog.showModal();
  }

  function saveSettings() {
    const api = normaliseApiBase($('#apiInput').value);
    if (!api) {
      $('#apiInput').setCustomValidity('Enter a valid HTTPS API server URL without a query or fragment.');
      $('#apiInput').reportValidity();
      return;
    }
    $('#apiInput').setCustomValidity('');
    state.api = api;
    state.region = $('#regionSelect').value;
    writeJSON(STORAGE.settings, { api: state.api, region: state.region });
    ui.settingsDialog.close();
    if (state.view === 'home') loadTrending();
    else if (state.view === 'search') searchVideos(state.lastQuery);
    else navigate(state.view);
  }

  ui.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    searchVideos(ui.searchInput.value);
    ui.searchInput.blur();
  });
  $$('.filter-chip').forEach((chip) => chip.addEventListener('click', () => {
    const query = chip.dataset.query;
    if (query) {
      ui.searchInput.value = query;
      searchVideos(query);
    } else {
      ui.searchInput.value = '';
      loadTrending();
    }
  }));
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  $('#openSettings').addEventListener('click', openSettings);
  $('#topSettings').addEventListener('click', openSettings);
  $('#errorSettings').addEventListener('click', openSettings);
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#resetSettings').addEventListener('click', () => {
    $('#apiInput').value = DEFAULT_API;
    $('#regionSelect').value = DEFAULT_REGION;
  });
  $('#refreshButton').addEventListener('click', () => {
    if (state.view === 'home') loadTrending();
    else if (state.view === 'search') searchVideos(state.lastQuery);
    else navigate(state.view);
  });
  $('#startExploring').addEventListener('click', () => {
    ui.searchInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#closeWatch').addEventListener('click', () => ui.watchDialog.close());
  ui.watchDialog.addEventListener('close', () => {
    state.playerRequest++;
    state.playerStreams = [];
    ui.video.pause();
    ui.video.removeAttribute('src');
    ui.video.load();
  });
  ui.video.addEventListener('loadedmetadata', hidePlayerMessage);
  ui.video.addEventListener('error', () => {
    if (ui.watchDialog.open && ui.video.currentSrc) setPlayerMessage('This stream could not be played by your browser. Try a different video or API server.', true);
  });
  $('#saveCurrent').addEventListener('click', () => {
    if (state.currentItem) toggleSaved(state.currentItem);
  });
  ui.grid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'play') {
      const item = state.items[Number(button.dataset.index)];
      if (item) openVideo(item);
    } else if (button.dataset.action === 'save') {
      const item = state.items[Number(button.dataset.index)];
      if (item) toggleSaved(item);
    } else if (button.dataset.action === 'retry') {
      state.view === 'home' ? loadTrending() : searchVideos(ui.searchInput.value);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !ui.settingsDialog.open && !ui.watchDialog.open) {
      event.preventDefault();
      ui.searchInput.focus();
    }
  });

  $('#regionSelect').value = state.region;
  updateSavedCount();
  loadTrending();
})();
