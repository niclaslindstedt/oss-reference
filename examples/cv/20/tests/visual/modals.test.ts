import { expect, test, type Locator, type Page } from "@playwright/test";

// Freeze time so the footer year and any "since" / "X years"
// computations stay deterministic across CI runs.
const FIXED_TIME = "2026-04-27T12:00:00Z";

// `backdrop-filter: blur(...)` takes a different rendering path under CI's
// headless compositor than under a desktop GPU, producing 2–12% pixel drift
// on modal snapshots even when the underlying layout is pixel-identical.
// Disable it during snapshots so the captured image is deterministic across
// the local Linux + CI ubuntu-latest pair. Visual regression of the blur
// itself is not what these tests are checking — they're checking modal
// content, layout, and category tinting.
const STABILIZE_CSS = `
  *, *::before, *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
    animation-delay: 0ms !important;
    scroll-behavior: auto !important;
    caret-color: transparent !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  /* The CelestialSky canvas paints on RAF — hide it for stable pixels. */
  .celestial-sky, canvas { visibility: hidden !important; }
`;

async function preparePage(page: Page) {
  await page.clock.install({ time: new Date(FIXED_TIME) });
  // Emulate reduced motion so JS-driven entry animations (e.g. the ECTS
  // power-bar count-up) snap to their final state instead of rendering
  // mid-tween — the page.clock above freezes RAF, which would otherwise
  // capture the pre-animation frame.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({ content: STABILIZE_CSS });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(50);
}

async function openHome(page: Page) {
  await page.goto("/?lang=en");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await preparePage(page);
}

async function snapshotModal(page: Page, locator: Locator, name: string) {
  await expect(locator).toBeVisible();
  // Move the pointer off-page so no element shows a hover state.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(50);
  await expect(locator).toHaveScreenshot(name);
}

test.describe("modals", () => {
  test("summary modal — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator(".hero-summary").click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-summary-en-dark.png",
    );
  });

  test("search modal (empty) — en / dark", async ({ page }) => {
    await openHome(page);
    await page.keyboard.press("/");
    // Blur the input so the caret doesn't blink across snapshot runs.
    await page.locator(".search-modal-input").evaluate((el) => {
      (el as HTMLInputElement).blur();
    });
    await snapshotModal(
      page,
      page.locator(".search-modal-overlay"),
      "modal-search-empty-en-dark.png",
    );
  });

  test("search modal (results) — en / dark", async ({ page }) => {
    await openHome(page);
    await page.keyboard.press("/");
    await page.locator(".search-modal-input").fill("react");
    // Wait for the deferred result list to render.
    await expect(page.locator(".search-result").first()).toBeVisible();
    await page.locator(".search-modal-input").evaluate((el) => {
      (el as HTMLInputElement).blur();
    });
    await snapshotModal(
      page,
      page.locator(".search-modal-overlay"),
      "modal-search-results-en-dark.png",
    );
  });

  test("skill modal — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator("#projects .project-stack-btn").first().click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-skill-en-dark.png",
    );
  });

  test("focus modal — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator(".focus-item-btn").first().click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-focus-en-dark.png",
    );
  });

  test("project modal — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator(".project-name-btn").first().click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-project-en-dark.png",
    );
  });

  test("company modal — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator("#experience .company.company-btn").first().click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-company-en-dark.png",
    );
  });

  test("program courses modal (bachelor) — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator("#education .education-program-btn").first().click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-program-bachelor-en-dark.png",
    );
  });

  test("program courses modal (medicine) — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator("#education .education-program-btn").nth(1).click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-program-medicine-en-dark.png",
    );
  });

  test("course modules modal — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator("#courses .education-program-btn").first().click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-course-en-dark.png",
    );
  });

  test("ects modal (bachelor program) — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator("#education .education-program-btn").first().click();
    // First pill in the program modal is the program-level ECTS pill,
    // which opens the EctsModal with kind: "program".
    await page.locator(".skill-modal-overlay .ects-pill").first().click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay", {
        has: page.locator(".ects-modal"),
      }),
      "modal-ects-program-bachelor-en-dark.png",
    );
  });

  test("ects modal (medical program) — en / dark", async ({ page }) => {
    await openHome(page);
    // The medical program exercises the 11-semester power bar (330 ECTS).
    await page.locator("#education .education-program-btn").nth(1).click();
    await page.locator(".skill-modal-overlay .ects-pill").first().click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay", {
        has: page.locator(".ects-modal"),
      }),
      "modal-ects-program-medicine-en-dark.png",
    );
  });

  test("ects modal (course) — en / dark", async ({ page }) => {
    await openHome(page);
    await page.locator("#education .education-program-btn").first().click();
    // A pill inside a course row resolves to kind: "course" — pick the
    // first one inside .program-course-meta to skip the program-level pill.
    await page
      .locator(".skill-modal-overlay .program-course-meta .ects-pill")
      .first()
      .click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay", {
        has: page.locator(".ects-modal"),
      }),
      "modal-ects-course-en-dark.png",
    );
  });

  test("experience modal — en / dark", async ({ page }) => {
    await openHome(page);
    await page.keyboard.press("/");
    // Type a query that matches an experience entry; pick the experience hit.
    await page.locator(".search-modal-input").fill("BookBeat");
    const experienceResult = page
      .locator(".search-result-button", {
        has: page.locator(".search-result-kind", { hasText: "Experience" }),
      })
      .first();
    await expect(experienceResult).toBeVisible();
    await experienceResult.click();
    await snapshotModal(
      page,
      page.locator(".skill-modal-overlay"),
      "modal-experience-en-dark.png",
    );
  });
});

test.describe("timeline page", () => {
  test("timeline — en / dark", async ({ page }) => {
    await page.goto("/timeline?lang=en");
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await preparePage(page);
    const root = page.locator(".timeline-vis-page");
    await expect(root).toBeVisible();
    // Wait for layout to settle (Timeline schedules a couple of RAF passes
    // for initial scroll positioning).
    await page.waitForTimeout(150);
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot("timeline-en-dark.png", {
      fullPage: false,
    });
  });
});
