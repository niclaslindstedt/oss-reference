import { expect, test, type Page } from "@playwright/test";

// SC 1.4.10 Reflow (AA) — content must be usable at 320×256 CSS px without
// horizontal scrolling on the document. Two-dimensional content (the
// timeline canvas) is exempt and lives behind its own scroll container.
//
// Local-only by design — see verify-wcag SKILL.md and Makefile
// `test-a11y-manual`. Not gated in CI.

test.use({ viewport: { width: 320, height: 256 } });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForLoadState("networkidle");
}

test.describe("SC 1.4.10 Reflow @ 320×256", () => {
  for (const lang of ["en", "sv"] as const) {
    test(`home page has no document horizontal scroll (${lang})`, async ({
      page,
    }) => {
      await page.goto(`/?lang=${lang}`);
      await settle(page);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // Allow 1px tolerance for sub-pixel rounding; anything larger means
      // a fixed-width child is forcing the document wider than the viewport.
      expect(
        overflow.scrollWidth,
        `document scrollWidth (${overflow.scrollWidth}) exceeds clientWidth (${overflow.clientWidth}) at 320 CSS px`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }
});
