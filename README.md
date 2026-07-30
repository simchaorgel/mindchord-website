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
- `npm run dev:console` runs the console dev server at http://localhost:8081. To view visit http://localhost:8081/console/dashboard
*Build scripts (for testing)*
- `npm run build:site` builds the public site to `dist/`
- `npm run build:console` builds the console to `dist/console/`
- `npm run build` builds both parts


## Offline licences
The desktop app can run with no network access, gated by a signed `.mind` licence file
that carries the client's identity, their entitlement, and their protocols. The console
issues those files from a client's page (**Create offline licence**).

Signing happens in `netlify/functions/mint-licence.js` — never in the browser. Anyone
holding the private key can mint a licence for any machine, and if it leaks the only fix
is a new desktop build with a new public key plus a reissue to every existing client.

Any member of the org can be issued one, not just clients — clinicians run the app
themselves to try a protocol before assigning it, and reach the same page via the
organization list. Org membership is the only boundary the endpoint enforces.

A licence is locked to one computer by its **machine code**, which is read off the app's
licence screen. It's stored on the profile (Edit details) so it only has to be collected
once — renewals read it from there. Issuing a new licence is how you
both renew a subscription and push protocol changes; there's no way to revoke one early,
so the expiry window (one month) *is* the revocation window.

## Environment variables
Set in Netlify → Site settings → Environment variables. None of these may be committed
or reach the browser bundle.

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all functions | Falls back to a hardcoded project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | `add-client`, `mint-licence` | Bypasses RLS, so every function using it must authenticate its caller itself. |
| `MINDCHORD_LICENCE_KEY` | `mint-licence` | Base64-encoded 32-byte Ed25519 seed. Must match the public key embedded in the desktop build. |

## Database migrations
`supabase/migrations/` is a record of schema changes, applied by hand via the Supabase
SQL editor — there's no migration runner. Files are idempotent and numbered in order.
Note that `service_role` bypasses RLS but **not** table-level GRANTs, so a new table or
column usually needs an explicit grant before a function can touch it.

## Deployment
Netlify auto-deploys on git pushes to `main` and runs `npm install && npm run build`
 (see [`netlify.toml`]).

