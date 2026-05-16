import { expect, test, type Page } from "@playwright/test";

// SC 2.4.11 Focus Not Obscured (Minimum, AA, WCAG 2.2) — when an element
// receives focus, it must not be entirely hidden by author-created
// content (sticky header, floating controls, modal scrim, etc). Partial
// obscurity is allowed at the Minimum level.
//
// Strategy: tab through the page, and for each focused element sample
// nine points across its bounding rect with `document.elementFromPoint`.
// If none of those points return the focused element (or one of its
// descendants), it is fully obscured — a violation.
//
// Local-only by design — see verify-wcag SKILL.md and Makefile
// `test-a11y-manual`. Not gated in CI; long-running and slightly flaky.

const MAX_TABS = 80;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForLoadState("networkidle");
}

type FocusProbe =
  | { kind: "stop" }
  | { kind: "skipped" }
  | {
      kind: "checked";
      tag: string;
      visiblePoints: number;
      rect: { x: number; y: number; w: number; h: number };
    };

async function probeFocus(page: Page): Promise<FocusProbe> {
  return await page.evaluate<FocusProbe>(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { kind: "stop" } as const;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0)
      return { kind: "skipped" } as const;

    const xs = [rect.left + 1, rect.left + rect.width / 2, rect.right - 1];
    const ys = [rect.top + 1, rect.top + rect.height / 2, rect.bottom - 1];

    let visiblePoints = 0;
    for (const x of xs) {
      for (const y of ys) {
        if (x < 0 || y < 0) continue;
        if (x > window.innerWidth || y > window.innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (!top) continue;
        if (top === el || el.contains(top) || top.contains(el)) {
          visiblePoints++;
        }
      }
    }

    return {
      kind: "checked" as const,
      tag: `${el.tagName}${el.id ? `#${el.id}` : ""}`,
      visiblePoints,
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    };
  });
}

for (const viewport of [
  { name: "desktop-short", width: 1280, height: 600 },
  { name: "mobile", width: 390, height: 600 },
] as const) {
  test.describe(`SC 2.4.11 Focus Not Obscured @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const lang of ["en", "sv"] as const) {
      test(`focused elements stay at least partially visible (${lang})`, async ({
        page,
      }) => {
        // Collapse CSS transitions so we read the resting focus position
        // (the skip-link slides in over 120ms; without this we'd race
        // the transition and read a transient off-screen rect).
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`/?lang=${lang}`);
        await settle(page);
        await page.evaluate(() => window.focus());

        const violations: { index: number; tag: string; rect: unknown }[] = [];
        let lastTag = "";
        let repeats = 0;

        for (let i = 0; i < MAX_TABS; i++) {
          await page.keyboard.press("Tab");
          const probe = await probeFocus(page);
          if (probe.kind === "stop") break;
          if (probe.kind === "skipped") continue;

          if (probe.tag === lastTag) {
            repeats++;
            if (repeats > 2) break;
          } else {
            repeats = 0;
            lastTag = probe.tag;
          }

          if (probe.visiblePoints === 0) {
            violations.push({ index: i, tag: probe.tag, rect: probe.rect });
          }
        }

        expect(
          violations,
          `fully-obscured focused elements at ${viewport.name} / ${lang}:\n${JSON.stringify(violations, null, 2)}`,
        ).toEqual([]);
      });
    }
  });
}
