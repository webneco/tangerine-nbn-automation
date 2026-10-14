import { test } from '@playwright/test';
import { type Journey, log } from '../journey';
import { AddressNotFoundError, addressAutocomplete, buildYourPlan, manualAddressEntry, selectSuggestion } from './address';
import { attemptPlanSelection } from './plan';

const MAX_ATTEMPTS = 3;

/**
 * Steps 2–5 (address → plan) with recovery: up to 3 attempts with a page
 * reload in between. "Address Not Found" is fail-fast (no retry).
 */
export async function addressAndPlanWithRecovery(j: Journey): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const sfx = attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : '';
    try {
      const auto = await test.step(`Step 2 — Address autocomplete${sfx}`, () => addressAutocomplete(j));

      let outcome: 'success' | 'manual' = 'manual';
      if (auto === 'suggestions') {
        outcome = await test.step(`Step 3 — Select address suggestion${sfx}`, () => selectSuggestion(j));
      }
      if (outcome === 'manual') {
        await test.step(`Step 3b — Manual address entry${sfx}`, () => manualAddressEntry(j));
      }

      await test.step(`Step 4 — Build Your Plan${sfx}`, () => buildYourPlan(j));
      await test.step(`Step 5 — Select plan "${j.payload.plan.name}"${sfx}`, () => attemptPlanSelection(j));
      return;
    } catch (e) {
      lastError = e;
      if (e instanceof AddressNotFoundError) throw e; // fail fast
      console.warn(`[Recovery] Steps 2–5 attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(e as Error).message}`);
      if (attempt < MAX_ATTEMPTS) {
        log('2-5', 'Reloading the page and retrying the address → plan flow');
        await j.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => j.page.goto(j.payload.portal.url, { waitUntil: 'domcontentloaded' }));
      }
    }
  }
  throw lastError;
}
