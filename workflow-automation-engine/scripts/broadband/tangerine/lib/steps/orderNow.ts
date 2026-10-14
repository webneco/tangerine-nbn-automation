import { SEL } from '../selectors';
import { type Journey, firstOf, log } from '../journey';
import { dismissAccelerateGreat, ensurePlanInCart } from './plan';

export const ROUTER_WITHOUT_PLAN = 'Portal blocked checkout: cart contains a router but no nbn plan';

/** Step 9 — Order Now. Retries the click up to 3 times if nothing happens. */
export async function orderNow(j: Journey): Promise<'no-modem-popup' | 'checkout'> {
  const { page } = j;
  await ensurePlanInCart(j, 'order-now');

  const noModem = page.locator(SEL.popups.noModemAgree).filter({ visible: true });
  const withoutNbn = page.locator(SEL.popups.routerWithoutPlan).filter({ visible: true });

  for (let attempt = 1; attempt <= 4; attempt++) {
    await dismissAccelerateGreat(page, 9);
    const btn = page.locator(SEL.orderNow).filter({ visible: true }).first();
    log(9, `Clicking Order Now (attempt ${attempt}/4)`);
    await btn.click();

    const outcome = await firstOf(
      {
        'no-modem-popup': (t) => noModem.first().waitFor({ state: 'visible', timeout: t }),
        checkout: (t) => page.waitForURL(/checkout\/login/, { timeout: t }),
        'without-nbn': (t) => withoutNbn.first().waitFor({ state: 'visible', timeout: t }),
      },
      15_000,
    );

    if (outcome === 'without-nbn') throw new Error(ROUTER_WITHOUT_PLAN);
    if (outcome) {
      log(9, `Order Now → ${outcome}`);
      return outcome;
    }
    console.warn(`[Step 9] Order Now click had no visible effect (attempt ${attempt})`);
    await ensurePlanInCart(j, 'order-now');
  }
  throw new Error('Order Now did not open the no-modem popup or navigate to checkout/login after 4 clicks');
}
