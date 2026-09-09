// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
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
