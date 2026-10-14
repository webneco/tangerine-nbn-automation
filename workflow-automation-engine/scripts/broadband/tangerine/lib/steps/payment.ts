import path from 'path';
import { expect, type Frame, type Page } from '@playwright/test';
import { SEL } from '../selectors';
import { fillAndAssert, jsCheck, retryUntil } from '../retry';
import { toMMYYYY } from '../format';
import { getPaymentCard } from '../payload';
import { type Journey, appears, log } from '../journey';

export const MISSING_CARD = 'Tangerine journey requires payment.card details but none were found';

/** Step 16 — fill the card form and open the Confirm modal. */
export async function fillCardForm(j: Journey): Promise<void> {
  const { page } = j;
  const card = getPaymentCard(j.payload);
  if (!card) throw new Error(MISSING_CARD);
  const P = SEL.payment;
  await page.waitForURL(/checkout\/payment-view/);

  await expect(page.locator(P.panFrame)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(P.cvvFrame)).toBeVisible({ timeout: 60_000 });
  log(16, 'Till Payments iframes visible');

  await page.locator(P.nameOnCard).fill(card.nameOnCard);
  await page.frameLocator(P.panFrame).locator('input').fill(card.cardNumber);
  await page.frameLocator(P.cvvFrame).locator('input').fill(card.cvv);
  const expiry = toMMYYYY(card.expiry);
  await fillAndAssert(page.locator(P.expiry), expiry);
  log(16, `Card **** ${card.cardNumber.slice(-4)}, expiry ${expiry}, name "${card.nameOnCard}"`);

  // Tick every checkbox on the payment form. The hidden ones inside #user-model
  // belong to the Confirm modal and are handled in Step 17.
  const boxes = page.locator('input[type="checkbox"]:not(#user-model input)');
  for (let i = 0, n = await boxes.count(); i < n; i++) await jsCheck(boxes.nth(i));
  for (let i = 0, n = await boxes.count(); i < n; i++) {
    const b = boxes.nth(i);
    if ((await b.isVisible()) && !(await b.isChecked())) throw new Error(`Checkbox #${await b.getAttribute('id')} would not tick`);
  }
  log(16, `Ticked ${await boxes.count()} agreement checkbox(es)`);

  const modal = page.locator(P.confirmModal);
  await retryUntil(
    () => page.locator(P.payNow).click({ timeout: 5_000 }),
    () => modal.isVisible(),
    { timeoutMs: 30_000, label: 'Pay Now → Confirm modal' },
  );
  log(16, 'Confirm modal open');
}

/** Step 17 — tick the Confirm modal boxes and press its Pay Now. Returns the new-tab promise for Step 18. */
export async function confirmAndPay(j: Journey): Promise<{ newTab: Promise<Page | null> }> {
  const { page, context } = j;
  const P = SEL.payment;
  const modal = page.locator(P.confirmModal);
  for (const sel of P.confirmCheckboxes.split(',').map((s) => s.trim())) {
    const box = modal.locator(sel);
    await retryUntil(() => jsCheck(box), () => box.isChecked(), { timeoutMs: 10_000, label: `confirm ${sel}` });
  }
  log(17, 'Confirm modal checkboxes ticked');

  // Start listening for a 3-DS tab BEFORE paying.
  const newTab = context.waitForEvent('page', { timeout: 60_000 }).catch(() => null);
  await modal.locator(P.confirmPayNow).click();
  log(17, 'Clicked modal Pay Now');
  return { newTab };
}

const AUTH_OPTION = /authenticated/i;

async function findAcsFrame(pages: Page[]): Promise<{ page: Page; frame: Frame } | null> {
  for (const p of pages) {
    if (p.isClosed()) continue;
    for (const f of p.frames()) {
      const hasAuth = await f
        .locator('select option')
        .evaluateAll((os) => os.some((o) => /authenticated/i.test(o.textContent || '')))
        .catch(() => false);
      if (hasAuth) return { page: p, frame: f };
    }
  }
  return null;
}

/** Step 18 — frictionless or challenge 3-D Secure. */
export async function threeDSecure(j: Journey, newTabPromise: Promise<Page | null>): Promise<void> {
  const { page } = j;
  let popup: Page | null = null;
  newTabPromise.then((p) => (popup = p));

  const state: { outcome: 'frictionless' | 'challenge' | 'pending'; acs: { page: Page; frame: Frame } | null } = {
    outcome: 'pending',
    acs: null,
  };
  await expect
    .poll(
      async () => {
        if (await page.locator(SEL.payment.transactionId).isVisible().catch(() => false)) return (state.outcome = 'frictionless');
        state.acs = await findAcsFrame(popup ? [popup, page] : [page]);
        if (state.acs) return (state.outcome = 'challenge');
        return 'pending';
      },
      { timeout: 60_000, intervals: [1000, 2000, 3000], message: '3-D Secure: neither #transactionId nor an ACS challenge appeared' },
    )
    .not.toBe('pending');

  if (state.outcome === 'frictionless') {
    log(18, 'Frictionless 3-DS — transaction id already visible');
    return;
  }

  const { page: acsPage, frame } = state.acs!;
  log(18, `3-DS challenge in ${acsPage === page ? 'the checkout tab' : 'a new tab'} (frame ${frame.url().slice(0, 80)})`);
  const select = frame.locator('select').filter({ has: frame.locator('option', { hasText: AUTH_OPTION }) }).first();
  const options = await select.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => ({ v: o.value, t: (o.textContent || '').trim() })));
  // Prefer the plain "Authenticated" (ECI 05) option over e.g. "Not Authenticated".
  const pick =
    options.find((o) => /authenticated/i.test(o.t) && /05/.test(o.t)) ??
    options.find((o) => /^authenticated\b/i.test(o.t)) ??
    options.find((o) => /authenticated/i.test(o.t) && !/not|fail|reject/i.test(o.t)) ??
    options.find((o) => /authenticated/i.test(o.t))!;
  await select.selectOption(pick.v);
  log(18, `Selected ACS option "${pick.t}"`);

  const submit = frame.getByRole('button', { name: /submit/i }).or(frame.locator('input[type="submit"]')).first();
  await submit.click();
  log(18, 'Submitted 3-DS challenge');

  if (acsPage !== page) {
    await acsPage.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
    await page.bringToFront();
  }
}

/** Step 19 — capture the transaction id. */
export async function captureTransactionId(j: Journey): Promise<string> {
  const { page, testInfo } = j;
  const txnLoc = page.locator(SEL.payment.transactionId);
  if (!(await appears(txnLoc, 60_000))) {
    throw new Error(`#transactionId not visible within 60 s (url ${page.url()})`);
  }
  const txnId = ((await txnLoc.first().innerText()) || '').trim();
  if (!txnId) throw new Error('#transactionId is visible but empty');
  log(19, `Transaction ID: ${txnId}`);

  testInfo.annotations.push({ type: 'Transaction ID', description: txnId });
  const file = path.join(testInfo.project.outputDir, `${txnId.replace(/[^A-Za-z0-9._-]/g, '_')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(`transaction-${txnId}`, { path: file, contentType: 'image/png' });
  return txnId;
}
