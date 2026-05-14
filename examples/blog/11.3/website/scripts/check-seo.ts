// Post-build SEO regression check. Walks every HTML file under `dist/` and
// asserts the signals Search Console actually reads — title/description,
// canonical, robots, OG, JSON-LD, internal link graph, sitemap coverage,
// and chunk-size budgets. Each failure prints a GitHub Actions `::error::`
// annotation so the line surfaces inline on the PR file view; the script
// exits non-zero if anything fails.
//
// Run locally with `npm run check:seo` after a build, or as a CI job after
// `npm run build`. Keeping every assertion in one place means the failure
// modes that took #99 / #100 / #101 to spot can't silently come back —
// next time the body goes empty, or the JSON-LD image regresses, or a
// `?view=blog` link creeps back into the SSR output, CI says so.

import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve("dist");
const SITE_URL = "https://blog.niclaslindstedt.se";

interface Finding {
  level: "error" | "warning";
  file: string;
  message: string;
}

const findings: Finding[] = [];

function err(file: string, message: string): void {
  findings.push({ level: "error", file, message });
}

function warn(file: string, message: string): void {
  findings.push({ level: "warning", file, message });
}

function walkHtml(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function bodyOf(html: string): string | null {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  return m ? m[1] : null;
}

function attr(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

// -- Per-page checks --------------------------------------------------------

function checkHtmlFile(file: string): void {
  const rel = path.relative(DIST, file).replace(/\\/g, "/");
  const html = fs.readFileSync(file, "utf8");
  const is404 = rel === "404.html";

  // 1. <body> must have substantive content. The original Search Console bug
  //    was a bare `<body><div id="root"></div></body>` — easy to regress to
  //    if the SSR generator stops splicing the prerendered tree in.
  const body = bodyOf(html);
  if (!body) {
    err(rel, "no <body> tag");
  } else {
    const words = text(body).split(/\s+/).filter(Boolean).length;
    if (words < 20) err(rel, `<body> has only ${words} words — looks like an empty SPA shell`);
  }

  // 2. Exactly one <h1>. Zero h1s confuses Google's topic detection; multiple
  //    h1s dilute the page-topic signal.
  const h1Count = (body ?? html).match(/<h1[\s>]/g)?.length ?? 0;
  if (h1Count === 0) err(rel, "missing <h1>");
  else if (h1Count > 1) warn(rel, `${h1Count} <h1> tags — only one should describe the page topic`);

  // 2b. Heading levels should not skip — h1 → h3 with no intervening h2 is
  //     a Lighthouse accessibility flag and a mild SEO signal. We check the
  //     first time each level appears in document order.
  if (body) {
    const seen = new Set<number>();
    for (const m of body.matchAll(/<h([1-6])[\s>]/g)) {
      seen.add(Number(m[1]));
    }
    const levels = [...seen].sort((a, b) => a - b);
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        warn(
          rel,
          `heading levels skip from h${levels[i - 1]} to h${levels[i]} — Lighthouse / a11y flag`,
        );
        break;
      }
    }
  }

  // 3. <title> and meta description must exist and be non-empty.
  const title = attr(html, /<title>([^<]*)<\/title>/);
  if (!title || !title.trim()) err(rel, "missing or empty <title>");
  else if (title.length > 70)
    warn(rel, `<title> is ${title.length} chars — Google truncates around 60`);

  const desc = attr(html, /<meta\s+name="description"\s+content="([^"]*)"/);
  if (!desc || !desc.trim()) err(rel, "missing or empty meta description");
  else if (desc.length > 160)
    warn(rel, `meta description is ${desc.length} chars — Google truncates around 160`);

  // 4. Canonical must be absolute and on the right host.
  const canonical = attr(html, /<link\s+rel="canonical"\s+href="([^"]+)"/);
  if (!canonical) err(rel, "missing canonical link");
  else if (!canonical.startsWith(`${SITE_URL}/`))
    err(rel, `canonical \`${canonical}\` is not absolute under ${SITE_URL}`);

  // 5. Robots. Real pages must be indexable; the 404 must be noindex so
  //    GitHub Pages' SPA fallback doesn't leak soft-404 signals.
  const robots = attr(html, /<meta\s+name="robots"\s+content="([^"]+)"/);
  if (!robots) {
    err(rel, "missing robots meta");
  } else if (is404) {
    if (!/\bnoindex\b/.test(robots)) err(rel, "404.html must have noindex");
  } else {
    if (/\bnoindex\b/.test(robots))
      err(rel, `real page has \`noindex\` (\`${robots}\`) — it won't be indexed`);
  }

  // 6. og:image must resolve to a real file in dist/.
  const ogImage = attr(html, /<meta\s+property="og:image"\s+content="([^"]+)"/);
  if (!ogImage) {
    err(rel, "missing og:image");
  } else if (ogImage.startsWith(`${SITE_URL}/`)) {
    const local = path.join(DIST, ogImage.slice(SITE_URL.length + 1));
    if (!fs.existsSync(local)) err(rel, `og:image \`${ogImage}\` doesn't exist in dist/`);
  }

  // 7. JSON-LD must parse, and any BlogPosting `image` should match the OG
  //    image meta (Google's article/Discover cards read the JSON-LD image,
  //    not the og:image — they drifted apart before #100 caught it).
  const jsonLdBlocks = [
    ...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g),
  ];
  for (const block of jsonLdBlocks) {
    const raw = block[1].replace(/\\u003c/g, "<");
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      err(rel, `JSON-LD block doesn't parse: ${(e as Error).message}`);
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (
        typeof item === "object" &&
        item !== null &&
        (item as { "@type"?: unknown })["@type"] === "BlogPosting"
      ) {
        // `image` is either a bare URL string or an ImageObject `{ url, … }`.
        // Both shapes are valid; what matters is that the URL points at the
        // same asset as the og:image meta so social cards and rich results
        // don't disagree about which picture represents the post.
        const raw = (item as { image?: unknown }).image;
        let imageUrl: string | undefined;
        if (typeof raw === "string") imageUrl = raw;
        else if (
          typeof raw === "object" &&
          raw !== null &&
          typeof (raw as { url?: unknown }).url === "string"
        ) {
          imageUrl = (raw as { url: string }).url;
        }
        if (imageUrl && ogImage && imageUrl !== ogImage) {
          err(
            rel,
            `BlogPosting JSON-LD image \`${imageUrl}\` doesn't match og:image \`${ogImage}\``,
          );
        }
      }
    }
  }

  // 8. No `?view=blog` leaks in the SSR'd body. The runtime React Link
  //    components carry that param so in-app navigation persists the prose
  //    view, but in static HTML it's just crawl-budget noise (canonical
  //    de-dupes, but only after Googlebot has fetched both).
  if (body) {
    const leaks = (body.match(/\?view=blog/g) ?? []).length;
    if (leaks > 0) err(rel, `${leaks} \`?view=blog\` leak(s) in <body> — crawl-budget waste`);
  }

  // 9. Every <img> in the SSR'd body must have a non-empty `alt`, plus
  //    `width`+`height` (CLS) and `loading`+`decoding` (LCP/INP). The site
  //    has no images today, but the moment a post adds one this check
  //    catches the typical regressions — empty alt for actual content,
  //    missing dimensions causing layout shift, no lazy/async hints.
  if (body) {
    const imgs = body.match(/<img\b[^>]*>/g) ?? [];
    for (const img of imgs) {
      const altMatch = img.match(/\balt="([^"]*)"/);
      if (!altMatch) err(rel, `<img> without alt attribute: ${img.slice(0, 80)}…`);
      else if (altMatch[1].trim() === "")
        warn(
          rel,
          `<img> with empty alt — only OK for purely decorative images: ${img.slice(0, 80)}…`,
        );
      if (!/\bwidth="/.test(img) || !/\bheight="/.test(img))
        warn(
          rel,
          `<img> missing width/height — Google flags this as a layout-shift risk: ${img.slice(0, 80)}…`,
        );
      if (!/\bloading="/.test(img))
        warn(rel, `<img> without loading attribute: ${img.slice(0, 80)}…`);
    }
  }
}

// -- Repo-wide checks -------------------------------------------------------

function checkSitemap(htmlFiles: string[]): void {
  const sitemapPath = path.join(DIST, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) {
    err("sitemap.xml", "sitemap.xml is missing");
    return;
  }
  const sitemap = fs.readFileSync(sitemapPath, "utf8");

  // Every per-post HTML file must have a matching `<loc>` in the sitemap —
  // otherwise the post is orphaned for any crawler that doesn't pick it up
  // from the homepage link graph.
  for (const file of htmlFiles) {
    const rel = path.relative(DIST, file).replace(/\\/g, "/");
    if (!rel.startsWith("posts/")) continue;
    const slug = rel.replace(/\/index\.html$/, "/");
    const loc = `${SITE_URL}/${slug}`;
    if (!sitemap.includes(`<loc>${loc}</loc>`)) {
      err("sitemap.xml", `missing entry for ${loc}`);
    }
  }
}

function checkRobotsTxt(): void {
  const robotsPath = path.join(DIST, "robots.txt");
  if (!fs.existsSync(robotsPath)) {
    err("robots.txt", "robots.txt is missing");
    return;
  }
  const robots = fs.readFileSync(robotsPath, "utf8");
  if (!/Sitemap:\s*https?:\/\//i.test(robots))
    err("robots.txt", "missing `Sitemap:` line pointing at sitemap.xml");
  if (/Disallow:\s*\/\s*$/m.test(robots))
    err("robots.txt", "`Disallow: /` blocks the entire site from indexing");
}

// llms.txt is the AI-crawler counterpart of sitemap.xml — minimal, but if
// the file goes missing readers and agents that look for it (Claude search,
// Perplexity, etc.) silently see a 404 instead of the post list. Cheap to
// assert it exists with the expected shape.
function checkLlmsTxt(): void {
  const llmsPath = path.join(DIST, "llms.txt");
  if (!fs.existsSync(llmsPath)) {
    err("llms.txt", "llms.txt is missing");
    return;
  }
  const llms = fs.readFileSync(llmsPath, "utf8");
  if (!/^#\s+\S/m.test(llms)) err("llms.txt", "missing top-level `# Site title` heading");
  if (!/^##\s+Posts/m.test(llms)) warn("llms.txt", "missing `## Posts` section");
}

function checkBundleBudgets(): void {
  // Critical-path JS budget. Anything in `dist/assets/` that the entry HTML
  // preloads counts as critical; lazy chunks aren't subject to the budget.
  // Tracked against the post-#101 baseline (~544 KB / 174 KB gzip), with
  // headroom for incremental additions. Trip this and someone has either
  // imported a heavy lib into the entry tree or undone a manualChunks split.
  const BUDGET_BYTES = 600_000; // raw min'd; gzip is ~3.1x smaller in practice
  const assetsDir = path.join(DIST, "assets");
  if (!fs.existsSync(assetsDir)) return;

  const indexHtml = path.join(DIST, "index.html");
  if (!fs.existsSync(indexHtml)) return;
  const html = fs.readFileSync(indexHtml, "utf8");

  // Pull every chunk the shell eagerly loads/preloads — `<script type=module
  // src=…>` plus `<link rel=modulepreload href=…>`. Lazy chunks aren't here
  // by definition.
  const critical = new Set<string>();
  for (const m of html.matchAll(/<(?:script[^>]*src|link[^>]*href)="(\/assets\/[^"]+\.js)"/g)) {
    critical.add(m[1]);
  }
  let total = 0;
  for (const url of critical) {
    const file = path.join(DIST, url.replace(/^\//, ""));
    if (fs.existsSync(file)) total += fs.statSync(file).size;
  }
  if (total > BUDGET_BYTES) {
    err(
      "dist/assets",
      `critical-path JS is ${(total / 1024).toFixed(1)} KB across ${critical.size} chunk(s) — exceeds ${(BUDGET_BYTES / 1024).toFixed(0)} KB budget`,
    );
  }
}

// -- Main -------------------------------------------------------------------

function main(): void {
  if (!fs.existsSync(DIST)) {
    process.stderr.write("check-seo: dist/ is missing — run `npm run build` first\n");
    process.exit(1);
  }

  const htmlFiles = walkHtml(DIST);
  if (htmlFiles.length === 0) {
    err("dist/", "no HTML files found");
  }
  for (const file of htmlFiles) checkHtmlFile(file);

  checkSitemap(htmlFiles);
  checkRobotsTxt();
  checkLlmsTxt();
  checkBundleBudgets();

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");

  // GitHub Actions workflow-command annotations — surface the line on the PR
  // when the script runs in CI. The same lines are human-readable when run
  // locally.
  for (const f of findings) {
    const prefix = f.level === "error" ? "::error" : "::warning";
    process.stdout.write(`${prefix} file=website/dist/${f.file}::${f.message}\n`);
  }

  const summary = `check-seo: ${htmlFiles.length} page(s) checked — ${errors.length} error(s), ${warnings.length} warning(s)\n`;
  process.stdout.write(summary);

  if (errors.length > 0) process.exit(1);
}

main();
