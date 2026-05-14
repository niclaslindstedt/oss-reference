// Build-time renderer for per-post OG card images. Uses satori to lay out a
// VNode tree as SVG, then resvg to rasterize to PNG. Pure Node — no Chromium,
// no GPU — so it runs cleanly in the GitHub-Pages build runner.
//
// The card is code-only: dark background, accent bar, site name, title,
// date + reading time, and up to five tags. No bitmaps or design assets.

import fs from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
// @ts-expect-error — wawoff2 ships no types; the decompress signature is stable.
import wawoff from "wawoff2";
import type { Post } from "../../src/types.ts";
import { SITE_NAME, SITE_TAGLINE } from "../../src/seo/siteConfig.ts";
import { pickPrimaryVersion } from "./meta.ts";

const WIDTH = 1200;
const HEIGHT = 630;
const BG = "#0a0e14";
const ACCENT = "#4b9cd3";
const FG_BRIGHT = "#ffffff";
const FG_DIM = "#a0aec0";

// satori's bundled opentype.js can't parse WOFF2, so we read the Inter
// WOFF2 from @fontsource/inter and decompress it to raw sfnt (TTF) bytes at
// module load. Done once per build — the fonts are tiny (latin subset).
const FONTS_DIR = path.resolve("node_modules", "@fontsource", "inter", "files");
async function loadTtf(file: string): Promise<Buffer> {
  const woff2 = fs.readFileSync(path.join(FONTS_DIR, file));
  const ttf = (await wawoff.decompress(woff2)) as Uint8Array;
  return Buffer.from(ttf);
}
// Sequenced, not Promise.all'd — wawoff2's WASM module shares heap state
// and concurrent decompress calls produce corrupt output.
const interRegular = await loadTtf("inter-latin-400-normal.woff2");
const interBold = await loadTtf("inter-latin-700-normal.woff2");

interface VNode {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: VNode | VNode[] | string | number | (VNode | string | number)[];
  };
}

function text(value: string, style: Record<string, string | number>): VNode {
  return { type: "div", props: { style, children: value } };
}

function template(post: Post): VNode {
  const v = pickPrimaryVersion(post);
  const dateLabel = v.date.slice(0, 10);
  const tagLabel = v.tags
    .slice(0, 5)
    .map((t) => `#${t}`)
    .join("  ");

  return {
    type: "div",
    props: {
      style: {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: "flex",
        flexDirection: "row",
        backgroundColor: BG,
        fontFamily: "Inter",
        color: FG_BRIGHT,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              width: "12px",
              height: "100%",
              backgroundColor: ACCENT,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "72px 80px",
            },
            children: [
              text(SITE_NAME, {
                fontSize: "24px",
                color: FG_DIM,
                fontWeight: 400,
                letterSpacing: "0.02em",
              }),
              text(v.title, {
                fontSize: v.title.length > 60 ? "54px" : "68px",
                fontWeight: 700,
                lineHeight: 1.12,
                color: FG_BRIGHT,
              }),
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  },
                  children: [
                    text(`${dateLabel}  ·  ${v.readingTimeMinutes} min read`, {
                      fontSize: "22px",
                      color: FG_DIM,
                      fontWeight: 400,
                    }),
                    ...(tagLabel
                      ? [
                          text(tagLabel, {
                            fontSize: "22px",
                            color: ACCENT,
                            fontWeight: 700,
                          }),
                        ]
                      : []),
                    text(SITE_TAGLINE, {
                      fontSize: "20px",
                      color: FG_DIM,
                      fontWeight: 400,
                      marginTop: "12px",
                    }),
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export async function renderOgImage(post: Post): Promise<Buffer> {
  // satori's public type is `ReactNode`; it also walks VNode objects at
  // runtime. The cast avoids a JSX/React dep in this server-only file.
  const svg = await satori(template(post) as unknown as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: "Inter", data: interRegular, weight: 400, style: "normal" },
      { name: "Inter", data: interBold, weight: 700, style: "normal" },
    ],
  });
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}
