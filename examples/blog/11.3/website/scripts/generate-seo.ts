// Post-build SEO generator. Runs after `vite build`; takes the single SPA
// shell (dist/index.html) plus the canonical post data (src/generated/posts.json)
// and emits:
//   - dist/index.html                          (homepage, with homepage <head> + prose body)
//   - dist/posts/<slug>/index.html             (per-post, with BlogPosting meta + post body)
//   - dist/tags/<tag>/index.html               (per-tag, with CollectionPage + tag listing)
//   - dist/404.html                            (real not-found page, noindex)
//   - dist/sitemap.xml
//   - dist/robots.txt
//   - dist/llms.txt                            (machine-readable index for AI crawlers)
//   - dist/feed.xml                            (RSS 2.0 with full <content:encoded>)
//   - dist/feed.atom                           (Atom 1.0 with full <content type="html">)
//   - dist/feed.json                           (JSON Feed 1.1)
//
// Each per-route HTML also has its <div id="root"> pre-populated with the
// prose-fallback render of that route via react-dom/server. That gives
// crawlers a real <h1>, the post body, breadcrumbs, and the internal link
// graph — without those, Search Console was reporting "Discovered – currently
// not indexed" for every post because the shipped body was an empty <div>.
// On the client React's createRoot() replaces this content with the
// interactive terminal (or keeps the prose view, if the reader prefers it).

import fs from "node:fs";
import path from "node:path";
import type { Post } from "../src/types.ts";
import {
  ATOM_PATH,
  AUTHOR,
  DEFAULT_KEYWORDS,
  FEED_POST_LIMIT,
  JSON_FEED_PATH,
  RSS_PATH,
  SITEMAP_PATH,
  SITE_DESCRIPTION,
  SITE_LANGUAGE,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  absoluteUrl,
  postOgImagePath,
} from "../src/seo/siteConfig.ts";
import { renderOgImage } from "./seo/ogImage.ts";
import {
  aboutBreadcrumbJsonLd,
  aboutJsonLd,
  escapeXml,
  homeJsonLd,
  pickPrimaryVersion,
  postBreadcrumbJsonLd,
  postJsonLd,
  renderHead,
  tagBreadcrumbJsonLd,
  tagJsonLd,
  tagsIndexBreadcrumbJsonLd,
  tagsIndexJsonLd,
} from "./seo/meta.ts";
import {
  renderAboutBody,
  renderHomeBody,
  renderMarkdownToHtml,
  renderNotFoundBody,
  renderPostBody,
  renderTagBody,
  renderTagsIndexBody,
} from "./seo/render.tsx";

const DIST = path.resolve("dist");
const POSTS_JSON = path.resolve("src", "generated", "posts.json");
const posts = JSON.parse(fs.readFileSync(POSTS_JSON, "utf8")) as Post[];

function readShell(): string {
  const p = path.join(DIST, "index.html");
  if (!fs.existsSync(p)) {
    throw new Error(`generate-seo: ${p} is missing — run vite build first`);
  }
  return fs.readFileSync(p, "utf8");
}

// Splice the generated meta block before </head>. Also strip the placeholder
// <title>/<meta name="description"> that the shell ships with so we don't end
// up with two titles — per-route values replace the site-wide defaults.
function injectHead(shell: string, headFragment: string): string {
  const stripped = shell
    .replace(/\n\s*<title>[\s\S]*?<\/title>/g, "")
    .replace(/\n\s*<meta\s+name="description"[\s\S]*?\/>/g, "");
  const idx = stripped.indexOf("</head>");
  if (idx === -1) throw new Error("generate-seo: shell has no </head>");
  return stripped.slice(0, idx) + "\n" + headFragment + "\n  " + stripped.slice(idx);
}

// Drop the SSR-rendered prose into <div id="root">. Vite emits the shell with
// an empty <div id="root"></div>; we replace it with the same div whose
// children are the static markup for the current route. Client-side React
// (createRoot) clears the children on first render and mounts the interactive
// tree, so this content is purely the initial-paint / no-JS / crawler view.
function injectBody(shell: string, bodyHtml: string): string {
  const replaced = shell.replace(/<div id="root"><\/div>/, `<div id="root">${bodyHtml}</div>`);
  if (replaced === shell) {
    throw new Error('generate-seo: shell has no empty <div id="root"></div> mount point');
  }
  return replaced;
}

function writeFile(rel: string, body: string | Buffer): void {
  const full = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function collectTags(): Map<string, Post[]> {
  const byTag = new Map<string, Post[]>();
  for (const p of posts) {
    const v = pickPrimaryVersion(p);
    for (const t of v.tags) {
      const list = byTag.get(t) ?? [];
      list.push(p);
      byTag.set(t, list);
    }
  }
  return byTag;
}

function maxEditedAt(list: Post[]): string {
  let max = "";
  for (const p of list) {
    const v = pickPrimaryVersion(p);
    if (v.edited_at > max) max = v.edited_at;
  }
  return max || new Date().toISOString();
}

// -- Homepage ---------------------------------------------------------------

function renderHome(shell: string): string {
  const topTags = [...collectTags().keys()].slice(0, 20);
  const head = renderHead({
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    canonicalPath: "/",
    ogType: "website",
    keywords: [...DEFAULT_KEYWORDS, ...topTags],
    jsonLd: homeJsonLd(posts),
  });
  return injectBody(injectHead(shell, head), renderHomeBody(posts));
}

// -- Per-post ---------------------------------------------------------------

function renderPost(shell: string, post: Post): string {
  const v = pickPrimaryVersion(post);
  // Per-post keywords: tags first (search anchors), then the post's
  // hand-authored synonym list (so crawlers see the full surface area
  // even though the React app handles the rendered prose), then a few
  // site-wide defaults. Deduped while preserving first-seen order.
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const k of [...v.tags, ...v.keywords, ...DEFAULT_KEYWORDS.slice(0, 3)]) {
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    keywords.push(k);
  }
  const head = renderHead({
    title: `${v.title} — ${SITE_NAME}`,
    description: v.summary,
    canonicalPath: `/posts/${post.slug}/`,
    ogType: "article",
    ogImagePath: postOgImagePath(post.slug),
    keywords,
    article: {
      publishedTime: v.date,
      modifiedTime: v.edited_at,
      tags: v.tags,
    },
    jsonLd: [postJsonLd(post), postBreadcrumbJsonLd(post)],
  });
  return injectBody(injectHead(shell, head), renderPostBody(posts, post.slug));
}

// -- Per-tag ----------------------------------------------------------------

function renderTag(shell: string, tag: string, tagPosts: Post[]): string {
  // Tag description stays under the 160-char Google truncation threshold —
  // earlier copy concatenated the full SITE_DESCRIPTION and always blew past.
  const count = tagPosts.length;
  const description =
    `${count} post${count === 1 ? "" : "s"} on ${SITE_NAME} tagged #${tag} — ` +
    `notes on AI, agents, and open source.`;
  const head = renderHead({
    title: `Posts tagged #${tag} — ${SITE_NAME}`,
    description,
    canonicalPath: `/tags/${encodeURIComponent(tag)}/`,
    ogType: "website",
    keywords: [tag, ...DEFAULT_KEYWORDS],
    jsonLd: [tagJsonLd(tag, tagPosts), tagBreadcrumbJsonLd(tag)],
  });
  return injectBody(injectHead(shell, head), renderTagBody(posts, tag));
}

// -- Tags index -------------------------------------------------------------

function renderTagsIndex(shell: string, tagCounts: { tag: string; count: number }[]): string {
  const head = renderHead({
    title: `All tags — ${SITE_NAME}`,
    description: `Every topic tag used across posts on ${SITE_NAME}.`,
    canonicalPath: `/tags/`,
    ogType: "website",
    keywords: [...DEFAULT_KEYWORDS, ...tagCounts.slice(0, 10).map((t) => t.tag)],
    jsonLd: [tagsIndexJsonLd(tagCounts), tagsIndexBreadcrumbJsonLd()],
  });
  return injectBody(injectHead(shell, head), renderTagsIndexBody(posts));
}

// -- About ------------------------------------------------------------------

function renderAbout(shell: string): string {
  const head = renderHead({
    title: `About — ${SITE_NAME}`,
    description: `About Niclas Lindstedt, who writes ${SITE_NAME}: AI, agents, and open source.`,
    canonicalPath: `/about/`,
    // `og:type=profile` (not "website") so Facebook / LinkedIn render the
    // about page as a person profile card with the author's name as the
    // primary entity. ProfilePage JSON-LD complements this on Google's side.
    ogType: "profile",
    keywords: ["about", "Niclas Lindstedt", ...DEFAULT_KEYWORDS.slice(0, 5)],
    jsonLd: [...aboutJsonLd(), aboutBreadcrumbJsonLd()],
  });
  return injectBody(injectHead(shell, head), renderAboutBody());
}

// -- 404 --------------------------------------------------------------------

// GitHub Pages serves /404.html when no static file matches, so this is what
// crawlers see for any URL not in the sitemap. Marked noindex so Google stops
// reading the SPA shell as a real page (without this, every guessed URL got a
// 200 + the homepage HTML, which leaks soft-404 signals onto the whole site).
function renderNotFound(shell: string): string {
  const head = renderHead({
    title: `Page not found — ${SITE_NAME}`,
    description: `The page you're looking for doesn't exist on ${SITE_NAME}.`,
    canonicalPath: "/",
    ogType: "website",
    robots: "noindex,follow",
  });
  return injectBody(injectHead(shell, head), renderNotFoundBody());
}

// -- llms.txt ---------------------------------------------------------------

// Lightweight, machine-readable site index for AI crawlers (per the
// llmstxt.org convention). Same role as sitemap.xml for search engines:
// declare what's here, in a format an LLM can ingest without rendering JS.
// Kept minimal — title, one-line description, post list with summaries,
// links to the about page and the author's homepage — so it stays valuable
// even when an agent has only a token-budget glance to spare.
function renderLlmsTxt(): string {
  const lines: string[] = [];
  lines.push(`# ${SITE_NAME}`);
  lines.push("");
  lines.push(`> ${SITE_DESCRIPTION}`);
  lines.push("");
  if (posts.length > 0) {
    lines.push("## Posts");
    for (const p of posts) {
      const v = pickPrimaryVersion(p);
      lines.push(`- [${v.title}](${absoluteUrl(`/posts/${p.slug}/`)}): ${v.summary}`);
    }
    lines.push("");
  }
  lines.push("## About");
  lines.push(`- [About](${absoluteUrl("/about/")}): About the author of ${SITE_NAME}.`);
  lines.push(`- [Author homepage](${AUTHOR.url}): CV, project portfolio, contact details.`);
  lines.push(
    `- [Source repository](https://github.com/niclaslindstedt/blog): The blog itself is open source.`,
  );
  lines.push("");
  return lines.join("\n");
}

// -- Sitemap ----------------------------------------------------------------

function renderSitemap(): string {
  const tags = collectTags();
  const urls: { loc: string; lastmod: string; changefreq: string; priority: string }[] = [];

  urls.push({
    loc: absoluteUrl("/"),
    lastmod: posts.length ? maxEditedAt(posts) : new Date().toISOString(),
    changefreq: "daily",
    priority: "1.0",
  });

  urls.push({
    loc: absoluteUrl("/about/"),
    lastmod: posts.length ? maxEditedAt(posts) : new Date().toISOString(),
    changefreq: "yearly",
    priority: "0.7",
  });

  for (const p of posts) {
    const v = pickPrimaryVersion(p);
    urls.push({
      loc: absoluteUrl(`/posts/${p.slug}/`),
      lastmod: v.edited_at,
      changefreq: "monthly",
      priority: "0.8",
    });
  }

  if (tags.size > 0) {
    const allPosts = [...tags.values()].flat();
    urls.push({
      loc: absoluteUrl(`/tags/`),
      lastmod: maxEditedAt(allPosts),
      changefreq: "daily",
      priority: "0.6",
    });
  }

  for (const [tag, list] of tags) {
    urls.push({
      loc: absoluteUrl(`/tags/${encodeURIComponent(tag)}/`),
      lastmod: maxEditedAt(list),
      changefreq: "daily",
      priority: "0.5",
    });
  }

  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// -- robots.txt -------------------------------------------------------------

function renderRobots(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl(SITEMAP_PATH)}\n`;
}

// -- Shared feed item -------------------------------------------------------

function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

// Per-post data needed by RSS, Atom, and JSON Feed, pre-rendered once. A
// single source of truth for "which posts are in the feed, and what do they
// look like" means a fix to escaping, date formatting, or URL shape lands in
// every feed at once. `bodyHtml` is the full post body rendered to plain
// HTML (no React component overrides) for full-content feed consumers; the
// XML-escaped variants are for RSS/Atom, the raw variants are for JSON Feed.
interface FeedItem {
  title: string;
  rawTitle: string;
  url: string;
  rawUrl: string;
  summary: string;
  rawSummary: string;
  authorName: string;
  authorUrl: string;
  publishedRfc822: string;
  publishedIso: string;
  updatedIso: string;
  categories: string[];
  rawCategories: string[];
  bodyHtml: string;
}

function feedItems(): FeedItem[] {
  return posts.slice(0, FEED_POST_LIMIT).map((p) => {
    const v = pickPrimaryVersion(p);
    const url = absoluteUrl(`/posts/${p.slug}/`);
    const bodyHtml = renderMarkdownToHtml(v.body);
    return {
      title: escapeXml(v.title),
      rawTitle: v.title,
      url: escapeXml(url),
      rawUrl: url,
      summary: escapeXml(v.summary),
      rawSummary: v.summary,
      authorName: escapeXml(AUTHOR.name),
      authorUrl: escapeXml(AUTHOR.url),
      publishedRfc822: escapeXml(rfc822(v.date)),
      publishedIso: escapeXml(v.date),
      updatedIso: escapeXml(v.edited_at),
      categories: v.tags.map((t) => escapeXml(t)),
      rawCategories: [...v.tags],
      bodyHtml,
    };
  });
}

// Wrap a chunk of HTML in CDATA for RSS `<content:encoded>` / Atom
// `<content type="html">`. CDATA terminates on the literal `]]>`, so split
// any such occurrence across two CDATA sections.
function cdata(html: string): string {
  return `<![CDATA[${html.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function feedUpdatedIso(items: FeedItem[]): string {
  if (items.length === 0) return new Date().toISOString();
  const latest = posts.slice(0, FEED_POST_LIMIT)[0];
  return pickPrimaryVersion(latest).edited_at;
}

// -- RSS 2.0 ----------------------------------------------------------------

function renderRss(): string {
  const items = feedItems();
  const lastBuild = escapeXml(rfc822(feedUpdatedIso(items)));

  // Full-content feed: `<description>` keeps the summary lede (feed readers
  // that don't render the full body still get a useful preview), while
  // `<content:encoded>` carries the post body as HTML wrapped in CDATA.
  // The `content:` namespace declaration on the <rss> root is what makes
  // this RFC-valid; readers that ignore the namespace fall back to
  // <description> automatically.
  const body = items
    .map((it) =>
      [
        "    <item>",
        `      <title>${it.title}</title>`,
        `      <link>${it.url}</link>`,
        `      <guid isPermaLink="true">${it.url}</guid>`,
        `      <pubDate>${it.publishedRfc822}</pubDate>`,
        `      <description>${it.summary}</description>`,
        `      <content:encoded>${cdata(it.bodyHtml)}</content:encoded>`,
        ...it.categories.map((c) => `      <category>${c}</category>`),
        `      <dc:creator>${it.authorName}</dc:creator>`,
        "    </item>",
      ].join("\n"),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(SITE_URL + "/")}</link>
    <atom:link href="${escapeXml(absoluteUrl(RSS_PATH))}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>${SITE_LANGUAGE}</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <generator>blog.niclaslindstedt.se</generator>
${body}
  </channel>
</rss>
`;
}

// -- Atom 1.0 ---------------------------------------------------------------

function renderAtom(): string {
  const items = feedItems();
  const updated = escapeXml(feedUpdatedIso(items));

  // Atom carries full content via `<content type="html">` with the body
  // CDATA-wrapped, alongside the summary lede. Same dual-channel pattern
  // as RSS: readers that prefer summaries take `<summary>`, readers that
  // render full posts take `<content>`.
  const body = items
    .map((it) =>
      [
        "  <entry>",
        `    <id>${it.url}</id>`,
        `    <title>${it.title}</title>`,
        `    <link rel="alternate" type="text/html" href="${it.url}" />`,
        `    <published>${it.publishedIso}</published>`,
        `    <updated>${it.updatedIso}</updated>`,
        `    <author><name>${it.authorName}</name><uri>${it.authorUrl}</uri></author>`,
        `    <summary type="text">${it.summary}</summary>`,
        `    <content type="html">${cdata(it.bodyHtml)}</content>`,
        ...it.categories.map((c) => `    <category term="${c}" />`),
        "  </entry>",
      ].join("\n"),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(SITE_URL + "/")}</id>
  <title>${escapeXml(SITE_NAME)}</title>
  <subtitle>${escapeXml(SITE_TAGLINE)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${escapeXml(absoluteUrl(ATOM_PATH))}" />
  <link rel="alternate" type="text/html" href="${escapeXml(SITE_URL + "/")}" />
  <updated>${updated}</updated>
  <author><name>${escapeXml(AUTHOR.name)}</name><uri>${escapeXml(AUTHOR.url)}</uri></author>
  <generator uri="${escapeXml(SITE_URL)}">blog.niclaslindstedt.se</generator>
${body}
</feed>
`;
}

// -- JSON Feed 1.1 ----------------------------------------------------------

// JSON Feed (https://www.jsonfeed.org/version/1.1/) is the modern feed
// format readers increasingly prefer — strict JSON beats hand-formatted XML
// for parser robustness, and full-content delivery via `content_html` is
// first-class instead of bolted on via a content-module extension.
function renderJsonFeed(): string {
  const items = feedItems();
  const data = {
    version: "https://jsonfeed.org/version/1.1",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    home_page_url: `${SITE_URL}/`,
    feed_url: absoluteUrl(JSON_FEED_PATH),
    language: SITE_LANGUAGE,
    authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
    items: items.map((it) => ({
      id: it.rawUrl,
      url: it.rawUrl,
      title: it.rawTitle,
      summary: it.rawSummary,
      content_html: it.bodyHtml,
      date_published: it.publishedIso,
      date_modified: it.updatedIso,
      tags: it.rawCategories,
      authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
    })),
  };
  return JSON.stringify(data, null, 2) + "\n";
}

// -- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const shell = readShell();
  const tags = collectTags();

  const home = renderHome(shell);
  writeFile("index.html", home);
  writeFile("404.html", renderNotFound(shell));
  writeFile(path.join("about", "index.html"), renderAbout(shell));

  for (const post of posts) {
    writeFile(path.join("posts", post.slug, "index.html"), renderPost(shell, post));
  }

  for (const [tag, tagPosts] of tags) {
    writeFile(path.join("tags", tag, "index.html"), renderTag(shell, tag, tagPosts));
  }

  const tagCounts = [...tags.entries()]
    .map(([tag, list]) => ({ tag, count: list.length }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  if (tagCounts.length > 0) {
    writeFile(path.join("tags", "index.html"), renderTagsIndex(shell, tagCounts));
  }

  // Per-post OG cards. Rendered serially because wawoff2 (inside ogImage.ts)
  // isn't re-entrant; with a 2-figure post count the sequential cost is
  // negligible, and serial output keeps the generator's log readable.
  for (const post of posts) {
    const png = await renderOgImage(post);
    writeFile(path.join("og", `${post.slug}.png`), png);
  }

  writeFile("sitemap.xml", renderSitemap());
  writeFile("robots.txt", renderRobots());
  writeFile("llms.txt", renderLlmsTxt());
  writeFile("feed.xml", renderRss());
  writeFile("feed.atom", renderAtom());
  writeFile("feed.json", renderJsonFeed());

  process.stderr.write(
    `generate-seo: wrote homepage + about + ${posts.length} post page(s) + ${tags.size} tag page(s) + tags index + ${posts.length} OG image(s), sitemap, robots, llms.txt, RSS + Atom + JSON feeds\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`generate-seo: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
