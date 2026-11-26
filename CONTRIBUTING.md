# Contributing

Thanks for helping out! NewPipe Web is a small static site: plain HTML, CSS and
JavaScript with no build step and no npm dependencies.

## Run locally

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>. Use a local server rather than opening
`index.html` directly, because the page uses root-relative paths (`/app.js`).

## Guidelines

- Keep it dependency-free and build-free unless there is a strong reason.
- Escape anything that comes from the API or from `localStorage` before it
  reaches the DOM (`escapeHTML`, `safeHttpsUrl`).
- Don't add inline scripts or `on*=` handlers; the Content-Security-Policy in
  `vercel.json` forbids them.
- Keep pure helpers in `lib.js` (DOM-free, loaded before `app.js`) so they
  stay unit-testable. Add or update tests in `tests/app.test.js` when you
  change them.
- Run `npm run check` and `npm test` before opening a pull request
  (CI runs the same commands). If you change `app.js`, `lib.js`, `app.css`,
  or `index.html`, bump `CACHE_VERSION` in `sw.js`.

By contributing you agree your work is licensed under GPL-3.0-or-later.
