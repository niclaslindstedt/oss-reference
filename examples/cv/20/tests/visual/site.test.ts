import { expect, test, type Page } from "@playwright/test";

// Freeze time so the footer year ("© <year> Name") and any "since" /
// "X years" computations stay deterministic across CI runs.
const FIXED_TIME = "2026-04-27T12:00:00Z";

const STABILIZE_CSS = `
  *, *::before, *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
    animation-delay: 0ms !important;
    scroll-behavior: auto !important;
  }
  /* The CelestialSky canvas paints on RAF — hide it for stable pixels. */
  .celestial-sky, canvas { visibility: hidden !important; }
`;

// Element-screenshots of tall sections force Playwright to scroll and stitch;
// fixed-position UI then appears in different positions between stability
// re-shots. Hide it for section snapshots so the comparison stays stable.
// Also neutralise UI that depends on the project-stats / github-activity
// caches — those are rebuilt from live GitHub data when a token is present
// (CI) but stay empty otherwise (local sandbox without a token), so anything
// they drive would diverge between environments.
const SECTION_OVERLAY_CSS = `
  .skip-link, .floating-controls { display: none !important; }
  .project-dates { display: none !important; }
  .project.is-active {
    border-color: var(--card-border) !important;
    box-shadow: none !important;
  }
`;

async function preparePage(page: Page) {
  await page.clock.install({ time: new Date(FIXED_TIME) });
  await page.addStyleTag({ content: STABILIZE_CSS });
  await page.evaluate(() => document.fonts?.ready);
  // Settle one frame so any RAF-scheduled layout finishes.
  await page.waitForTimeout(50);
}

test.describe("homepage layout", () => {
  for (const lang of ["en", "sv"] as const) {
    for (const theme of ["dark", "light"] as const) {
      test(`hero — ${lang} / ${theme}`, async ({ page }) => {
        await page.goto(`/?lang=${lang}`);
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, theme);
        await preparePage(page);
        const hero = page.locator(".hero").first();
        await expect(hero).toBeVisible();
        await expect(hero).toHaveScreenshot(`hero-${lang}-${theme}.png`);
      });
    }
  }

  const CATEGORY_SECTIONS = [
    "focus",
    "projects",
    "experience",
    "education",
    "courses",
    "skills",
    "languages",
  ] as const;

  for (const id of CATEGORY_SECTIONS) {
    test(`${id} section — en / dark`, async ({ page }) => {
      await page.goto("/?lang=en");
      await preparePage(page);
      await page.addStyleTag({ content: SECTION_OVERLAY_CSS });
      const section = page.locator(`#${id}`).first();
      await expect(section).toBeVisible();
      // Scroll into view and let RAF-driven glass reflections settle so the
      // section's gradient values stop changing between stability re-shots.
      await section.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await expect(section).toHaveScreenshot(`${id}-en-dark.png`);
    });
  }

  test("full page — en / dark (above the fold)", async ({ page }) => {
    await page.goto("/?lang=en");
    await preparePage(page);
    await expect(page).toHaveScreenshot("homepage-en-dark.png", {
      fullPage: false,
    });
  });
});
