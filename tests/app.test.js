// Tests for the pure helpers in lib.js (the XSS/URL-allowlist boundary).
// Run with: npm test   (Node's built-in test runner, no dependencies)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeHTML,
  safeHttpsUrl,
  normaliseApiBase,
  extractVideoIdFromUrl,
  getVideoId,
  normaliseItem,
  formatDuration,
  formatViews,
  validateStoredItems
} = require('../lib.js');

const ID = 'dQw4w9WgXcQ'; // 11 chars, valid charset

describe('escapeHTML', () => {
  it('escapes all five special characters', () => {
    assert.equal(escapeHTML('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('coerces nullish and non-string values', () => {
    assert.equal(escapeHTML(null), '');
    assert.equal(escapeHTML(undefined), '');
    assert.equal(escapeHTML(42), '42');
  });
  it('leaves plain text untouched', () => {
    assert.equal(escapeHTML('Hello world'), 'Hello world');
  });
});

describe('safeHttpsUrl', () => {
  it('accepts https URLs', () => {
    assert.equal(safeHttpsUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  });
  it('upgrades protocol-relative URLs', () => {
    assert.equal(safeHttpsUrl('//example.com/x'), 'https://example.com/x');
  });
  it('rejects http, javascript:, data:, and garbage', () => {
    assert.equal(safeHttpsUrl('http://example.com'), '');
    assert.equal(safeHttpsUrl('javascript:alert(1)'), '');
    assert.equal(safeHttpsUrl('data:text/html,<script>'), '');
    assert.equal(safeHttpsUrl('not a url'), '');
    assert.equal(safeHttpsUrl(''), '');
    assert.equal(safeHttpsUrl(null), '');
    assert.equal(safeHttpsUrl(42), '');
  });
});

describe('normaliseApiBase', () => {
  it('accepts https bases and strips trailing slashes', () => {
    assert.equal(normaliseApiBase('https://api.example.com/'), 'https://api.example.com');
    assert.equal(normaliseApiBase('https://api.example.com/piped//'), 'https://api.example.com/piped');
  });
  it('allows http only for localhost', () => {
    assert.equal(normaliseApiBase('http://localhost:8080'), 'http://localhost:8080');
    assert.equal(normaliseApiBase('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
    assert.equal(normaliseApiBase('http://example.com'), null);
  });
  it('rejects credentials, query strings, fragments, and junk', () => {
    assert.equal(normaliseApiBase('https://user:pass@example.com'), null);
    assert.equal(normaliseApiBase('https://example.com?x=1'), null);
    assert.equal(normaliseApiBase('https://example.com#frag'), null);
    assert.equal(normaliseApiBase('ftp://example.com'), null);
    assert.equal(normaliseApiBase(''), null);
    assert.equal(normaliseApiBase(null), null);
    assert.equal(normaliseApiBase('not a url'), null);
  });
});

describe('extractVideoIdFromUrl', () => {
  it('accepts a bare ID', () => {
    assert.equal(extractVideoIdFromUrl(ID), ID);
  });
  it('parses common YouTube URL forms', () => {
    assert.equal(extractVideoIdFromUrl(`https://www.youtube.com/watch?v=${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`https://www.youtube.com/watch?t=30&v=${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`https://youtu.be/${ID}?t=30`), ID);
    assert.equal(extractVideoIdFromUrl(`https://www.youtube.com/shorts/${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`https://www.youtube.com/live/${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`https://www.youtube.com/embed/${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`https://m.youtube.com/watch?v=${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`https://music.youtube.com/watch?v=${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
  });
  it('parses Piped URLs, relative paths, and schemeless input', () => {
    assert.equal(extractVideoIdFromUrl(`https://piped.video/watch?v=${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`/watch?v=${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`youtu.be/${ID}`), ID);
    assert.equal(extractVideoIdFromUrl(`youtube.com/watch?v=${ID}`), ID);
  });
  it('tolerates a URL pasted inside surrounding text', () => {
    assert.equal(extractVideoIdFromUrl(`check this out https://youtu.be/${ID} please`), ID);
  });
  it('returns empty string for non-video input', () => {
    assert.equal(extractVideoIdFromUrl('lofi beats to study'), '');
    assert.equal(extractVideoIdFromUrl('https://example.com/watch?v=short'), '');
    assert.equal(extractVideoIdFromUrl(''), '');
    assert.equal(extractVideoIdFromUrl(null), '');
  });
});

describe('getVideoId', () => {
  it('prefers the videoId field', () => {
    assert.equal(getVideoId({ videoId: ID, url: 'https://example.com' }), ID);
  });
  it('falls back to the url field', () => {
    assert.equal(getVideoId({ url: `https://www.youtube.com/watch?v=${ID}` }), ID);
  });
  it('returns empty string when nothing valid exists', () => {
    assert.equal(getVideoId({ videoId: 'nope', url: 'https://example.com' }), '');
    assert.equal(getVideoId(null), '');
    assert.equal(getVideoId({}), '');
  });
});

describe('normaliseItem', () => {
  it('maps Piped fields with defaults', () => {
    const item = normaliseItem({
      videoId: ID,
      title: 'A video',
      uploaderName: 'Channel',
      thumbnail: 'https://example.com/t.jpg',
      duration: 125,
      views: 1500,
      uploadedDate: '2024-01-01',
      isLive: false
    });
    assert.equal(item.id, ID);
    assert.equal(item.title, 'A video');
    assert.equal(item.channel, 'Channel');
    assert.equal(item.thumbnail, 'https://example.com/t.jpg');
    assert.equal(item.duration, 125);
    assert.equal(item.views, 1500);
    assert.equal(item.uploaded, '2024-01-01');
    assert.equal(item.isLive, false);
  });
  it('drops items without a valid ID and sanitises URLs', () => {
    assert.equal(normaliseItem({ title: 'No ID' }), null);
    const item = normaliseItem({ videoId: ID, thumbnail: 'javascript:alert(1)' });
    assert.equal(item.thumbnail, '');
    assert.equal(item.title, 'Untitled video');
    assert.equal(item.channel, 'Unknown channel');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    assert.equal(formatDuration(65), '1:05');
    assert.equal(formatDuration(3600), '1:00:00');
    assert.equal(formatDuration(3661), '1:01:01');
  });
  it('returns empty string for zero/invalid input', () => {
    assert.equal(formatDuration(0), '');
    assert.equal(formatDuration(-5), '');
    assert.equal(formatDuration(NaN), '');
    assert.equal(formatDuration('abc'), '');
  });
});

describe('formatViews', () => {
  it('formats counts compactly', () => {
    assert.match(formatViews(1500), /1[.,]5.*views/);
    assert.match(formatViews(2500000), /views/);
  });
  it('returns empty string for zero/invalid input', () => {
    assert.equal(formatViews(0), '');
    assert.equal(formatViews(-1), '');
    assert.equal(formatViews(NaN), '');
    assert.equal(formatViews(Infinity), '');
  });
});

describe('validateStoredItems', () => {
  it('keeps valid items and coerces fields', () => {
    const items = validateStoredItems([{ id: ID, title: 'T', duration: '90', views: '12' }]);
    assert.equal(items.length, 1);
    assert.equal(items[0].duration, 90);
    assert.equal(items[0].views, 12);
    assert.equal(items[0].isLive, false);
  });
  it('drops items with invalid IDs and non-objects', () => {
    const items = validateStoredItems([
      { id: 'short' },
      { id: 'has space!!' },
      null,
      'string',
      { id: ID }
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, ID);
  });
  it('returns empty array for non-array input', () => {
    assert.equal(validateStoredItems(null).length, 0);
    assert.equal(validateStoredItems({}).length, 0);
    assert.equal(validateStoredItems('x').length, 0);
  });
  it('sanitises stored URLs', () => {
    const items = validateStoredItems([{ id: ID, avatar: 'javascript:alert(1)', thumbnail: 'http://example.com/t.jpg' }]);
    assert.equal(items[0].avatar, '');
    assert.equal(items[0].thumbnail, '');
  });
});
