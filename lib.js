// SPDX-License-Identifier: GPL-3.0-or-later
// Pure, DOM-free helpers shared by app.js and the test suite.
// Loaded in the browser via <script src="/lib.js"> before app.js;
// required directly by tests/app.test.js under Node.
(() => {
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

  function normaliseApiBase(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
      if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return null;
      url.pathname = url.pathname.replace(/\/+$/, '');
      // Setting an empty pathname normalises back to '/', so strip again.
      return (url.origin + url.pathname).replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const YOUTUBE_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'piped.video'];

  // Extract an 11-character video ID from a bare ID, a full URL, or a
  // relative Piped path ("/watch?v=…"). Returns '' when nothing matches.
  function extractVideoIdFromUrl(value) {
    const input = String(value || '').trim();
    if (!input) return '';
    if (VIDEO_ID_PATTERN.test(input)) return input;
    try {
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
        ? input
        : (input.startsWith('/') ? input : `https://${input}`);
      const url = new URL(candidate, 'https://placeholder.invalid');
      const host = url.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0] || '';
        return VIDEO_ID_PATTERN.test(id) ? id : '';
      }
      const knownHost = YOUTUBE_HOSTS.includes(host) || host === 'placeholder.invalid';
      if (knownHost) {
        const param = url.searchParams.get('v');
        if (param && VIDEO_ID_PATTERN.test(param)) return param;
        const segments = url.pathname.split('/').filter(Boolean);
        if (['shorts', 'live', 'embed', 'v'].includes(segments[0]) && VIDEO_ID_PATTERN.test(segments[1] || '')) return segments[1];
      }
    } catch {
      // Not a parseable URL — fall through to the embedded-URL scan below.
    }
    // Tolerate a URL pasted inside surrounding text.
    const embedded = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|piped\.video\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/i);
    return embedded ? embedded[1] : '';
  }

  function getVideoId(item) {
    if (item?.videoId && VIDEO_ID_PATTERN.test(item.videoId)) return item.videoId;
    return extractVideoIdFromUrl(item?.url || '');
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
      description: item.shortDescription || item.description || '',
      isLive: Boolean(item.isLive)
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

  // Stored items are untrusted input (anyone can edit localStorage), so
  // re-validate every field before it can reach the DOM.
  function validateStoredItems(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && typeof item.id === 'string' && VIDEO_ID_PATTERN.test(item.id))
      .map((item) => ({
        id: item.id,
        title: String(item.title || 'Untitled video'),
        channel: String(item.channel || 'Unknown channel'),
        avatar: safeHttpsUrl(item.avatar),
        thumbnail: safeHttpsUrl(item.thumbnail),
        duration: Number(item.duration) || 0,
        views: Number(item.views) || 0,
        uploaded: String(item.uploaded || ''),
        description: String(item.description || ''),
        isLive: Boolean(item.isLive)
      }));
  }

  const api = {
    escapeHTML,
    safeHttpsUrl,
    normaliseApiBase,
    extractVideoIdFromUrl,
    getVideoId,
    normaliseItem,
    formatDuration,
    formatViews,
    validateStoredItems
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.NewPipeLib = api;
  }
})();
