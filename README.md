# Mindchord Website
Public website for the **Mindchord** app displayed at https://mindchord.net. The website has two parts:

The public website is in `site/` and contains pages for app info, contact, app dowload, legal and more. It builds to `dist/`.

The provider console in `console/` is the console that providers use to manage clients. It is used to set protocols, review sessions, and to manage clients and the organization. It builds to `dist/console/`.

Each part is independent and has its own `.eleventy.js`, layouts, and assets.

The website is deployed to Netlify, and is built automatically on pushes to the `main` branch.

## Links
*Prod website* https://mindchord.net

*Hosting* https://app.netlify.com

*Domain management* https://dash.cloudflare.com/

*App installer bucket* https://pub-de203417a4164a319459d3e18a141c9b.r2.dev

## Stack
- **Netlify** for hosting, server-side functions, and form handling
- **Eleventy** for static generation and templating
- **Supabase API** for console auth (email OTP) and DB read and write. Gated by RLS

## Dev
### Requirements
npm

### Scripts
*Dev server scripts*
- `npm run dev:site` runs the public site dev server at http://localhost:8080
- `run dev:console` runs the console dev server at http://localhost:8081. To view visit http://localhost:8081/console/dashboard
*Build scripts (for testing)*
- `npm run build:site` builds the public site to `dist/`
- `npm run build:console` builds the console to `dist/console/`
- `npm run build` builds both parts


## Deployment
Netlify auto-deploys on git pushes to `main` and runs `npm install && npm run build`
 (see [`netlify.toml`]).

