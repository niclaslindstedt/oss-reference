import { expect, test, type Page } from "@playwright/test";

// SC 1.4.4 Resize Text (AA) — text scaled to 200% must not cause loss of
// content or function. We approximate the manual check by setting the
// root font-size to 32px (2× the 16px default) on a desktop viewport and
// asserting that the document does not require horizontal scrolling.
//
// Local-only by design — see verify-wcag SKILL.md and Makefile
// `test-a11y-manual`. Not gated in CI.

test.use({ viewport: { width: 1280, height: 800 } });

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForLoadState("networkidle");
}

test.describe("SC 1.4.4 Resize Text 200%", () => {
  for (const lang of ["en", "sv"] as const) {
    test(`no document horizontal scroll at 200% root font (${lang})`, async ({
      page,
    }) => {
      await page.goto(`/?lang=${lang}`);
      await settle(page);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      await settle(page);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        overflow.scrollWidth,
        `document scrollWidth (${overflow.scrollWidth}) exceeds clientWidth (${overflow.clientWidth}) at 200% root font`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test(`landmark headings are not clipped at 200% root font (${lang})`, async ({
      page,
    }) => {
      await page.goto(`/?lang=${lang}`);
      await settle(page);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      await settle(page);

      const clipped = await page.evaluate(() => {
        const offenders: {
          selector: string;
          scrollWidth: number;
          clientWidth: number;
        }[] = [];
        const walk = document.querySelectorAll<HTMLElement>("h1, h2, h3");
        walk.forEach((el) => {
          const style = getComputedStyle(el);
          if (style.textOverflow === "ellipsis") return;
          const overflowHidden =
            style.overflow === "hidden" || style.overflowX === "hidden";
          if (!overflowHidden) return;
          if (el.scrollWidth > el.clientWidth + 1) {
            offenders.push({
              selector: `${el.tagName}.${typeof el.className === "string" ? el.className.split(" ").join(".") : ""}`,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
            });
          }
        });
        return offenders;
      });

      expect(
        clipped,
        `headings clipped by overflow:hidden at 200% root font:\n${JSON.stringify(clipped, null, 2)}`,
      ).toEqual([]);
    });
  }
});
