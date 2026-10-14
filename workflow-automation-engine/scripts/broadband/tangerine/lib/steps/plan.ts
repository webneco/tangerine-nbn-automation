import type { Locator, Page } from '@playwright/test';
import { SEL } from '../selectors';
import { retryUntil } from '../retry';
import { type Journey, appears, isVisible, log } from '../journey';

/** Parse "$59.90" → 59.9 (NaN-safe → 0). */
export function parseMoney(text: string | null | undefined): number {
  const n = parseFloat(String(text ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sticky-cart total. Uses "Total Monthly" (it only becomes non-zero when an nbn
 * plan is in the cart — an outright router alone adds to the one-off total),
 * falling back to "Total to Pay Today". The page renders two #sticky-main-cart
 * nodes; the first carries the totals.
 */
export async function cartTotal(page: Page): Promise<number> {
  const monthly = page.locator(SEL.plan.cartMonthly).first();
  if (await monthly.count()) return parseMoney(await monthly.textContent());
  return parseMoney(await page.locator(SEL.plan.cartToday).first().textContent().catch(() => '0'));
}

/** Dismiss the "Heads up!" (#accelerate-great) popup if it is showing. */
export async function dismissAccelerateGreat(page: Page, step: number | string): Promise<boolean> {
  const back = page.locator(SEL.popups.accelerateGreatBack);
  if (await isVisible(page.locator(SEL.popups.accelerateGreat)) && (await isVisible(back))) {
    log(step, '"Heads up!" popup — dismissing via #a2g_back_btn');
    await back.first().click().catch(() => back.first().evaluate((e) => (e as HTMLElement).click()));
    await page.locator(SEL.popups.accelerateGreat).first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    return true;
  }
  return false;
}

async function findPlanButton(page: Page, planName: string): Promise<Locator> {
  const want = planName.trim().toLowerCase();
  const buttons = page.locator(SEL.plan.productButton);
  let fallback: Locator | null = null;
  for (let i = 0, n = await buttons.count(); i < n; i++) {
    const b = buttons.nth(i);
    if ((await b.getAttribute('data-product-name'))?.trim().toLowerCase() !== want) continue;
    if (await b.isVisible()) return b; // prefer the visible copy (desktop vs mobile render)
    fallback ??= b;
  }
  if (fallback) return fallback;
  const plans = await page.locator(SEL.plan.speedButton).evaluateAll((els) => els.map((e) => e.getAttribute('data-product-name')));
  throw new Error(`Plan card "${planName}" not found. Available plans: ${plans.join(', ')}`);
}

/**
 * Step 5 core — click the plan until BOTH: its button reads "Selected" AND the
 * sticky cart total is > $0.00. Retries for up to 40 s (1, 2, 3 s intervals).
 */
export async function attemptPlanSelection(j: Journey, timeoutMs = 40_000): Promise<void> {
  const { page, payload } = j;
  const planName = payload.plan.name;
  const btn = await findPlanButton(page, planName);
  const isSelected = async () => /selected/i.test((await btn.textContent()) ?? '');

  await retryUntil(
    async () => {
      await dismissAccelerateGreat(page, 5);
      await j.idle.wait(800, 10_000);
      // Re-clicking a "Selected" plan toggles it off, so only click when the
      // plan is not (fully) in the cart.
      if ((await isSelected()) && (await cartTotal(page)) > 0) return;
      await btn.scrollIntoViewIfNeeded();
      log(5, `Clicking plan "${await btn.getAttribute('data-product-name')}"`);
      await btn.click();
    },
    async () => {
      await dismissAccelerateGreat(page, 5);
      return (await isSelected()) && (await cartTotal(page)) > 0;
    },
    { timeoutMs, intervals: [1000, 2000, 3000], label: `Select plan "${planName}"` },
  );
  log(5, `Plan "${planName}" selected — cart total $${(await cartTotal(page)).toFixed(2)}`);
}

/** Re-select the plan if the cart dropped to $0.00 (known portal race). */
export async function ensurePlanInCart(j: Journey, label: string): Promise<void> {
  const { page } = j;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await j.idle.wait(1000, 15_000);
    const total = await cartTotal(page);
    if (total > 0) {
      log(label, `Cart total $${total.toFixed(2)} — nbn plan present`);
      return;
    }
    console.warn(`[${label}] Cart total is $0.00 — re-selecting plan (attempt ${attempt}/3)`);
    await attemptPlanSelection(j).catch((e) => console.warn(`[${label}] re-select failed: ${(e as Error).message}`));
  }
  await j.idle.wait(1000, 15_000);
  if ((await cartTotal(page)) <= 0) throw new Error(`nbn plan missing from cart (${label})`);
}

/** Step 6 — optional post-plan popups. */
export async function dismissPostPlanPopups(j: Journey): Promise<void> {
  const { page } = j;
  if (await appears(page.locator(SEL.popups.accelerateGreat), 5_000)) await dismissAccelerateGreat(page, 6);
  else log(6, 'No "Heads up!" popup');

  const upgrade = page.locator(SEL.popups.equipmentUpgradeContinue).filter({ visible: true });
  if (await appears(upgrade, 2_000)) {
    log(6, 'Equipment upgrade popup — clicking Continue');
    await upgrade.first().click();
  } else {
    log(6, 'No equipment upgrade popup');
  }
  await j.idle.wait(800, 10_000);
}
