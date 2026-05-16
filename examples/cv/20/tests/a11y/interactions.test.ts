import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Interactive a11y coverage. The sister `site.test.ts` scans the static
// initial DOM; this file opens every modal, toggles theme/lang via the
// real controls, expands `<details>`, and re-scans — so a11y regressions
// inside an opened component (focus trap, Escape close, role/name on
// dynamically-mounted nodes) trip CI instead of waiting on a manual run.
//
// Scoped to one language × theme × viewport per interaction. Static
// site.test.ts already covers the full lang × theme × viewport matrix
// for the resting DOM; running every interaction across that matrix
// would balloon the per-PR job without finding new bugs (interactivity
// doesn't change between dark/light or en/sv).

const AA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForLoadState("networkidle");
}

async function gotoHome(page: Page) {
  await page.goto("/?lang=en");
  await settle(page);
}

async function scrollToBottom(page: Page) {
  // Reveal the FloatingControls pill, which is gated by an
  // IntersectionObserver on `.hero-meta` (`is-scrolled` toggles
  // visibility). Without scrolling, those buttons are
  // pointer-events:none + opacity:0 and Playwright will time out
  // waiting for them to be visible.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() =>
    document
      .querySelector(".floating-controls")
      ?.classList.contains("is-scrolled"),
  );
}

async function expectNoAxeViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze();
  expect(
    result.violations,
    `Accessibility violations on ${label}:\n${JSON.stringify(
      result.violations,
      null,
      2,
    )}`,
  ).toEqual([]);
}

async function expectModalOpen(page: Page) {
  const dialog = page.locator('[role="dialog"]:not([aria-hidden="true"])');
  await expect(dialog.first()).toBeVisible();
  return dialog;
}

async function expectModalClosed(page: Page) {
  await expect(
    page.locator('[role="dialog"]:not([aria-hidden="true"])'),
  ).toHaveCount(0);
}

async function tabCycleStaysInside(page: Page, modal: Locator, steps = 12) {
  // Tab `steps` times and confirm focus never escapes the modal subtree.
  // The focus trap (useModalFocus) wraps Tab and Shift+Tab; if it breaks,
  // focus lands on the page underneath and `modal.contains(active)`
  // returns false.
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    const insideModal = await modal.evaluate(
      (el) =>
        el.contains(document.activeElement) || el === document.activeElement,
    );
    expect(insideModal, `focus escaped the modal after Tab #${i + 1}`).toBe(
      true,
    );
  }
}

async function openAndAssertModal(page: Page, trigger: Locator, label: string) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const modal = await expectModalOpen(page);
  await settle(page);
  await expectNoAxeViolations(page, `${label} (open)`);
  await tabCycleStaysInside(page, modal.first());
  await page.keyboard.press("Escape");
  await expectModalClosed(page);
}

test.describe("hero & floating controls — interactive a11y", () => {
  test("hero summary modal opens, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    await openAndAssertModal(
      page,
      page.locator(".hero-summary").first(),
      "summary modal",
    );
  });

  test("floating-controls search button opens modal, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    await scrollToBottom(page);
    await page.locator(".floating-controls-search").first().click();
    const modal = await expectModalOpen(page);
    await settle(page);
    // The input takes initial focus; type a query and confirm the
    // aria-live status region announces a count.
    await page.keyboard.type("react");
    await page.waitForTimeout(300); // useDeferredValue
    const live = modal
      .first()
      .locator('[role="status"][aria-live="polite"]')
      .first();
    await expect(live).not.toBeEmpty();
    await expectNoAxeViolations(page, "search modal (with results)");
    await tabCycleStaysInside(page, modal.first());
    await page.keyboard.press("Escape");
    await expectModalClosed(page);
  });

  test("floating-controls theme toggle flips the theme via the button", async ({
    page,
  }) => {
    await gotoHome(page);
    await scrollToBottom(page);
    const before = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    await page.locator(".theme-toggle-compact").first().click();
    await page.waitForFunction(
      (prev) => document.documentElement.dataset.theme !== prev,
      before,
    );
    await settle(page);
    await expectNoAxeViolations(page, "after theme toggle");
  });

  test("floating-controls language toggle switches lang via the button", async ({
    page,
  }) => {
    await gotoHome(page);
    await scrollToBottom(page);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    await page.locator(".lang-toggle-compact").first().click();
    await page.waitForFunction(() => document.documentElement.lang === "sv");
    await settle(page);
    await expectNoAxeViolations(page, "after lang toggle");
  });

  test("hero theme toggle flips the theme via the button", async ({ page }) => {
    await gotoHome(page);
    const before = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    await page
      .locator('.theme-toggle .theme-toggle-btn[aria-pressed="false"]')
      .first()
      .click();
    await page.waitForFunction(
      (prev) => document.documentElement.dataset.theme !== prev,
      before,
    );
    await settle(page);
    await expectNoAxeViolations(page, "after hero theme toggle");
  });

  test("hero language toggle switches lang via the button", async ({
    page,
  }) => {
    await gotoHome(page);
    await page
      .locator('.lang-toggle .lang-toggle-btn[aria-pressed="false"]')
      .first()
      .click();
    await page.waitForFunction(() => document.documentElement.lang === "sv");
    await settle(page);
    await expectNoAxeViolations(page, "after hero lang toggle");
  });
});

test.describe("section modals — interactive a11y", () => {
  test("focus tile opens FocusModal, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    await openAndAssertModal(
      page,
      page.locator(".focus-item-btn").first(),
      "focus modal",
    );
  });

  test("project card opens ProjectModal, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    await openAndAssertModal(
      page,
      page.locator(".project-name-btn").first(),
      "project modal",
    );
  });

  test("project stack chip opens SkillModal, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    await openAndAssertModal(
      page,
      page.locator(".project-stack-btn").first(),
      "skill modal (from project)",
    );
  });

  test("company button opens CompanyModal, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    await openAndAssertModal(
      page,
      page.locator(".company-btn").first(),
      "company modal",
    );
  });

  test("education program opens ProgramCoursesModal, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    const trigger = page.locator("#education .education-program-btn").first();
    if ((await trigger.count()) === 0)
      test.skip(true, "no clickable education program");
    await openAndAssertModal(page, trigger, "program modal");
  });

  test("course card opens CourseModulesModal, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    const trigger = page.locator("#courses .education-program-btn").first();
    if ((await trigger.count()) === 0)
      test.skip(true, "no course with modules");
    await openAndAssertModal(page, trigger, "course modules modal");
  });

  test("skills bar opens SkillModal, traps focus, Escape closes", async ({
    page,
  }) => {
    await gotoHome(page);
    await openAndAssertModal(
      page,
      page.locator("#skills .skill-pill-btn").first(),
      "skill modal (from skills section)",
    );
  });

  test("experience assignments <details> expands via Enter on summary", async ({
    page,
  }) => {
    await gotoHome(page);
    const summary = page.locator("details.assignments > summary").first();
    if ((await summary.count()) === 0) test.skip(true, "no assignments");
    await summary.scrollIntoViewIfNeeded();
    await summary.focus();
    expect(
      await summary.evaluate(
        (el) => (el.parentElement as HTMLDetailsElement).open,
      ),
    ).toBe(false);
    await page.keyboard.press("Enter");
    await expect
      .poll(async () =>
        summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open),
      )
      .toBe(true);
    await settle(page);
    await expectNoAxeViolations(page, "experience details (expanded)");
  });
});
