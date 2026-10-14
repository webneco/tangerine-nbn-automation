import type { Locator } from '@playwright/test';
import { SEL } from '../selectors';
import { retryUntil } from '../retry';
import { type Journey, log } from '../journey';
import { dismissAccelerateGreat, ensurePlanInCart } from './plan';

const tokenise = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function tabFor(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('eero')) return SEL.router.tabs.eero;
  if (m.includes('netcomm')) return SEL.router.tabs.netcomm;
  if (m.includes('byo')) return SEL.router.tabs.byo;
  throw new Error(`Unsupported router model "${model}" (expected BYO Modem | Amazon eero 7 | NetComm)`);
}

/** Step 7 — choose the router add-on, then make sure the plan survived. */
export async function selectRouter(j: Journey): Promise<string> {
  const { page, payload, testInfo } = j;
  const model = payload.addOns.router.model as string;
  const tabSel = tabFor(model);
  const wanted = tokenise(model);
  let chosen = '';
  let chosenBtn: Locator | null = null;

  const pick = async (): Promise<{ btn: Locator; name: string }> => {
    const tab = page.locator(tabSel);
    const panelId = await tab.getAttribute('aria-controls');
    const scope = panelId ? page.locator(`#${panelId}`) : page.locator('body');
    const buttons = scope.locator(SEL.router.outrightButton);
    let firstVisible: { btn: Locator; name: string } | null = null;
    for (let i = 0, n = await buttons.count(); i < n; i++) {
      const b = buttons.nth(i);
      if (!(await b.isVisible())) continue;
      const name = ((await b.getAttribute('data-product-name')) ?? '').trim();
      firstVisible ??= { btn: b, name };
      const have = new Set(tokenise(name));
      if (wanted.every((t) => have.has(t))) return { btn: b, name };
    }
    if (firstVisible) {
      console.warn(`[Step 7] No modem matches tokens [${wanted.join(', ')}] — using first Outright option "${firstVisible.name}"`);
      return firstVisible;
    }
    throw new Error(`No visible Outright modem button in ${tabSel}`);
  };

  // The modem section re-renders after every cart XHR and resets the active
  // tab, so the tab click + button click are retried together.
  await retryUntil(
    async () => {
      await dismissAccelerateGreat(page, 7);
      await j.idle.wait(800, 10_000);
      const tab = page.locator(tabSel);
      if (!/\bactive\b/.test((await tab.getAttribute('class')) ?? '')) {
        await tab.scrollIntoViewIfNeeded();
        await tab.click({ timeout: 5_000 });
      }
      const { btn, name } = await pick();
      chosen = name;
      chosenBtn = btn;
      if (!/selected/i.test((await btn.textContent()) ?? '')) {
        log(7, `Clicking Outright "${name}"`);
        await btn.click({ timeout: 5_000 });
      }
    },
    async () => {
      if (!chosenBtn) return false;
      await j.idle.wait(1200, 15_000); // let the card re-render settle before trusting its text
      const byName = page.locator(`${SEL.router.outrightButton}[data-product-name="${chosen}"]`);
      const texts = await byName.allTextContents();
      return texts.some((t) => /selected/i.test(t));
    },
    { timeoutMs: 45_000, label: `Select router "${model}"` },
  );

  log(7, `Router selected: "${chosen}"`);
  testInfo.annotations.push({ type: 'Router model', description: chosen });
  await ensurePlanInCart(j, 'router-select');
  return chosen;
}
