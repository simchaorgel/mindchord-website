# Mindchord Website
Public website for the **Mindchord** app displayed at https://mindchord.net. It contains
pages for app info, contact, app download, legal and more.

Source is in `src/`, and builds to `dist/`.

The provider dashboard used to live in this repo under `console/`, served at
`/console/`. It moved to its own repo and domain in August 2026 — see
https://dash.mindchord.net. `netlify.toml` keeps a 301 from `/console/*` so old
bookmarks still work. Nothing here talks to Supabase any more.

The website is deployed to Netlify, and is built automatically on pushes to the `main` branch.

## Links
*Prod website* https://mindchord.net

*Provider dashboard* https://dash.mindchord.net

*Hosting* https://app.netlify.com

*Domain management* https://dash.cloudflare.com/

*App installer bucket* https://pub-de203417a4164a319459d3e18a141c9b.r2.dev

## Stack
- **Netlify** for hosting and form handling
- **Eleventy** for static generation and templating

## Dev
### Requirements
npm

### Scripts
- `npm run dev` runs the dev server at http://localhost:8080
- `npm run build` builds to `dist/`

## App update feed
`src/api/update_info.json` is served at `/api/update_info.json` and is polled by the
desktop app to discover new versions. The `[[headers]]` block in `netlify.toml` gives it
permissive CORS plus a 5-minute cache — the app fetches it cross-origin, so removing
those headers breaks update checks silently.

## Deployment
Netlify auto-deploys on git pushes to `main` and runs `npm install && npm run build`
 (see [`netlify.toml`]).
