// Pure helpers for the build-time SEO generator: escaping, canonical URL
// resolution, <head> fragment assembly, and JSON-LD builders. Kept free of
// Node APIs and React so the functions are easy to reason about and the
// escaping can't silently regress.

import {
  AUTHOR,
  AUTHOR_SAME_AS,
  DEFAULT_OG_IMAGE,
  FEED_POST_LIMIT,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  ORGANIZATION,
  SITE_DESCRIPTION,
  SITE_LANGUAGE,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  absoluteUrl,
  postOgImagePath,
} from "../../src/seo/siteConfig.ts";

// Centralised Person + publisher entity builders. They read the optional
// AUTHOR / ORGANIZATION slots in siteConfig and emit fields only when the
// values are non-empty, so the JSON-LD stays clean today and automatically
// upgrades the moment the author drops a headshot URL or logo URL into the
// config. The Person uses the canonical `${SITE_URL}/#author` @id so Google
// dedupes the entity across every page that references it.
function authorPersonJsonLd(): Record<string, unknown> {
  const person: Record<string, unknown> = {
    "@type": "Person",
    "@id": `${SITE_URL}/#author`,
    name: AUTHOR.name,
    url: AUTHOR.url,
    sameAs: [...AUTHOR_SAME_AS],
  };
  if (AUTHOR.image) person.image = AUTHOR.image;
  if (AUTHOR.description) person.description = AUTHOR.description;
  if (AUTHOR.jobTitle) person.jobTitle = AUTHOR.jobTitle;
  return person;
}

function publisherJsonLd(): Record<string, unknown> {
  // Prefer an Organization publisher with a logo (Google's stated
  // recommendation for Article rich results) when ORGANIZATION.name and
  // ORGANIZATION.logo are both populated; otherwise fall back to the author
  // Person, which is the appropriate publisher for an indie blog.
  if (ORGANIZATION.name && ORGANIZATION.logo) {
    return {
      "@type": "Organization",
      name: ORGANIZATION.name,
      url: ORGANIZATION.url,
      logo: {
        "@type": "ImageObject",
        url: ORGANIZATION.logo,
      },
    };
  }
  return authorPersonJsonLd();
}
import type { Post, PostVersion } from "../../src/types.ts";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// XML escaping is the same core set, but we also strip control chars that XML
// 1.0 forbids — stray 0x00-0x08 / 0x0B / 0x0C / 0x0E-0x1F bytes from editor
// artefacts will otherwise break a strict RSS/Atom parser.
export function escapeXml(s: string): string {
  let stripped = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code !== 0xfffe && code !== 0xffff)
    ) {
      stripped += s[i];
    }
  }
  return stripped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Pick the audience version the generator should use for meta tags.
// Technical wins when both exist — matches the tie-break extract-posts.ts uses
// for the display-fallback title, so meta and UI don't disagree.
export function pickPrimaryVersion(post: Post): PostVersion {
  const v = post.versions.technical ?? post.versions["non-technical"];
  if (!v) throw new Error(`post ${post.slug} has no audience versions`);
  return v;
}

export interface HeadMeta {
  title: string;
  description: string;
  canonicalPath: string;
  ogType: "website" | "article" | "profile";
  ogImagePath?: string;
  keywords?: string[];
  article?: {
    publishedTime: string;
    modifiedTime: string;
    tags: string[];
  };
  jsonLd?: object | object[];
  // Override for the <meta name="robots"> directive. Defaults to the site-wide
  // "index,follow,max-image-preview:large". Set to "noindex,follow" on the
  // 404 page so Google doesn't index the SPA shell when a URL doesn't match.
  robots?: string;
}

function metaTag(attrs: Record<string, string | number | undefined>): string {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`);
  return `<meta ${parts.join(" ")} />`;
}

function linkTag(attrs: Record<string, string | undefined>): string {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`);
  return `<link ${parts.join(" ")} />`;
}

// Build the full <head> fragment for a single route. Returns the string we
// splice into the Vite-generated index.html before the closing </head>.
export function renderHead(meta: HeadMeta): string {
  const title = meta.title;
  const desc = meta.description;
  const canonical = absoluteUrl(meta.canonicalPath);
  const image = absoluteUrl(meta.ogImagePath ?? DEFAULT_OG_IMAGE);
  const keywords = meta.keywords?.length ? meta.keywords.join(", ") : undefined;

  const lines: string[] = [];
  lines.push(`<title>${escapeHtml(title)}</title>`);
  lines.push(metaTag({ name: "description", content: desc }));
  if (keywords) lines.push(metaTag({ name: "keywords", content: keywords }));
  lines.push(linkTag({ rel: "canonical", href: canonical }));
  lines.push(metaTag({ name: "author", content: AUTHOR.name }));
  lines.push(
    metaTag({ name: "robots", content: meta.robots ?? "index,follow,max-image-preview:large" }),
  );

  const imageAlt = `${SITE_NAME} — ${SITE_TAGLINE}`;
  lines.push(metaTag({ property: "og:site_name", content: SITE_NAME }));
  lines.push(metaTag({ property: "og:locale", content: "en_US" }));
  lines.push(metaTag({ property: "og:type", content: meta.ogType }));
  lines.push(metaTag({ property: "og:title", content: title }));
  lines.push(metaTag({ property: "og:description", content: desc }));
  lines.push(metaTag({ property: "og:url", content: canonical }));
  lines.push(metaTag({ property: "og:image", content: image }));
  lines.push(metaTag({ property: "og:image:width", content: OG_IMAGE_WIDTH }));
  lines.push(metaTag({ property: "og:image:height", content: OG_IMAGE_HEIGHT }));
  lines.push(metaTag({ property: "og:image:alt", content: imageAlt }));

  if (meta.article) {
    lines.push(
      metaTag({ property: "article:published_time", content: meta.article.publishedTime }),
    );
    lines.push(metaTag({ property: "article:modified_time", content: meta.article.modifiedTime }));
    lines.push(metaTag({ property: "article:author", content: AUTHOR.url }));
    for (const tag of meta.article.tags) {
      lines.push(metaTag({ property: "article:tag", content: tag }));
    }
  }

  // og:type=profile expects the author's first/last name as separate fields
  // so Facebook / LinkedIn render the page as a person card rather than a
  // generic website card. Splits AUTHOR.name on whitespace — works for the
  // current "Niclas Lindstedt" and any reasonable bi-/tri-partite name.
  if (meta.ogType === "profile") {
    const parts = AUTHOR.name.split(/\s+/);
    const first = parts.shift() ?? AUTHOR.name;
    const last = parts.join(" ");
    lines.push(metaTag({ property: "profile:first_name", content: first }));
    if (last) lines.push(metaTag({ property: "profile:last_name", content: last }));
  }

  lines.push(metaTag({ name: "twitter:card", content: "summary_large_image" }));
  lines.push(metaTag({ name: "twitter:title", content: title }));
  lines.push(metaTag({ name: "twitter:description", content: desc }));
  lines.push(metaTag({ name: "twitter:image", content: image }));
  // twitter:image:alt mirrors og:image:alt — Twitter cards have their own
  // alt attribute that doesn't fall back to the OG one, so a screen-reader
  // user on Twitter sees "Image" otherwise.
  lines.push(metaTag({ name: "twitter:image:alt", content: imageAlt }));

  // Feed/sitemap discovery links are emitted once by the shell in
  // website/index.html — they're site-wide constants, so re-emitting them per
  // route just bloats the output.

  if (meta.jsonLd) {
    const payload = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    for (const item of payload) {
      const json = JSON.stringify(item).replace(/</g, "\\u003c");
      lines.push(`<script type="application/ld+json">${json}</script>`);
    }
  }

  return lines.map((l) => `    ${l}`).join("\n");
}

export function homeJsonLd(posts: Post[]): object[] {
  const person = {
    "@context": "https://schema.org",
    ...authorPersonJsonLd(),
  };
  // No `potentialAction` SearchAction here: the in-page search modal is
  // keyboard-driven (Cmd-K) and has no URL representation, so advertising a
  // search endpoint to Google would point it at a URL the SPA doesn't route.
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: `${SITE_URL}/`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: SITE_LANGUAGE,
    publisher: { "@id": `${SITE_URL}/#author` },
  };
  const blog = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}/#blog`,
    url: `${SITE_URL}/`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: SITE_LANGUAGE,
    author: { "@id": `${SITE_URL}/#author` },
    publisher: { "@id": `${SITE_URL}/#author` },
    blogPost: posts.slice(0, FEED_POST_LIMIT).map((p) => {
      const v = pickPrimaryVersion(p);
      return {
        "@type": "BlogPosting",
        headline: v.title,
        url: absoluteUrl(`/posts/${p.slug}/`),
        datePublished: v.date,
        dateModified: v.edited_at,
        description: v.summary,
        keywords: v.tags.join(", "),
      };
    }),
  };
  return [person, website, blog];
}

export function postJsonLd(post: Post): object {
  const v = pickPrimaryVersion(post);
  const url = absoluteUrl(`/posts/${post.slug}/`);
  // `image` as an ImageObject with explicit width/height (rather than a bare
  // URL string) is what Google's article-rich-results docs recommend — the
  // dimensions let it size the card without a probe request, and `>=1200px
  // wide` is required for the larger article surfaces.
  const image = {
    "@type": "ImageObject",
    url: absoluteUrl(postOgImagePath(post.slug)),
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
  };
  // Author reuses the canonical Person @id the homepage exposes, so Google
  // dedupes the entity across pages. `publisher` prefers the configured
  // Organization (with logo) when both name+logo are set in siteConfig,
  // otherwise falls back to the author Person — see publisherJsonLd().
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#post`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    headline: v.title,
    description: v.summary,
    datePublished: v.date,
    dateModified: v.edited_at,
    inLanguage: SITE_LANGUAGE,
    wordCount: v.wordCount,
    keywords: [...new Set([...v.tags, ...v.keywords])].join(", "),
    articleSection: v.tags,
    author: authorPersonJsonLd(),
    publisher: publisherJsonLd(),
    image,
  };
}

export function tagJsonLd(tag: string, posts: Post[]): object {
  const url = absoluteUrl(`/tags/${encodeURIComponent(tag)}/`);
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    url,
    name: `Posts tagged #${tag}`,
    description: `${SITE_NAME} posts tagged #${tag}.`,
    inLanguage: SITE_LANGUAGE,
    about: tag,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    hasPart: posts.map((p) => {
      const v = pickPrimaryVersion(p);
      return {
        "@type": "BlogPosting",
        headline: v.title,
        url: absoluteUrl(`/posts/${p.slug}/`),
        datePublished: v.date,
        dateModified: v.edited_at,
        description: v.summary,
      };
    }),
  };
}

// Breadcrumb trail for a single post: Home › #<primary-tag> › <title>. Posts
// without tags get a two-item trail (Home › Title) so the BreadcrumbList is
// always valid — single-element lists are rejected by Google's validator.
export function postBreadcrumbJsonLd(post: Post): object {
  const v = pickPrimaryVersion(post);
  const items: { "@type": "ListItem"; position: number; name: string; item: string }[] = [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
  ];
  const primaryTag = v.tags[0];
  if (primaryTag) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: `#${primaryTag}`,
      item: absoluteUrl(`/tags/${encodeURIComponent(primaryTag)}/`),
    });
  }
  items.push({
    "@type": "ListItem",
    position: items.length + 1,
    name: v.title,
    item: absoluteUrl(`/posts/${post.slug}/`),
  });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

// Breadcrumb for the all-tags index page: Home › Tags.
// /about: ProfilePage wrapping the same Person entity the homepage exposes.
// Linking via the canonical `#author` @id (rather than inlining a new Person
// object) means Google's Knowledge Graph treats the homepage Person and the
// about-page Person as one entity, with the about page as the authoritative
// profile surface.
export function aboutJsonLd(): object[] {
  const profile = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${SITE_URL}/about/#profile`,
    url: `${SITE_URL}/about/`,
    name: `About — ${SITE_NAME}`,
    inLanguage: SITE_LANGUAGE,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    mainEntity: { "@id": `${SITE_URL}/#author` },
  };
  const person = {
    "@context": "https://schema.org",
    ...authorPersonJsonLd(),
  };
  return [profile, person];
}

export function aboutBreadcrumbJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "About", item: `${SITE_URL}/about/` },
    ],
  };
}

// Breadcrumb for an individual tag page: Home › Tags › #<tag>. Post pages
// already get a Home › #<tag> › Title trail, but tag pages had no breadcrumb
// of their own — so Google had no structured `back to tags` signal to render
// in tag-page SERP entries.
export function tagBreadcrumbJsonLd(tag: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Tags", item: `${SITE_URL}/tags/` },
      {
        "@type": "ListItem",
        position: 3,
        name: `#${tag}`,
        item: absoluteUrl(`/tags/${encodeURIComponent(tag)}/`),
      },
    ],
  };
}

export function tagsIndexBreadcrumbJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Tags", item: `${SITE_URL}/tags/` },
    ],
  };
}

// CollectionPage listing every tag with its post count — powers /tags/.
export function tagsIndexJsonLd(tagCounts: { tag: string; count: number }[]): object {
  const url = `${SITE_URL}/tags/`;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    url,
    name: `All tags — ${SITE_NAME}`,
    description: `Every topic tag used across posts on ${SITE_NAME}.`,
    inLanguage: SITE_LANGUAGE,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    hasPart: tagCounts.map((t) => ({
      "@type": "CollectionPage",
      name: `#${t.tag}`,
      url: absoluteUrl(`/tags/${encodeURIComponent(t.tag)}/`),
    })),
  };
}
