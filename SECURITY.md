# Security Policy

## Supported versions

NewPipe Web is a small static site; only the latest commit on `main` is
supported. There are no versioned releases to patch — fixes land on `main`
and are deployed from there.

## Reporting a vulnerability

Please report security issues privately via GitHub's
**Report a vulnerability** button on the repository's Security tab
(private security advisories). Please do not open a public issue for a
suspected vulnerability.

Include, where possible:

- A description of the issue and its impact.
- Steps to reproduce, including the browser and the Piped API instance used.
- Any proof-of-concept code (keep it minimal and non-destructive).

We will acknowledge receipt, investigate, and keep you updated on the fix.
Please allow reasonable time for a patch before disclosing publicly.

## Scope notes

- The app talks directly to the Piped API instance selected in Settings.
  That instance can see requests — use one you trust or host your own.
- Watch history and saved videos are stored only in the browser's
  `localStorage`; no account or server-side storage is involved.
- The Content-Security-Policy in `vercel.json` is part of the security
  posture: keep scripts and styles self-hosted (no inline handlers, no
  third-party CDNs).
