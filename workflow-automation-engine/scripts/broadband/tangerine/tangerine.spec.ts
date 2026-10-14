import { test, expect } from '@playwright/test';
import { loadPayload, getPaymentCard } from './lib/payload';
import { appendEmailLog, generateUniqueEmail, updateEmailLog } from './lib/uniqueEmail';
import { type Journey, PortalIdle, log } from './lib/journey';
import { addressAndPlanWithRecovery } from './lib/steps/recovery';
import { dismissPostPlanPopups } from './lib/steps/plan';
import { selectRouter } from './lib/steps/router';
import { orderNow } from './lib/steps/orderNow';
import { addressView, checkoutEmail, connectionDetails, contactDetails, donation, holdOnPopup } from './lib/steps/checkout';
import { MISSING_CARD, captureTransactionId, confirmAndPay, fillCardForm, threeDSecure } from './lib/steps/payment';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Dev aid: STOP_AFTER_STEP=9 (or 15) ends the run early as passed, before checkout / payment. */
const STOP_AFTER_STEP = Number(process.env.STOP_AFTER_STEP || 0);
const stopAfter = (n: number) => STOP_AFTER_STEP > 0 && STOP_AFTER_STEP <= n;

/** Demo aid: ms to keep the browser on the confirmation page after Step 19 (default 0). */
const DEMO_HOLD_MS = Math.max(0, Number(process.env.DEMO_HOLD_MS || 0)) || 0;

test('Tangerine NBN sign-up journey', { tag: ['@TangerineModule', '@UserJourney', '@P1'] }, async ({ page, context }, testInfo) => {
  test.setTimeout(360_000);

  const payload = loadPayload();
  if (!getPaymentCard(payload)) throw new Error(MISSING_CARD);

  // A fresh email on every run (and every Playwright retry), generated in the test body.
  const email = generateUniqueEmail(payload.customer.email);
  payload.customer.email = email;
  console.log(`[Setup] Checkout email: ${email}`);
  testInfo.annotations.push({ type: 'Checkout email', description: email });
  appendEmailLog({
    timestamp: new Date().toISOString(),
    email,
    plan: payload.plan.name,
    routerModel: payload.addOns.router.enabled ? payload.addOns.router.model ?? '' : 'none',
    status: 'running',
    transactionId: '',
  });

  const j: Journey = { page, context, testInfo, payload, email, idle: new PortalIdle(page) };
  let status = 'failed';
  let transactionId = '';

  try {
    await test.step('Step 1 — Navigate to portal', async () => {
      log(1, `Opening ${payload.portal.url}`);
      await page.goto(payload.portal.url, { waitUntil: 'domcontentloaded' });
      const u = new URL(payload.portal.url);
      await expect(page).toHaveURL(new RegExp('^' + escapeRe(u.origin + u.pathname)));
    });

    // Steps 2, 3, (3b), 4, 5 — retried as a unit up to 3× with reloads.
    await addressAndPlanWithRecovery(j);

    await test.step('Step 6 — Post-plan popups', () => dismissPostPlanPopups(j));

    await test.step('Step 7 — Router add-on', async () => {
      if (!payload.addOns.router.enabled) return log(7, 'Router add-on disabled — skipping');
      await selectRouter(j);
    });

    await test.step('Step 8 — SIM plan add-on (skipped)', async () => {
      // Intentionally skipped: the journey does not add a mobile SIM plan.
      // Placeholder for a future selectSimPlan(j) step.
      log(8, 'SIM plan add-on intentionally skipped');
    });

    await test.step('Step 9 — Order Now', () => orderNow(j));
    if (stopAfter(9)) {
      status = 'stopped-after-step-9';
      return log(9, 'STOP_AFTER_STEP reached — ending run');
    }
    await test.step('Step 10 — "Hold on!" no-modem popup', () => holdOnPopup(j));
    await test.step('Step 11 — Checkout email (unique)', () => checkoutEmail(j));
    await test.step('Step 12 — Contact details', () => contactDetails(j));
    await test.step('Step 13 — Address view', () => addressView(j));
    await test.step('Step 14 — Connection details', () => connectionDetails(j));
    await test.step('Step 15 — Donation', () => donation(j));
    if (stopAfter(15)) {
      status = 'stopped-after-step-15';
      return log(15, 'STOP_AFTER_STEP reached — ending run before payment');
    }
    await test.step('Step 16 — Card form', () => fillCardForm(j));
    const { newTab } = await test.step('Step 17 — Confirm modal & Pay Now', () => confirmAndPay(j));
    await test.step('Step 18 — 3-D Secure', () => threeDSecure(j, newTab));
    transactionId = await test.step('Step 19 — Transaction ID', () => captureTransactionId(j));

    // Demo-only: keep the confirmation page on screen for recordings (npm run demo:record sets 5000).
    // Off (0) for normal runs, so it is not one of the journey's waits.
    if (DEMO_HOLD_MS > 0) {
      log(19, `DEMO_HOLD_MS — holding the confirmation page for ${DEMO_HOLD_MS} ms`);
      await page.waitForTimeout(DEMO_HOLD_MS);
    }

    status = 'passed';
  } catch (e) {
    status = `failed: ${String((e as Error)?.message ?? e).split('\n')[0]}`;
    throw e;
  } finally {
    updateEmailLog(email, { status, transactionId });
  }
});
