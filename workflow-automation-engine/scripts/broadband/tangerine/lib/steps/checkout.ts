import { expect, type Locator, type Page } from '@playwright/test';
import { SEL } from '../selectors';
import { checkUntilChecked, fillAndAssert, jsCheck, retryUntil } from '../retry';
import { resolveStreetType } from '../paf';
import { type Journey, appears, firstOf, isByoModem, isVisible, log } from '../journey';
import { dismissAccelerateGreat } from './plan';
import { ROUTER_WITHOUT_PLAN } from './orderNow';

export const OTP_REQUIRED = 'Email OTP verification required — submit sale manually';

/** Select an <option> by case-insensitive label or value, then assert it stuck. */
export async function selectCI(select: Locator, wanted: string): Promise<string> {
  const want = wanted.trim().toUpperCase();
  const options = await select.locator('option').evaluateAll((os) =>
    (os as HTMLOptionElement[]).map((o) => ({ value: o.value, label: (o.textContent || '').trim() })),
  );
  const hit = options.find((o) => o.label.toUpperCase() === want || o.value.toUpperCase() === want);
  if (!hit) {
    const id = await select.evaluate((e) => e.id);
    throw new Error(`Option "${wanted}" not found in #${id} (have: ${options.map((o) => o.label).join(' | ')})`);
  }
  await retryUntil(
    () => select.selectOption(hit.value),
    async () => (await select.inputValue()) === hit.value,
    { timeoutMs: 15_000, label: `select "${hit.label}"` },
  );
  return hit.label;
}

/** Click a radio/checkbox until it is checked (popups and re-renders can swallow clicks). */
async function clickUntilChecked(page: Page, target: Locator, step: number, label: string, timeoutMs = 15_000) {
  await retryUntil(
    async () => {
      await dismissAccelerateGreat(page, step);
      if (await target.isChecked()) return;
      await target.click({ timeout: 4_000 }).catch(() => jsCheck(target));
    },
    () => target.isChecked(),
    { timeoutMs, label },
  );
}

// ---------------------------------------------------------------------------

/** Step 10 — "Hold on!" no-modem popup → Agree. */
export async function holdOnPopup(j: Journey): Promise<void> {
  const { page } = j;
  const agree = page.locator(SEL.popups.noModemAgree).filter({ visible: true });
  if (await isVisible(agree)) {
    log(10, 'No-modem / BYO popup visible — clicking "Agree and Continue"');
    await agree.first().click();
  } else {
    log(10, 'No popup (modem in cart) — proceeding');
  }
  await page.waitForURL(/checkout\/login/, { timeout: 60_000 });
}

/** Step 11 — checkout login with the unique email. */
export async function checkoutEmail(j: Journey): Promise<void> {
  const { page } = j;
  await page.locator(SEL.login.email).waitFor({ state: 'visible' });
  await fillAndAssert(page.locator(SEL.login.email), j.email);
  log(11, `Entered checkout email ${j.email}`);
  await page.waitForTimeout(800); // documented settle after email entry

  for (let attempt = 1; attempt <= 4; attempt++) {
    if ((await page.locator(SEL.login.email).inputValue()) !== j.email) await fillAndAssert(page.locator(SEL.login.email), j.email);
    log(11, `Clicking Next (attempt ${attempt}/4)`);
    await page.locator(SEL.login.next).click();
    const outcome = await firstOf(
      {
        otp: (t) => page.locator(SEL.login.otp).waitFor({ state: 'visible', timeout: t }),
        contact: (t) => page.waitForURL(/checkout\/contact-details-view/, { timeout: t }),
        withoutNbn: (t) => page.locator(SEL.popups.routerWithoutPlan).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: t }),
      },
      20_000,
    );
    if (outcome === 'otp') throw new Error(OTP_REQUIRED);
    if (outcome === 'withoutNbn') throw new Error(ROUTER_WITHOUT_PLAN);
    if (outcome === 'contact') return;
    console.warn(`[Step 11] Next had no effect (attempt ${attempt})`);
  }
  throw new Error(`Checkout email Next did not reach contact-details-view after 4 clicks (url ${page.url()})`);
}

/** Step 12 — contact details. */
export async function contactDetails(j: Journey): Promise<void> {
  const { page, payload } = j;
  const c = payload.customer;
  const C = SEL.contact;
  await page.waitForURL(/checkout\/contact-details-view/);

  await selectCI(page.locator(C.salutation), c.title);
  await fillAndAssert(page.locator(C.firstName), c.firstName);
  await fillAndAssert(page.locator(C.lastName), c.lastName);
  await fillAndAssert(page.locator(C.mobile), c.phone);

  // DOB is a masked input: type it key by key, then verify the rendered value.
  const dob = page.locator(C.dob);
  const typeDob = async () => {
    await dob.fill('');
    await dob.click();
    await dob.pressSequentially(c.dateOfBirth.replace(/\D/g, ''), { delay: 80 });
    if ((await dob.inputValue()) !== c.dateOfBirth) {
      // some mask builds want the separators typed too
      await dob.fill('');
      await dob.pressSequentially(c.dateOfBirth, { delay: 80 });
    }
  };
  await retryUntil(typeDob, async () => (await dob.inputValue()) === c.dateOfBirth, {
    timeoutMs: 20_000,
    label: `DOB = ${c.dateOfBirth}`,
  });

  await selectCI(page.locator(C.hearAboutUs), '--Other--');
  await jsCheck(page.locator(C.privacyPolicy));
  await expect(page.locator(C.privacyPolicy)).toBeChecked();
  log(12, `Contact details filled for ${c.title} ${c.firstName} ${c.lastName}`);

  const expected: [string, string][] = [
    [C.firstName, c.firstName],
    [C.lastName, c.lastName],
    [C.mobile, c.phone],
  ];
  await retryUntil(
    async () => {
      // the reactive form can wipe values asynchronously — re-assert before submitting
      for (const [sel, v] of expected) if ((await page.locator(sel).inputValue()) !== v) await fillAndAssert(page.locator(sel), v);
      if ((await dob.inputValue()) !== c.dateOfBirth) await typeDob();
      await jsCheck(page.locator(C.privacyPolicy));
      await page.locator(C.next).click({ timeout: 5_000 });
    },
    async () => /checkout\/address-view/.test(page.url()),
    { timeoutMs: 45_000, label: 'Contact details → address-view' },
  );
}

/** Step 13 — service / delivery address and billing preference. */
export async function addressView(j: Journey): Promise<void> {
  const { page, payload } = j;
  const a = payload.connectionAddress.mainAddress;
  const A = SEL.addressView;
  const D = A.delivery;
  await page.waitForURL(/checkout\/address-view/);

  const streetHint = a.streetName || a.fullAddress.split(',')[0].replace(/^\S+\s+/, '');
  await expect(page.locator('body')).toContainText(new RegExp(streetHint.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  log(13, `Service address displayed (matched "${streetHint}")`);

  const deliveryFields: [Locator, string][] = [];
  if (a.streetNumber) {
    const useService = page.locator(A.useServiceAddress);
    if (await useService.isChecked()) {
      await page.locator(A.useServiceAddressLabel).click().catch(() => {});
      if (await useService.isChecked()) await useService.evaluate((e) => (e as HTMLInputElement).click());
    }
    await expect(useService).not.toBeChecked();
    await page.locator(D.streetNo).waitFor({ state: 'visible' });
    log(13, 'Unchecked "Use Service Address" — filling delivery address');

    if (a.unitNumber) deliveryFields.push([page.locator(D.unitNo), a.unitNumber]);
    deliveryFields.push([page.locator(D.streetNo), a.streetNumber]);
    if (a.streetName) deliveryFields.push([page.locator(D.streetName), a.streetName]);
    if (a.suburb) deliveryFields.push([page.locator(D.suburb), a.suburb]);
    if (a.postcode) deliveryFields.push([page.locator(D.postcode), a.postcode]);
    for (const [loc, v] of deliveryFields) await fillAndAssert(loc, v);
    if (a.streetType) await selectCI(page.locator(D.streetType), resolveStreetType(a.streetType));
    if (a.state) await selectCI(page.locator(D.state), a.state);
  } else {
    log(13, 'No streetNumber supplied — keeping "Use Service Address"');
  }

  await checkUntilChecked(page.locator(A.selfCarePortalLabel), page.locator(A.selfCarePortal), 15_000);
  log(13, 'Billing: Self Care Portal selected');

  await retryUntil(
    async () => {
      for (const [loc, v] of deliveryFields) if ((await loc.inputValue()) !== v) await fillAndAssert(loc, v);
      await page.locator(A.next).click({ timeout: 5_000 });
    },
    async () => /checkout\/transfer-number-view/.test(page.url()),
    { timeoutMs: 45_000, label: 'Address view → transfer-number-view' },
  );
}

/** Step 14 — connection details. */
export async function connectionDetails(j: Journey): Promise<void> {
  const { page, payload } = j;
  const T = SEL.transfer;
  const cd = payload.connectionDetails ?? {};
  await page.waitForURL(/checkout\/transfer-number-view/);
  await page.waitForLoadState('domcontentloaded');
  await dismissAccelerateGreat(page, 14);

  // 1. Activation type
  const isNew = !!(cd.moveInDate && cd.moveInDate.trim());
  await clickUntilChecked(page, page.locator(isNew ? T.activationNew : T.activationTransfer), 14, 'activation type');
  log(14, `Activation type: ${isNew ? 'New' : 'Transfer'}`);
  await j.idle.wait(800, 10_000);
  await dismissAccelerateGreat(page, 14);

  // 2. AVC ID, then current provider
  const avcContainer = page.locator(T.avcContainer);
  let avcOk = false;
  if (cd.avcId && cd.avcId.trim() && (await appears(page.locator(T.avcId), 5_000))) {
    await fillAndAssert(page.locator(T.avcId), cd.avcId.trim());
    await page.locator(T.avcCheck).filter({ visible: true }).first().click();
    // Success text is not documented; treat a positive message with no error as success.
    avcOk = await avcContainer
      .getByText(/valid|verified|success|confirmed/i)
      .filter({ hasNotText: /invalid|not valid|error|unable|not found/i })
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    log(14, `AVC ID ${cd.avcId} check: ${avcOk ? 'accepted' : 'not confirmed — using Provide Later'}`);
  }
  if (!avcOk && (await page.locator(T.avcProvideLater).count())) {
    await retryUntil(
      async () => {
        await dismissAccelerateGreat(page, 14);
        await jsCheck(page.locator(T.avcProvideLater));
      },
      () => page.locator(T.avcProvideLater).isChecked(),
      { timeoutMs: 15_000, label: 'AVC Provide Later' },
    );
    log(14, 'AVC ID: Provide Later');
  }

  const provider = page.locator(T.provider);
  if (await isVisible(provider)) {
    let picked: string;
    try {
      picked = await selectCI(provider, cd.currentProvider?.trim() || '--Other--');
    } catch {
      picked = await selectCI(provider, '--Other--');
    }
    log(14, `Current provider: ${picked}`);
  }

  // 3. Preferred connection date
  const when = (payload.connectionDeliveryDate ?? '').trim();
  if (when && !/^asap$/i.test(when)) {
    await fillAndAssert(page.locator(T.preferredDate), when);
    await page.keyboard.press('Escape');
    log(14, `Preferred connection date: ${when}`);
  } else {
    log(14, 'Preferred connection date: ASAP (left blank)');
  }

  // 4. "Is there an active nbn connection box?" → Unsure
  if (await isVisible(page.locator(T.activeNbnUnsure))) {
    await clickUntilChecked(page, page.locator(T.activeNbnUnsure), 14, 'active nbn = Unsure');
    log(14, 'Active nbn question: Unsure');
  }

  // 5. Activating nbn (only for a Tangerine modem — BYO never renders it)
  if (payload.addOns.router.enabled && !isByoModem(payload)) {
    await clickUntilChecked(page, page.locator(T.activatingNbnYes), 14, '#activating_nbn_yes');
    log(14, '#activating_nbn_yes checked');
  }

  // 6. Process Order & Pay
  await retryUntil(
    async () => {
      await dismissAccelerateGreat(page, 14);
      await page.locator(T.processOrder).click({ timeout: 5_000 });
    },
    async () => /checkout\/donate/.test(page.url()),
    { timeoutMs: 30_000, intervals: [1000, 2000, 3000], label: 'Process Order & Pay → donate' },
  );
}

/** Step 15 — donation: No. */
export async function donation(j: Journey): Promise<void> {
  const { page } = j;
  await page.waitForURL(/checkout\/donate/);
  const no = page.locator(SEL.donate.no);
  await retryUntil(
    () => no.check({ timeout: 4_000 }).catch(() => jsCheck(no)),
    () => no.isChecked(),
    { timeoutMs: 15_000, label: 'Donation = No' },
  );
  log(15, 'Donation: No');
  await retryUntil(
    () => page.locator(SEL.donate.next).click({ timeout: 5_000 }),
    async () => /checkout\/payment-view/.test(page.url()),
    { timeoutMs: 30_000, label: 'Donate → payment-view' },
  );
}
