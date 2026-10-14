import type { Locator } from '@playwright/test';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  timeoutMs: number;
  /** Poll/back-off sequence; the last value repeats. */
  intervals?: number[];
  /** Used in the thrown error for context. */
  label?: string;
}

/**
 * Run `action`, then poll `check` using the interval sequence. If the check is
 * still failing when the interval elapses, run the action again. Repeats until
 * the check passes or the timeout ends.
 */
export async function retryUntil(
  action: () => Promise<unknown>,
  check: () => Promise<boolean>,
  { timeoutMs, intervals = [1000, 2000, 3000], label = 'retryUntil' }: RetryOptions,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await action();
    } catch (e) {
      lastErr = e;
    }
    const wait = intervals[Math.min(attempt, intervals.length - 1)];
    const until = Math.min(Date.now() + wait, deadline);
    // poll the check in small slices during the interval
    do {
      try {
        if (await check()) return;
      } catch (e) {
        lastErr = e;
      }
      await sleep(Math.min(250, Math.max(0, until - Date.now())));
    } while (Date.now() < until);
    attempt++;
  }
  try {
    if (await check()) return;
  } catch (e) {
    lastErr = e;
  }
  const why = lastErr ? ` Last error: ${(lastErr as Error).message ?? lastErr}` : '';
  throw new Error(`${label}: condition not met after ${attempt} attempt(s) within ${timeoutMs} ms.${why}`);
}

/**
 * Fill a field and verify its value sticks — the portal's reactive framework
 * can wipe fields asynchronously, so refill until inputValue() === value.
 */
export async function fillAndAssert(locator: Locator, value: string, timeoutMs = 20_000): Promise<void> {
  await retryUntil(
    async () => {
      await locator.fill(value);
    },
    async () => {
      // give async watchers a moment to (possibly) clear it before we trust it
      await sleep(300);
      return (await locator.inputValue()) === value;
    },
    { timeoutMs, label: `fillAndAssert(${locator}) = "${value}"` },
  );
}

/** Click `clickTarget` (e.g. a label) until `checkbox` is checked. */
export async function checkUntilChecked(clickTarget: Locator, checkbox: Locator, timeoutMs = 15_000): Promise<void> {
  await retryUntil(
    async () => {
      if (!(await checkbox.isChecked())) await clickTarget.click();
    },
    () => checkbox.isChecked(),
    { timeoutMs, label: `checkUntilChecked(${checkbox})` },
  );
}

/** Tick a checkbox via el.click() inside the page, only if unchecked. */
export async function jsCheck(locator: Locator): Promise<void> {
  await locator.evaluate((el) => {
    const input = el as HTMLInputElement;
    if (!input.checked) input.click();
  });
}
