# blog §11.3 — SEO and discoverability

Reference implementation of [OSS_SPEC.md §11.3](../../../OSS_SPEC.md) as it
appears in [blog](https://github.com/niclaslindstedt/blog) at commit
`7c21708`.

These files implement the full discoverability surface the spec mandates:
a post-build SSR step that emits a real prose `<body>` per route (§11.3.1),
per-route `<head>` and JSON-LD generated from a single config module
(§11.3.2 / §11.3.3), the `sitemap.xml` / `robots.txt` / `llms.txt`
discovery files (§11.3.6), the RSS / Atom / JSON Feed trio (§11.3.7),
code-rendered 1200×630 OG cards per post (§11.3.8), and the two CI
workflows (`seo` and `lighthouse`) that gate every push and PR
(§11.3.10).

## File layout

```
website/
  index.html                       # SPA shell — global <head> + <div id="root"> hydration target
  public/
    robots.txt                     # static fallback; generate-seo.ts overwrites at build
  src/seo/
    siteConfig.ts                  # § 11.3.2 single source of truth: site URL, copy, OG dims, feed paths
  scripts/
    generate-seo.ts                # post-`vite build` orchestrator (sitemap, feeds, llms.txt, per-route HTML, OG PNGs)
    check-seo.ts                   # § 11.3.10 structural assertions, exits non-zero with ::error:: annotations
    seo/
      meta.ts                      # <head> + JSON-LD builders (BlogPosting, BreadcrumbList, CollectionPage, …)
      ogImage.ts                   # satori + resvg → 1200×630 PNG per post (§ 11.3.8)
      render.tsx                   # react-dom/server SSR for each route's prose body (§ 11.3.1)
.github/
  workflows/
    seo.yml                        # build + `check:seo`; runs on push/PR to main
    lighthouse.yml                 # build + `lhci autorun` against four representative URLs
  lighthouse/
    lighthouserc.json              # Core Web Vitals + category thresholds (warn-only baseline)
```

## How this sits in `blog`

- **One source of truth.** Everything that touches a URL or a string of
  user-visible SEO copy — `<title>`, meta descriptions, OG tags, JSON-LD,
  feed `<title>` / `<description>`, sitemap host, robots — imports from
  `website/src/seo/siteConfig.ts`. Both the runtime React client and the
  build-time Node scripts pull from the same module, so the spec's
  one-file-change requirement (§11.3.2 last paragraph) actually holds.
  When the site's pitch changes, only `siteConfig.ts` moves.
- **Post-build SSR, not a separate framework.** `blog` is a Vite + React
  SPA, not Next/Astro/Gatsby. The prerendering happens in
  `scripts/generate-seo.ts`, which runs *after* `vite build`: it reads
  the single `dist/index.html` shell, calls `react-dom/server`'s
  `renderToString` (via `scripts/seo/render.tsx`) for each route, and
  writes `dist/posts/<slug>/index.html`, `dist/tags/<tag>/index.html`,
  `dist/about/index.html`, `dist/tags/index.html`, plus the rewritten
  `dist/index.html` and a `dist/404.html` with `noindex,follow`. The
  client entry uses `hydrateRoot` (not `createRoot`) so the SSR'd prose
  isn't wiped on first paint — see `website/src/main.tsx` upstream.
- **One config drives every output.** `generate-seo.ts` and
  `scripts/seo/meta.ts` import `SITE_URL`, `SITE_NAME`,
  `DEFAULT_KEYWORDS`, `RSS_PATH`, `ATOM_PATH`, `JSON_FEED_PATH`,
  `SITEMAP_PATH`, `OG_IMAGE_DIR`, `postOgImagePath(slug)`, and
  `absoluteUrl()` from `siteConfig.ts`. The same values appear in the
  shell's `<link rel="alternate">` and `<link rel="sitemap">` lines so
  they cannot drift.
- **`check-seo.ts` is the regression dam.** Each assertion in the script
  maps to a real outage that took a numbered fix (issues #99 / #100 /
  #101 are referenced inline in the file's header comment): empty SSR
  body, missing `<h1>`, `noindex` slipped onto a real route, canonical
  drift, broken JSON-LD, `?view=blog` query-state leaks in static HTML,
  dropped sitemap entries, and the critical-path JS budget. Findings
  emit GitHub Actions `::error::` annotations tied to specific
  `dist/<file>.html` paths so the PR file view highlights them.
- **OG cards are pure Node.** `scripts/seo/ogImage.ts` uses `satori` to
  lay out a virtual DOM into SVG and `@resvg/resvg-js` to rasterize, so
  the build needs no headless Chromium — it runs on stock GitHub-hosted
  runners with no extra setup. Inter is read as WOFF2 from
  `@fontsource/inter` and decompressed to TTF via `wawoff2` (satori's
  bundled opentype.js can't parse WOFF2). The two TTFs are decompressed
  *sequentially*, not in `Promise.all` — wawoff2's WASM shares heap
  state and concurrent calls produce corrupt output. Default OG at
  `website/public/og-default.png`; per-post cards land at
  `dist/og/<slug>.png` per `postOgImagePath()`.
- **CI surface.** `.github/workflows/seo.yml` and `lighthouse.yml` run
  on every push and PR to `main`. They both `npm ci && npm run build`
  in `website/`, then one runs `npm run check:seo` (the structural
  check) and the other runs `lhci autorun` against the static
  `website/dist/` with the four URLs in `.github/lighthouse/lighthouserc.json`
  (home, a post, the tag index, about). The Lighthouse thresholds are
  on `warn` per §11.3.10's ratchet rule — they upgrade to `error` after
  three clean default-branch runs.
- **Page-weight budget.** `website/vite.config.ts` (not copied — it's
  outside §11.3's surface) uses `build.modulePreload.resolveDependencies`
  to filter lazy-loaded chunks out of the `<link rel="modulepreload">`
  list and `build.rollupOptions.output.manualChunks` to split the
  markdown stack and syntax highlighter into vendor chunks. The
  critical-path budget is checked inside `check-seo.ts` against the
  shipped `dist/index.html`'s preload graph.

Recommended reading order: `siteConfig.ts` → `index.html` →
`scripts/seo/meta.ts` → `scripts/seo/render.tsx` → `generate-seo.ts`
(top to bottom; it orchestrates the rest) → `check-seo.ts` → the two
workflow YAMLs.

## How to adopt this in another project

1. **Drop the SEO config in first.** Copy `website/src/seo/siteConfig.ts`
   into your site, then change every constant (`SITE_URL`, `SITE_NAME`,
   `SITE_TAGLINE`, `SITE_DESCRIPTION`, `AUTHOR.*`, `DEFAULT_KEYWORDS`,
   `AUTHOR_SAME_AS`) to your project's values. Leave the optional
   `AUTHOR.image` / `description` / `jobTitle` and the `ORGANIZATION`
   object as empty strings if you're not ready to populate them — the
   builders in `meta.ts` skip empty fields rather than emitting blank
   JSON-LD properties. Keep the function signatures (`absoluteUrl()`,
   `postOgImagePath()`) as-is; the build scripts import them by name.

2. **Decide where the prerendered HTML comes from.** This example is for
   a Vite + React SPA, so the pattern is "build the SPA, then run a
   Node post-build step that SSRs every route into its own
   `dist/<route>/index.html`". If your project already uses Next, Astro,
   SvelteKit, or any framework with built-in SSG, *delete*
   `scripts/seo/render.tsx` and `scripts/generate-seo.ts`'s per-route
   HTML splicing — your framework already does that part. Keep
   `scripts/seo/meta.ts` (the JSON-LD and `<head>` builders) and call
   it from your framework's metadata API instead. The signatures of
   `homeJsonLd()`, `postJsonLd()`, `tagJsonLd()`,
   `aboutJsonLd()`, the four `*BreadcrumbJsonLd()` helpers, and
   `renderHead()` are designed to be framework-agnostic — they return
   strings.

3. **Wire up `generate-seo.ts` to your data source.** The script reads
   `src/generated/posts.json` (a build-time-extracted list of `Post`
   records: `slug`, `title`, `date`, `tags[]`, `body`, etc.). Repoint
   `POSTS_JSON` at your equivalent source of structured content — a
   `content/` directory walked by another script, a CMS query, the
   output of your markdown pipeline. The `Post` type definition lives
   at `website/src/types.ts` in the upstream repo; copy it or replace
   it with your shape. Then verify each `generate-seo.ts` output (the
   per-route HTML, the three feeds, sitemap, robots.txt, llms.txt) is
   pulling from your data correctly by inspecting `dist/` after a build.

4. **Adjust the OG card design.** `scripts/seo/ogImage.ts` is
   intentionally code-only (no PNGs, no design assets) so a new project
   can repaint it by editing the constants at the top (`BG`, `ACCENT`,
   `FG_BRIGHT`, `FG_DIM`) and the layout JSX further down. If you keep
   the Inter font, install `@fontsource/inter` and `wawoff2` and leave
   `loadTtf()` alone. If you swap the font, replace the two
   `loadTtf("inter-latin-…woff2")` calls with the equivalent file from
   your `@fontsource` package, or any local TTF. Remember to keep the
   1200×630 dimensions — `OG_IMAGE_WIDTH` / `OG_IMAGE_HEIGHT` in
   `siteConfig.ts` and the `WIDTH` / `HEIGHT` in `ogImage.ts` must
   match each other and §11.3.8's spec.

5. **Adjust `check-seo.ts` for your route shape.** The script walks
   every `*.html` under `dist/` so it picks up new routes
   automatically, but a few assertions are blog-specific: the
   `BlogPosting.image` ↔ `og:image` cross-check assumes the JSON-LD
   `@type` is `BlogPosting`; the `?view=blog` and `?view=terminal`
   tracking-param checks are specific to `blog`'s URL state. Update
   the `@type` to your article type (`TechArticle`, `Article`,
   `NewsArticle`) and remove or replace the query-param checks with
   whatever app-state params your site might leak. Keep every other
   assertion — they map 1:1 to the §11.3.10 bullets and are stack-
   agnostic.

6. **Copy the workflows and Lighthouse config.** Drop
   `.github/workflows/seo.yml`, `.github/workflows/lighthouse.yml`, and
   `.github/lighthouse/lighthouserc.json` into the target repo. The
   only edits needed:
   - In both workflows, change the `working-directory` from `website`
     to wherever your build lives (or remove it if the build is at
     repo root).
   - In `lighthouserc.json`, replace the four `url:` entries with one
     URL per content type in your site (homepage + one representative
     URL of each kind — post, tag, doc, command, etc.). Keep four to
     six; more burns CI minutes without surfacing new failure modes.
   - Leave the thresholds on `warn` until you have three consecutive
     clean default-branch runs (per §11.3.10's ratchet rule), then
     flip the ones you trust to `error`.

7. **Wire the build scripts into `package.json`.** Add to your
   site's `package.json`:

   ```json
   "scripts": {
     "build": "<your existing build> && tsx scripts/generate-seo.ts",
     "check:seo": "tsx scripts/check-seo.ts"
   }
   ```

   …and the dev-dependencies: `tsx`, `satori`, `@resvg/resvg-js`,
   `wawoff2`, `@fontsource/inter`, `react-dom`, `react-router-dom`
   (the last two are only needed if you also adopt `render.tsx`).

8. **Update the badge row.** Per §11.3.11, the README badge row should
   read `ci | seo | pages | license`. The `seo` badge points at
   `seo.yml` so the colour reflects the structural check, not just
   page deploy.

9. **Dry-run.** Build the site, then:
   - Open `dist/index.html`, `dist/posts/<slug>/index.html`, and
     `dist/404.html` in a browser with JS disabled. Each should show
     real prose — heading, body, internal links — without hydration.
   - `npm run check:seo` exits 0.
   - `curl -sI https://<host>/feed.xml` returns the right MIME type
     once deployed; `sitemap.xml` lists every per-post HTML; `llms.txt`
     starts with `# <site name>`.

   The first run on a new repo usually surfaces one of: an empty `<body>`
   on a route you forgot to add to `render.tsx`, a stale
   `dist/index.html` because `generate-seo.ts` ran before `vite build`
   in the `build` script chain, or an OG image at the wrong path because
   `OG_IMAGE_DIR` and the `<meta og:image>` URL diverged. All three are
   cheap to fix once observed; `check-seo.ts` catches every one.

## Caveats

- **Vite + React assumptions.** `scripts/seo/render.tsx` imports from
  `../../src/AudienceContext.tsx`, `../../src/PreferencesContext.tsx`,
  `../../src/terminal/index.ts`, etc. — the blog's actual provider
  stack. You will rip those out and replace them with your own
  providers (or none) before this file compiles in another repo. The
  *shape* is reusable; the imports are not. If you're on a different
  framework, skip `render.tsx` entirely and prerender through your
  framework's SSG instead.
- **`check-seo.ts` hard-codes `SITE_URL`.** Line 18 of the file
  re-declares the canonical host as a string literal rather than
  importing from `siteConfig.ts`. This is deliberate — the check
  script is *also* the canary on `siteConfig.ts` drift — but it means
  you must update both files when the canonical host changes.
- **The Lighthouse thresholds are `warn`, not `error`.** New projects
  start every assertion on `warn` and ratchet specific ones to `error`
  once a baseline of three clean runs exists (§11.3.10 last
  paragraph). Don't flip them all to `error` on day one or you'll
  block PRs on transient runner noise.
- **`og-default.png` is not copied.** The actual 1200×630 default OG
  PNG lives at `website/public/og-default.png` upstream but is omitted
  here — it's a binary asset specific to the blog's brand. Generate
  your own (or run `ogImage.ts` against a placeholder Post) and drop
  it at the same path.
- **Per-post OG generation needs `posts.json`.** `generate-seo.ts`
  expects `src/generated/posts.json` to already exist when it runs,
  which means an earlier step in the build chain (in `blog`'s case,
  `scripts/extract-posts.ts`) has to write it. The extractor is not
  part of §11.3's surface and isn't copied here; you'll bring your own.
- **`vite.config.ts` is not in scope.** The `manualChunks` and
  `modulePreload.resolveDependencies` configuration that enforces the
  §11.3.9 budget lives in `website/vite.config.ts` upstream. If you
  also use Vite, copy that file separately; if you use another
  bundler, achieve the equivalent (Webpack `splitChunks`,
  Rollup `output.manualChunks`, Parcel `--no-source-maps`, etc.) and
  ensure your bundler doesn't transitively preload lazy chunks.

## Provenance

Refreshed by `.agent/skills/copy-example` from
`website/src/seo/`, `website/scripts/seo/`,
`website/scripts/{generate-seo,check-seo}.ts`, `website/index.html`,
`website/public/robots.txt`, `.github/workflows/{seo,lighthouse}.yml`,
and `.github/lighthouse/lighthouserc.json` at
`niclaslindstedt/blog@7c21708`.
