// SPDX-License-Identifier: GPL-3.0-or-later
(() => {
  const { escapeHTML, safeHttpsUrl, normaliseApiBase, extractVideoIdFromUrl, normaliseItem, formatDuration, formatViews, validateStoredItems } = window.NewPipeLib;
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
    gridStatus: $('#gridStatus'),
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
    playerMessage: $('#playerMessage'),
    toast: $('#toast')
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      showToast('Could not save to this browser — storage may be full or disabled.');
      return false;
    }
  }

  function readStoredItems(key) {
    return validateStoredItems(readJSON(key, []));
  }

  const savedSettings = readJSON(STORAGE.settings, {});
  const regionOptions = $$('#regionSelect option').map((option) => option.value);
  const state = {
    api: normaliseApiBase(savedSettings.api) || DEFAULT_API,
    region: regionOptions.includes(savedSettings.region) ? savedSettings.region : DEFAULT_REGION,
    saved: readStoredItems(STORAGE.saved),
    history: readStoredItems(STORAGE.history),
    view: 'home',
    items: [],
    playerRequest: 0,
    listRequest: 0,
    listController: null,
    playerController: null,
    playerLoading: false,
    playerTimer: 0,
    currentItem: null,
    playerStreams: [],
    lastQuery: ''
  };

  let toastTimer = 0;
  function showToast(message) {
    if (!ui.toast) return;
    ui.toast.textContent = message;
    ui.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), 4500);
  }

  function setConnection(status, label) {
    ui.connection.classList.toggle('is-online', status === 'online');
    ui.connection.classList.toggle('is-offline', status === 'offline');
    ui.connectionLabel.textContent = label || (status === 'online' ? 'Connected' : status === 'offline' ? 'Service unavailable' : 'Connecting');
  }

  async function apiGet(path, params = {}, externalSignal) {
    const url = new URL(`${state.api}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
    // Manual timeout: AbortSignal.timeout is unavailable in older Safari.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      let response;
      try {
        response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new Error('Could not reach the API server. Check your connection or choose another server in Settings.');
      }
      if (!response.ok) throw new Error(`Video service returned ${response.status}.`);
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error('The API server returned an invalid response. Try another server in Settings.');
      }
      if (payload == null) throw new Error('The API server returned an empty response. Try another server in Settings.');
      if (payload && !Array.isArray(payload) && typeof payload.error === 'string' && payload.error) throw new Error(payload.error);
      return payload;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  function showLoading() {
    ui.errorPanel.hidden = true;
    ui.grid.classList.remove('is-error');
    ui.grid.setAttribute('aria-busy', 'true');
    ui.grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton" aria-hidden="true"><div class="skeleton-thumb"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>').join('');
  }

  function showError(error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const message = timedOut
      ? 'The video service took too long to respond. Try again or choose another API server in Settings.'
      : (error?.message || 'The selected API server may be unavailable. Choose another server in Settings and try again.');
    ui.errorMessage.textContent = message;
    ui.errorPanel.hidden = false;
    ui.resultCount.textContent = '';
    ui.grid.classList.add('is-error');
    ui.grid.removeAttribute('aria-busy');
    ui.grid.innerHTML = '';
    setConnection('offline', 'Service unavailable');
  }

  function emptyMarkup(title, description) {
    return `<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6z"/><circle cx="12" cy="12" r="9"/></svg></div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p></div>`;
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
    return `<article class="video-card">
      <button class="thumb-button" data-action="play" data-index="${index}" type="button" aria-label="Play ${escapeHTML(item.title)}">
        <span class="thumb-fallback"><img src="/assets/new_pipe_icon_5.svg" alt=""></span>${thumb}
        ${item.isLive ? '<span class="live-badge">LIVE</span>' : (duration ? `<span class="duration-badge">${escapeHTML(duration)}</span>` : '')}
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
    if (ui.gridStatus) ui.gridStatus.textContent = ui.resultCount.textContent || options.emptyTitle || '';
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
    state.listController?.abort();
    const controller = new AbortController();
    state.listController = controller;
    const requestId = ++state.listRequest;
    try {
      const data = await apiGet('/trending', { region: state.region }, controller.signal);
      if (requestId !== state.listRequest) return;
      if (!Array.isArray(data)) throw new Error('The API server returned an unexpected response.');
      const items = data.map(normaliseItem).filter(Boolean);
      setConnection('online');
      updateFilterChips('');
      renderItems(items, { emptyTitle: 'No trending videos right now', emptyDescription: 'Try a search or choose another API server in Settings.' });
    } catch (error) {
      if (requestId !== state.listRequest) return;
      showError(error);
    }
  }

  async function searchVideos(query) {
    const value = String(query || '').trim().slice(0, 160);
    if (!value) return loadTrending();
    const directId = extractVideoIdFromUrl(value);
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
    updateFilterChips(value);
    state.listController?.abort();
    const controller = new AbortController();
    state.listController = controller;
    const requestId = ++state.listRequest;
    try {
      const data = await apiGet('/search', { q: value, filter: 'videos' }, controller.signal);
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

  function updateNavigation() {
    $$('[data-view]').forEach((button) => {
      const active = button.dataset.view === state.view || (state.view === 'search' && button.dataset.view === 'explore');
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function updateFilterChips(selectedQuery) {
    $$('.filter-chip').forEach((chip) => {
      const selected = chip.dataset.query === selectedQuery;
      chip.classList.toggle('is-selected', selected);
      chip.setAttribute('aria-pressed', String(selected));
    });
  }

  function navigate(view) {
    if (view === 'settings') return openSettings();
    if (view === 'home') return loadTrending();
    state.listRequest++;
    state.listController?.abort();
    state.view = view;
    updateNavigation();
    updateFilterChips(view === 'explore' ? '' : null);
    if (view === 'explore') {
      setHeading('START WITH A SEARCH', 'What are you in the mood for?');
      renderItems([], { emptyTitle: 'Explore at your own pace', emptyDescription: 'Search for a video, paste a link, or pick a topic above. No account needed.' });
      if (window.matchMedia('(pointer: fine)').matches) ui.searchInput.focus({ preventScroll: true });
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
      // Update the bookmark button in place so focus and scroll are kept.
      const index = state.items.findIndex((entry) => entry.id === item.id);
      const button = index >= 0 ? ui.grid.querySelector(`[data-action="save"][data-index="${index}"]`) : null;
      if (button) {
        const saved = !exists;
        button.classList.toggle('is-saved', saved);
        button.setAttribute('aria-label', saved ? 'Remove from Watch later' : 'Add to Watch later');
        button.title = saved ? 'Remove from Watch later' : 'Save for later';
      }
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

  function setCaptions(subtitles) {
    ui.video.querySelectorAll('track').forEach((track) => track.remove());
    (subtitles || []).filter((sub) => sub && safeHttpsUrl(sub.url)).forEach((sub, index) => {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = String(sub.name || sub.language || `Caption ${index + 1}`);
      track.srclang = String(sub.language || 'und').slice(0, 12);
      track.src = safeHttpsUrl(sub.url);
      if (index === 0) track.mode = 'showing';
      ui.video.appendChild(track);
    });
  }

  function clearPlayerTimer() {
    if (state.playerTimer) {
      clearTimeout(state.playerTimer);
      state.playerTimer = 0;
    }
  }

  async function openVideo(item) {
    if (!item?.id || !/^[A-Za-z0-9_-]{11}$/.test(item.id)) return;
    state.currentItem = item;
    state.playerController?.abort();
    const controller = new AbortController();
    state.playerController = controller;
    const requestId = ++state.playerRequest;
    state.playerStreams = [];
    state.playerLoading = false;
    clearPlayerTimer();
    setCaptions([]);
    ui.video.pause();
    ui.video.removeAttribute('src');
    ui.video.load();
    $('#watchTitle').textContent = item.title || 'Video';
    $('#watchByline').textContent = item.channel || 'Video source';
    $('#watchDescription').textContent = item.description || '';
    $('#qualityWrap').hidden = true;
    $('#qualitySelect').innerHTML = '';
    if (item.thumbnail) ui.video.poster = item.thumbnail;
    else ui.video.removeAttribute('poster');
    setPlayerMessage('Finding a browser-ready stream…');
    updateCurrentSaveButton();
    if (!ui.watchDialog.open) ui.watchDialog.showModal();
    try {
      const data = await apiGet(`/streams/${encodeURIComponent(item.id)}`, {}, controller.signal);
      if (requestId !== state.playerRequest) return;
      const streams = Array.isArray(data.videoStreams) ? data.videoStreams : [];
      const progressive = streams
        .filter((stream) => stream && stream.videoOnly !== true && safeHttpsUrl(stream.url))
        .sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
      state.playerStreams = progressive;
      const hls = safeHttpsUrl(data.hls || '');
      // Native HLS playback only works in Safari; never hand an HLS URL to
      // a browser that cannot play it.
      const hlsPlayable = Boolean(hls) && ui.video.canPlayType('application/vnd.apple.mpegurl') !== '';
      if (!progressive.length && !hlsPlayable) {
        setPlayerMessage(hls
          ? 'This video only offers a stream format your browser cannot play directly. Try another video or API server.'
          : 'This source does not currently offer a browser-ready video stream. Try another API server.', true);
        return;
      }
      refreshStoredItem(item.id, {
        title: data.title,
        channel: data.uploader,
        description: data.description,
        thumbnail: safeHttpsUrl(data.thumbnailUrl),
        avatar: safeHttpsUrl(data.uploaderAvatar),
        duration: Number(data.duration) || 0,
        views: Number(data.views) || 0,
        isLive: Boolean(data.isLive)
      });
      addToHistory(state.currentItem);
      setCaptions(data.subtitles);
      if (data.title) $('#watchTitle').textContent = data.title;
      if (data.uploader) $('#watchByline').textContent = data.uploader;
      if (data.description) $('#watchDescription').textContent = data.description;
      if (safeHttpsUrl(data.thumbnailUrl)) ui.video.poster = safeHttpsUrl(data.thumbnailUrl);
      if (progressive.length > 1) {
        $('#qualityWrap').hidden = false;
        $('#qualitySelect').innerHTML = progressive.map((stream, index) => `<option value="${index}">${escapeHTML(stream.quality || (stream.height ? `${stream.height}p` : stream.format || 'Video'))}${stream.fps ? ` · ${escapeHTML(stream.fps)} fps` : ''}</option>`).join('');
      }
      ui.video.src = progressive[0]?.url || hls;
      state.playerLoading = true;
      ui.video.load();
      state.playerTimer = setTimeout(() => {
        if (requestId === state.playerRequest && state.playerLoading && ui.watchDialog.open) {
          state.playerLoading = false;
          setPlayerMessage('The stream is taking a long time to load. Check your connection or try another API server.', true);
        }
      }, 25000);
      ui.video.play().catch(() => {});
    } catch (error) {
      if (requestId !== state.playerRequest) return;
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      setPlayerMessage(timedOut ? 'The video service timed out. Try another instance in Settings.' : 'Could not load this video. The API server may be unavailable.', true);
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
    if (ui.settingsDialog.open) return;
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
  $$('[data-view]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(button.dataset.view);
  }));
  $('#openSettings').addEventListener('click', openSettings);
  $('#topSettings').addEventListener('click', openSettings);
  $('#errorSettings').addEventListener('click', openSettings);
  $('#settingsForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings();
  });
  $('#qualitySelect').addEventListener('change', selectQuality);
  $('#errorRetry').addEventListener('click', () => {
    if (state.view === 'home') loadTrending();
    else if (state.view === 'search') searchVideos(state.lastQuery);
    else navigate(state.view);
  });
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
    state.playerController?.abort();
    state.playerStreams = [];
    state.playerLoading = false;
    clearPlayerTimer();
    setCaptions([]);
    ui.video.pause();
    ui.video.removeAttribute('src');
    ui.video.load();
  });
  ui.video.addEventListener('loadedmetadata', () => {
    state.playerLoading = false;
    clearPlayerTimer();
    hidePlayerMessage();
  });
  ui.video.addEventListener('error', () => {
    if (!ui.watchDialog.open) return;
    if (state.playerLoading || ui.video.currentSrc) {
      state.playerLoading = false;
      clearPlayerTimer();
      setPlayerMessage('This stream could not be played by your browser. Try a different video or API server.', true);
    }
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
  if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
