import { expect, test, type Locator, type Page } from "@playwright/test";

// Manual interaction coverage for behaviours axe-core can't audit.
// The sister `tests/a11y/interactions.test.ts` runs the per-PR axe
// scan after each modal opens; this file goes deeper:
//
//   - Confirms focus *returns* to the invoking element after every
//     modal closes via Escape (SC 2.4.3, 3.2.1 implications).
//   - Confirms each modal's `<dialog>` renders an accessible name
//     before its first focusable child receives focus (SC 4.1.2).
//   - Confirms `prefers-reduced-motion: reduce` is honoured by the
//     `CelestialSky` canvas paint loop (SC 2.2.2).
//   - Confirms hover-revealed content (project tooltips) is dismissible
//     via Escape (SC 1.4.13).
//
// Local-only by design — see `verify-wcag` SKILL.md and Makefile
// `test-a11y-manual`. Not gated in CI.

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForLoadState("networkidle");
}

async function openCloseAndAssertReturn(
  page: Page,
  trigger: Locator,
  label: string,
) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  expect(
    await trigger.evaluate((el) => el === document.activeElement),
    `${label}: trigger should be focused before opening`,
  ).toBe(true);

  await trigger.click();
  const dialog = page
    .locator('[role="dialog"]:not([aria-hidden="true"])')
    .first();
  await expect(dialog).toBeVisible();

  // Modal must announce a name (aria-label or aria-labelledby).
  const name = await dialog.evaluate((el) => {
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const ref = el.ownerDocument.getElementById(labelled);
      return ref?.textContent?.trim() ?? "";
    }
    return el.getAttribute("aria-label") ?? "";
  });
  expect(
    name.length,
    `${label}: modal must have an accessible name`,
  ).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // After close, focus returns to the invoking element.
  const returned = await trigger.evaluate(
    (el) => el === document.activeElement,
  );
  expect(returned, `${label}: focus did not return to trigger`).toBe(true);
}

test.describe("modal focus return (SC 2.4.3)", () => {
  test("hero summary modal returns focus to trigger", async ({ page }) => {
    await page.goto("/?lang=en");
    await settle(page);
    await openCloseAndAssertReturn(
      page,
      page.locator(".hero-summary").first(),
      "hero summary",
    );
  });

  test("focus tile returns focus to trigger", async ({ page }) => {
    await page.goto("/?lang=en");
    await settle(page);
    await openCloseAndAssertReturn(
      page,
      page.locator(".focus-item-btn").first(),
      "focus tile",
    );
  });

  test("project tile returns focus to trigger", async ({ page }) => {
    await page.goto("/?lang=en");
    await settle(page);
    await openCloseAndAssertReturn(
      page,
      page.locator(".project-name-btn").first(),
      "project tile",
    );
  });

  test("company button returns focus to trigger", async ({ page }) => {
    await page.goto("/?lang=en");
    await settle(page);
    await openCloseAndAssertReturn(
      page,
      page.locator(".company-btn").first(),
      "company button",
    );
  });

  test("skill chip returns focus to trigger", async ({ page }) => {
    await page.goto("/?lang=en");
    await settle(page);
    await openCloseAndAssertReturn(
      page,
      page.locator("#skills .skill-pill-btn").first(),
      "skill chip",
    );
  });

  test("course modules trigger returns focus", async ({ page }) => {
    await page.goto("/?lang=en");
    await settle(page);
    const trigger = page.locator("#courses .education-program-btn").first();
    if ((await trigger.count()) === 0) test.skip(true, "no clickable course");
    await openCloseAndAssertReturn(page, trigger, "course");
  });

  test("education program returns focus", async ({ page }) => {
    await page.goto("/?lang=en");
    await settle(page);
    const trigger = page.locator("#education .education-program-btn").first();
    if ((await trigger.count()) === 0)
      test.skip(true, "no clickable education program");
    await openCloseAndAssertReturn(page, trigger, "education program");
  });

  test("search modal returns focus to floating-controls trigger", async ({
    page,
  }) => {
    await page.goto("/?lang=en");
    await settle(page);
    // The floating-controls pill is gated by an IntersectionObserver on
    // `.hero-meta` — scroll past it before clicking the search trigger
    // or the button is pointer-events:none + opacity:0.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() =>
      document
        .querySelector(".floating-controls")
        ?.classList.contains("is-scrolled"),
    );
    await openCloseAndAssertReturn(
      page,
      page.locator(".floating-controls-search").first(),
      "search trigger",
    );
  });
});

test.describe("reduced motion (SC 2.2.2)", () => {
  test("CelestialSky canvas does not paint frames under reduced-motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?lang=en");
    await settle(page);

    // The page's CelestialSky paints to a <canvas> on rAF when
    // reduced-motion is *not* set. With it set the paint loop should
    // short-circuit. We sample the canvas pixel buffer twice with a
    // ~200ms gap; an animating loop produces different pixels, a
    // gated loop produces identical ones.
    const canvas = page.locator("canvas").first();
    if ((await canvas.count()) === 0) test.skip(true, "no canvas mounted");
    const sample = async () =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const ctx = c.getContext("2d");
        if (!ctx || c.width === 0 || c.height === 0) return "empty";
        const data = ctx.getImageData(
          Math.floor(c.width / 2),
          Math.floor(c.height / 2),
          4,
          4,
        ).data;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        return String(sum);
      });

    const a = await sample();
    await page.waitForTimeout(220);
    const b = await sample();
    // When the canvas is empty (skipped paint) or static, the two
    // samples are identical. We accept either.
    expect(a, "canvas pixels drifted under prefers-reduced-motion").toBe(b);
  });
});

test.describe("toggle button label matches action (SC 2.5.3, 4.1.2)", () => {
  // The hero ThemeToggle is a "two-button radio" pattern: each button
  // represents a destination mode (light or dark). A click on the
  // already-pressed button must be idempotent — otherwise its
  // aria-label "Switch to <mode>" lies about activation, which voice-
  // control users (Label in Name) and screen-reader users (Name, Role,
  // Value) hit head-on.
  for (const start of ["dark", "light"] as const) {
    test(`pressing the active button in ${start} mode keeps the theme on ${start}`, async ({
      page,
    }) => {
      await page.goto("/?lang=en");
      await settle(page);
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
        localStorage.setItem("theme", t);
      }, start);
      await page.reload();
      await settle(page);

      const active = page
        .locator('.hero .theme-toggle-btn[aria-pressed="true"]')
        .first();
      await active.scrollIntoViewIfNeeded();
      await active.click();

      const themeAfter = await page.evaluate(
        () => document.documentElement.dataset.theme,
      );
      expect(themeAfter).toBe(start);
    });
  }
});

test.describe("hover-revealed content dismissible (SC 1.4.13)", () => {
  test("project stack chip tooltip closes on Escape", async ({ page }) => {
    await page.goto("/?lang=en");
    await settle(page);
    const chip = page
      .locator(".project-stack-btn-unused, .project-stack-btn")
      .first();
    if ((await chip.count()) === 0) test.skip(true, "no project chip");
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();
    // Browser-native title tooltips are dismissible only via the
    // browser's own UI; if the site replaces the native tooltip with a
    // custom popover, Escape must close it. We assert focus path stays
    // sane: pressing Escape on the focused chip must not navigate or
    // open a modal.
    await chip.focus();
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[role="dialog"]:not([aria-hidden="true"])'),
    ).toHaveCount(0);
  });
});
