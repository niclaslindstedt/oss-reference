// Single source of truth for every copy string and URL that appears in <title>,
// meta descriptions, Open Graph / Twitter tags, JSON-LD, robots.txt, the RSS
// and Atom feeds, and the sitemap. Both the client (via Helmet) and the
// post-build `generate-seo.ts` script import from here, so tweaking the site's
// pitch is a one-file change.

export const SITE_URL = "https://blog.niclaslindstedt.se";

export const SITE_NAME = "Niclas Lindstedt's blog";
export const SITE_SHORT_NAME = "niclaslindstedt";

export const SITE_TAGLINE = "AI, agents, and open source";

export const SITE_DESCRIPTION =
  "Writing about AI, agents, and open source — hands-on notes from building tools like zag, zad, ztf, zig, and oss-spec.";

export const SITE_LANGUAGE = "en";

export const AUTHOR = {
  name: "Niclas Lindstedt",
  url: "https://niclaslindstedt.se",
  github: "https://github.com/niclaslindstedt",
  linkedin: "https://www.linkedin.com/in/niclaslindstedt/",
  dockerhub: "https://hub.docker.com/u/niclaslindstedt",
  pypi: "https://pypi.org/user/niclaslindstedt/",
  cratesio: "https://crates.io/users/niclaslindstedt",

  // -- Optional Knowledge-Graph richness slots --
  //
  // Empty strings here are skipped by the JSON-LD builders so the schema
  // stays clean. Fill them in to upgrade the author entity Google sees:
  //
  // `image`       Absolute URL to a square headshot. Surfaces in Google's
  //               author-byline card on article rich results, and in the
  //               Knowledge Graph entry for the author.
  // `description` One- or two-sentence bio. Shown in some Knowledge-Graph
  //               surfaces and on the about page's ProfilePage entity.
  // `jobTitle`    Short title, e.g. "Software engineer". Surfaces in
  //               Knowledge Graph and on LinkedIn-style profile cards.
  //
  // Wired through `homePersonJsonLd()` and `postJsonLd()` in
  // scripts/seo/meta.ts — both functions emit the field only when the value
  // is non-empty, so dropping a real URL/string in here is the entire fix
  // for that line item.
  image: "",
  description: "",
  jobTitle: "",
} as const;

// -- Optional publisher Organization --
//
// Google's article-rich-results docs prefer `publisher` to be an
// Organization with a logo ImageObject (>=112×112) over a bare Person.
// When `name` and `logo` are both filled in, `postJsonLd()` emits the
// publisher as an Organization; otherwise it falls back to the author
// Person — which is acceptable for an indie blog but lower-priority for
// the article-card surfaces. Both values are absolute strings.
export const ORGANIZATION = {
  name: "",
  url: SITE_URL,
  logo: "",
} as const;

// External identities tied to AUTHOR — emitted as `sameAs` in the homepage
// Person JSON-LD so Google's Knowledge Graph can link the site to the author.
export const AUTHOR_SAME_AS: readonly string[] = [
  AUTHOR.github,
  AUTHOR.linkedin,
  AUTHOR.dockerhub,
  AUTHOR.pypi,
  AUTHOR.cratesio,
];

export const DEFAULT_OG_IMAGE = "/og-default.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

// Directory (under dist/) where per-post OG cards are written. Kept as a
// constant so the generator's output path and <meta og:image> values can't
// drift apart.
export const OG_IMAGE_DIR = "/og";
export function postOgImagePath(slug: string): string {
  return `${OG_IMAGE_DIR}/${slug}.png`;
}

// Broad topic keywords that always describe the site, independent of which
// posts exist. The generator merges these with the union of every post's tags
// for the homepage and with a post's own tags for each post page.
export const DEFAULT_KEYWORDS: readonly string[] = [
  "AI",
  "agents",
  "open source",
  "developer tools",
  "Claude",
  "Rust",
  "TypeScript",
  "Niclas Lindstedt",
];

// Feed filenames — kept as constants so <link rel="alternate"> URLs and the
// generator's output paths can't drift.
export const RSS_PATH = "/feed.xml";
export const ATOM_PATH = "/feed.atom";
export const JSON_FEED_PATH = "/feed.json";
export const SITEMAP_PATH = "/sitemap.xml";

// Number of posts to include in the RSS/Atom feed and in the homepage JSON-LD.
export const FEED_POST_LIMIT = 20;

export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = SITE_URL.replace(/\/$/, "");
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}
