import type { Locator, Page } from '@playwright/test';
import { SEL } from '../selectors';
import { canonicaliseAddress } from '../address';
import { resolveStreetType } from '../paf';
import { type Journey, appears, firstOf, isVisible, log } from '../journey';
import type { MainAddress } from '../types';

export const ADDRESS_NOT_FOUND = 'Address Not Found Proceed Manually';

export class AddressNotFoundError extends Error {
  constructor(detail?: string) {
    super(detail ? `${ADDRESS_NOT_FOUND} — ${detail}` : ADDRESS_NOT_FOUND);
    this.name = 'AddressNotFoundError';
  }
}

export type AutocompleteOutcome = 'suggestions' | 'manual';
export type CheckOutcome = 'success' | 'manual';

const successPopup = (page: Page) => page.locator(`${SEL.address.success}:visible, ${SEL.address.successWireless}:visible`);

/** Step 2 — type the address and wait for the autosuggest results. */
export async function addressAutocomplete(j: Journey): Promise<AutocompleteOutcome> {
  const { page } = j;
  const addr = j.payload.connectionAddress.mainAddress;
  const input = page.locator(SEL.address.input);

  await input.waitFor({ state: 'visible' });
  await input.click();
  await input.fill('');

  const autosuggest = page
    .waitForResponse((r) => r.url().includes('/autosuggest') && r.request().method() === 'POST', { timeout: 30_000 })
    .catch(() => null);
  await input.pressSequentially(addr.fullAddress, { delay: 80 });
  const resp = await autosuggest;
  log(2, `Typed "${addr.fullAddress}" — /autosuggest ${resp ? resp.status() : 'no response'}`);

  if (await appears(page.locator(SEL.address.suggestion), 30_000)) {
    const n = await page.locator(SEL.address.suggestion).count();
    log(2, `${n} suggestion(s) shown`);
    return 'suggestions';
  }

  if (addr.streetNumber) {
    log(2, 'No suggestions — falling back to "Enter your address manually"');
    const link = page.locator(SEL.address.enterManually).filter({ visible: true }).first();
    if (await appears(link, 5_000)) {
      await link.click();
    } else {
      // The current portal build has no visible link; open the same form the
      // portal opens on "Address not found" (its own addressManual()).
      log(2, "Link not rendered — opening #manual-address via the portal's addressManual()");
      await page.evaluate(() => {
        const w = window as any;
        w.$('.modal-sections').hide();
        w.addressManual();
        w.$('#user-model').first().modal('show');
      });
    }
    return 'manual';
  }

  const html = await page.locator(SEL.address.searchResult).innerHTML().catch(() => '<missing>');
  throw new Error(`No address suggestions for "${addr.fullAddress}". #search-result innerHTML: ${html}`);
}

/**
 * Step 3 — click the first suggestion; resolve the "Nearly there!" picker if it
 * appears; then wait for the address check to finish (success or manual form).
 */
export async function selectSuggestion(j: Journey): Promise<CheckOutcome> {
  const { page } = j;
  const addr = j.payload.connectionAddress.mainAddress;
  const first = page.locator(SEL.address.suggestion).first();
  log(3, `Clicking suggestion "${(await first.innerText()).trim()}"`);
  await first.click();

  if (await appears(page.locator(SEL.address.nearlyPopup), 8_000)) {
    await pickNearlyThere(page, addr.fullAddress);
  }

  return waitForAddressCheck(page, 3);
}

async function pickNearlyThere(page: Page, fullAddress: string): Promise<void> {
  const target = canonicaliseAddress(fullAddress);
  const options = page.locator(SEL.address.nearlyOption).filter({ visible: true });
  await options.first().waitFor({ state: 'visible', timeout: 15_000 });
  const texts = (await options.allInnerTexts()).map((t) => t.trim());
  log(3, `"Nearly there!" popup with ${texts.length} option(s); looking for ${target}`);
  const idx = texts.findIndex((t) => canonicaliseAddress(t) === target);
  if (idx >= 0) {
    log(3, `Exact canonical match: "${texts[idx]}"`);
    await options.nth(idx).click();
  } else {
    console.warn(`[Step 3] No canonical match for "${fullAddress}" in [${texts.join(' | ')}] — clicking the first option`);
    await options.first().click();
  }
}

/** Wait for the address check to land on the success popup or the manual form. */
async function waitForAddressCheck(page: Page, step: number | string, timeoutMs = 60_000): Promise<CheckOutcome> {
  const success = successPopup(page);
  const manual = page.locator(SEL.address.manualSection).filter({ visible: true });
  const outcome = await firstOf(
    {
      success: (t) => success.first().waitFor({ state: 'visible', timeout: t }),
      manual: (t) => manual.first().waitFor({ state: 'visible', timeout: t }),
    },
    timeoutMs,
  );
  if (!outcome) {
    const visible = await page
      .locator('#modal-ajax-result .modal-sections')
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.id));
    throw new Error(`Address check did not finish within ${timeoutMs} ms (visible sections: ${visible.join(', ') || 'none'})`);
  }
  const id = outcome === 'success' ? await success.first().getAttribute('id') : 'manual-address';
  log(step, `Address check result: ${outcome} (#${id})`);
  return outcome;
}

async function selectByLabelCI(select: Locator, wanted: string): Promise<string> {
  const want = wanted.trim().toUpperCase();
  const options = await select.locator('option').evaluateAll((os) =>
    (os as HTMLOptionElement[]).map((o) => ({ value: o.value, label: (o.textContent || '').trim() })),
  );
  const hit = options.find((o) => o.label.toUpperCase() === want || o.value.toUpperCase() === want);
  if (!hit) throw new Error(`Option "${wanted}" not found in ${await select.evaluate((e) => '#' + e.id)}`);
  await select.selectOption(hit.value);
  return hit.label;
}

/** Step 3b — manual address entry via the #manual-address modal. */
export async function manualAddressEntry(j: Journey): Promise<void> {
  const { page } = j;
  const a: MainAddress = j.payload.connectionAddress.mainAddress;
  const M = SEL.address.manual;

  if (!(await appears(page.locator(SEL.address.manualSection), 15_000))) {
    throw new AddressNotFoundError('manual address form did not open');
  }
  if (!a.streetNumber || !a.streetName) throw new AddressNotFoundError('streetNumber/streetName not supplied');

  log('3b', 'Filling manual address form');
  if (a.unitNumber) await page.locator(M.unitNo).fill(a.unitNumber);
  await page.locator(M.streetNo).fill(a.streetNumber);
  await page.locator(M.streetName).fill(a.streetName);
  if (a.streetType) await selectByLabelCI(page.locator(M.streetType), resolveStreetType(a.streetType));
  if (a.suburb) await page.locator(M.suburb).fill(a.suburb);
  if (a.state) await selectByLabelCI(page.locator(M.state), a.state);
  if (a.postcode) await page.locator(M.postcode).fill(a.postcode);
  await page.locator(M.submit).click();

  try {
    const outcome = await waitForAddressCheck(page, '3b');
    if (outcome !== 'success') throw new Error('manual form shown again');
  } catch (e) {
    throw new AddressNotFoundError((e as Error).message);
  }
}

/** Step 4 — Build Your Plan. */
export async function buildYourPlan(j: Journey): Promise<void> {
  const { page } = j;
  const popup = successPopup(page).first();
  await popup.waitFor({ state: 'visible', timeout: 30_000 });
  log(4, `Success popup #${await popup.getAttribute('id')} — settling 1.5 s`);
  await page.waitForTimeout(1_500); // documented settle before Build Your Plan

  let btn = popup.getByRole('link', { name: SEL.address.buildYourPlanText });
  if (!(await isVisible(btn))) btn = popup.locator(SEL.address.buildYourPlanFallback);
  await btn.first().click();
  await page.waitForLoadState('domcontentloaded');

  // Plan cards say "Check Address" until /get/products returns for this session.
  await page
    .locator(SEL.plan.speedButton)
    .filter({ hasNotText: /check address/i })
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 });
  log(4, 'Plan cards are active');
}
