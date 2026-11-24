# NewPipe Web

A small, responsive web companion built alongside the NewPipe Android and desktop project. This first version is a static site with no build step or npm dependencies. It uses a Piped API for YouTube data rather than porting NewPipe's Kotlin extractor, so it does not yet cover every NewPipe service or native-app feature.

## Current features

- Browse regional trending videos and search videos.
- Paste a YouTube or Piped video link to open it.
- Play browser-compatible streams supplied by a Piped API instance.
- Keep a Watch later list and watch history in this browser's local storage.
- Switch playback quality without losing your place.
- Choose the API server and trending region in Settings.

Subscriptions, background playback, offline downloads, and NewPipe account or settings sync are not part of this first web version.

## Run locally

```sh
python3 -m http.server 8000   # or: npx serve .
```

Open <http://localhost:8000>. There is nothing to install or build.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page markup, dialogs and navigation |
| `app.css` | All styling |
| `app.js` | API calls, rendering, player, local storage |
| `assets/` | NewPipe icon |
| `vercel.json` | Static-site settings and security headers (CSP etc.) |
| `.github/workflows/ci.yml` | Syntax and sanity checks |

## Deploy on Vercel

Import this standalone repository into Vercel and use the repository root (`.`) as the project Root Directory. Use the **Other** framework preset, leave the build command empty, and set the output directory to `.`. The included `vercel.json` keeps these static-site settings in the repository. Vercel serves the site without compiling it.

## Video service

The browser calls the selected Piped API server directly for search, trending results, video details, and stream URLs. The default is `https://pipedapi.kavin.rocks`; a public server can be unavailable or may change its policies. Open Settings to choose another server. The server you use can see your requests, so use an instance you trust or host your own.

The API is documented at [docs.piped.video](https://docs.piped.video/docs/api-documentation/), and the public-instance list is maintained by [TeamPiped](https://github.com/TeamPiped/Piped/wiki/Instances).

## Disclaimer

NewPipe Web is an independent project and is not an official release of the NewPipe team. It does not download, host or rewrite video content; it only talks to the Piped API server you choose.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This web companion is distributed under the repository's GPL-3.0-or-later license. The NewPipe icon is copied from the project's `assets/new_pipe_icon_5.svg` asset. See the repository's root `LICENSE` for the license text and project notices.
