import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import type { JobPayload } from './types';

export interface Journey {
  page: Page;
  context: BrowserContext;
  testInfo: TestInfo;
  payload: JobPayload;
  /** The unique checkout email generated for this run. */
  email: string;
  idle: PortalIdle;
}

export const log = (step: string | number, msg: string) => console.log(`[Step ${step}] ${msg}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True if the router add-on is a Bring-Your-Own modem. */
export const isByoModem = (payload: JobPayload): boolean =>
  !!payload.addOns.router.model && payload.addOns.router.model.toLowerCase().includes('byo');

/** Visible-now check that never throws. */
export async function isVisible(locator: Locator): Promise<boolean> {
  return locator.first().isVisible().catch(() => false);
}

/** Wait (bounded) for a locator to become visible; returns false instead of throwing. */
export async function appears(locator: Locator, timeoutMs: number): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/**
 * Tracks the portal's cart XHRs (add-to-cart, get/products, get-sticky …).
 * The plan/modem cards re-render after each of these, so we wait for them to
 * go quiet before trusting button text — a condition-based wait, not a sleep.
 */
export class PortalIdle {
  private inflight = new Set<object>();
  private lastActivity = Date.now();
  private static readonly WATCH = /\/(add-to-cart|remove-from-cart|get\/products|checkout\/get-sticky|address-order|address\/check|addressdetails)/;

  constructor(page: Page) {
    page.on('request', (r) => {
      if (PortalIdle.WATCH.test(r.url())) {
        this.inflight.add(r);
        this.lastActivity = Date.now();
      }
    });
    const done = (r: object) => {
      if (this.inflight.delete(r)) this.lastActivity = Date.now();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  }

  /** Resolve once no watched request is in flight and none finished in the last `quietMs`. */
  async wait(quietMs = 1200, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastActivity >= quietMs) return;
      await sleep(150);
    }
  }
}

/**
 * Race several bounded waits and return the key of the first that succeeds,
 * or null if none does within `timeoutMs`. Losing waits are swallowed, so no
 * unhandled rejections leak out.
 */
export async function firstOf<K extends string>(
  candidates: Record<K, (timeoutMs: number) => Promise<unknown>>,
  timeoutMs: number,
): Promise<K | null> {
  const never = new Promise<never>(() => {});
  const racers = (Object.keys(candidates) as K[]).map((k) =>
    candidates[k](timeoutMs).then(
      () => k,
      () => never,
    ),
  );
  return Promise.race([...racers, sleep(timeoutMs + 250).then(() => null)]);
}
