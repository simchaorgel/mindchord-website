// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  /* The deployed origin. Nothing derives a absolute URL without it: the
     sitemap cannot be written at all, and Astro.site — which Base.astro
     builds the canonical and og:url from — is undefined. No trailing slash;
     Astro adds the path. */
  site: 'https://mindchord.net',

  integrations: [
    /* Emits sitemap-index.xml and sitemap-0.xml at build. Static routes are
       found by crawling the output, so a new page under src/pages needs no
       entry here.

       Two are held back. Neither is content a search result should ever land
       on: /404 is not a page at all, and /contact/sent only means anything as
       the step after a submission — arriving at "Message sent" cold, from a
       search, says something happened that did not. */
    sitemap({
      filter: (page) =>
        !/\/(404|contact\/sent)\/?$/.test(new URL(page).pathname),
    }),
  ],

  build: {
    /* Emit global.css as one external file instead of inlining it into every
       page. The background system is shared by every route, so a single
       cached stylesheet beats duplicating the noise data URIs per page —
       and with view transitions it is already loaded, so navigations reuse
       it rather than re-parsing an inline <style>. */
    inlineStylesheets: 'never',
  },

  fonts: [
    {
      /* TeX Gyre Pagella — a Palatino clone. Used for the Mindchord wordmark;
         available site-wide as var(--font-pagella).

         Astro generates the @font-face rules, metric-matched fallbacks (so
         swapping in the real font shifts layout less), and preload links.
         Source files are .otf at ~144KB each — converting to WOFF2 would cut
         that by roughly two thirds if the font ever gets used beyond the
         wordmark. */
      provider: fontProviders.local(),
      name: 'TeX Gyre Pagella',
      cssVariable: '--font-pagella',
      fallbacks: ['Palatino', 'Palatino Linotype', 'Georgia', 'serif'],
      options: {
        variants: [
          {
            weight: 400,
            style: 'normal',
            src: ['./src/assets/tex-gyre-pagella/texgyrepagella-regular.otf'],
          },
          {
            weight: 700,
            style: 'normal',
            src: ['./src/assets/tex-gyre-pagella/texgyrepagella-bold.otf'],
          },
          {
            weight: 400,
            style: 'italic',
            src: ['./src/assets/tex-gyre-pagella/texgyrepagella-italic.otf'],
          },
          {
            weight: 700,
            style: 'italic',
            src: ['./src/assets/tex-gyre-pagella/texgyrepagella-bolditalic.otf'],
          },
        ],
      },
    },
  ],
});
