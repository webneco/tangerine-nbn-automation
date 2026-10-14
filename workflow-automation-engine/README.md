# workflow-automation-engine — Tangerine NBN sign-up

Playwright + TypeScript automation of the Tangerine NBN agent-portal sign-up journey
(TEST environment: `https://test-tangerine.hipeely.com/nbn/nbn-broadband#speeds`), end to end:
address check → plan → router → checkout → Till Payments card + 3-D Secure → transaction ID.

Every run checks out with a **new, unique email**.

```
scripts/broadband/tangerine/
├── tangerine.spec.ts          # the journey (19 test.step entries)
├── tangerineData.json         # default payload
└── lib/
    ├── selectors.ts           # SEL — every selector in one place
    ├── types.ts               # JobPayload
    ├── payload.ts             # loadPayload(), validatePayload(), getPaymentCard()
    ├── uniqueEmail.ts         # generateUniqueEmail() + run-logs/emails-used.csv
    ├── paf.ts                 # Australia Post PAF street-type map, resolveStreetType()
    ├── address.ts             # canonicaliseAddress()
    ├── retry.ts               # retryUntil, fillAndAssert, checkUntilChecked, jsCheck
    ├── format.ts              # toMMYYYY()
    ├── journey.ts             # Journey context, logging, PortalIdle XHR tracker, firstOf()
    └── steps/                 # address, plan, router, orderNow, checkout, payment, recovery
```

## Setup

```bash
cd workflow-automation-engine
npm install
npx playwright install chromium
npm run typecheck
```

Node 18+ (developed on Node 22). TypeScript is pinned to 5.x because the spec'd
`moduleResolution: "node"` was removed in TypeScript 7.

If the test portal is behind basic auth, set `PORTAL_USER` and `PORTAL_PASS`.

## Running

| Command | What it does |
|---|---|
| `npm run test:tangerine` | Headless run (tag `@TangerineModule`) |
| `npm run test:tangerine:headed` | Headed run |
| `npm run test:tangerine:debug` | Playwright inspector |
| `npm run report` | Open the last HTML report |
| `npm run typecheck` | `tsc --noEmit` |

`HEADLESS=false` also forces a headed browser.
Dev aid: `STOP_AFTER_STEP=9` (or `15`) ends the run early as passed — handy for checking the
pre-checkout / checkout steps without placing an order.

> ⚠️ A full run submits a real order on the TEST portal with the Till Payments TEST card.

## Custom payload

Priority: `JOB_PAYLOAD` (JSON string) → `JOB_PAYLOAD_FILE` (path) → `tangerineData.json`.
The payload is validated up front and **one** error lists every missing/invalid field.

**bash**

```bash
JOB_PAYLOAD_FILE=./my-job.json npm run test:tangerine

JOB_PAYLOAD="$(cat ./my-job.json)" npm run test:tangerine
```

**PowerShell**

```powershell
$env:JOB_PAYLOAD_FILE = ".\my-job.json"; npm run test:tangerine

$env:JOB_PAYLOAD = Get-Content .\my-job.json -Raw; npm run test:tangerine
Remove-Item Env:JOB_PAYLOAD
```

Field reference: see `lib/types.ts` (`plan.name` is matched case-insensitively; `addOns.router.model`
is one of `BYO Modem` | `Amazon eero 7` | `NetComm`; `connectionDeliveryDate` is `ASAP`, a date, or blank).

## Unique email

Generated inside the test body, so every run and every Playwright retry gets a fresh one:

`<local>.<yyMMddHHmmss><3 random a-z0-9>@<domain>` — e.g. `prime150.261014134512k3x@yopmail.com`

* local part = payload email's local part, `+suffix` stripped, only `a–z0–9`, truncated so the
  local part stays ≤ 64 chars; default domain `yopmail.com`.
* `payload.customer.email` is overwritten with it before checkout.
* It is logged, added as the `Checkout email` annotation, and appended to `run-logs/emails-used.csv`.

| Env | Default | Effect |
|---|---|---|
| `UNIQUE_EMAIL` | `true` | `false` → use the payload email unchanged |
| `EMAIL_DOMAIN` | payload domain | override the domain |
| `EMAIL_PREFIX` | payload local part | override the local part |

## Outputs

| What | Where |
|---|---|
| HTML report (19 steps, annotations: Checkout email, Router model, Transaction ID) | `playwright-report/` → `npm run report` |
| Transaction screenshot `<txnId>.png` (also attached to the report) | `test-results/` |
| Trace / video / screenshot on failure | `test-results/<test>/` |
| Emails used: `timestamp,email,plan,routerModel,status,transactionId` | `run-logs/emails-used.csv` |

`status` is `running` while in flight, then `passed` or `failed: <first line of the error>` (written in a `finally`).

## Failure scenarios

| # | Scenario | Behaviour implemented |
|---|---|---|
| 1 | Autocomplete returns no suggestions | Waits up to 30 s for `#search-result .autocomplete-suggestion[data-id]` (the portal's "Sorry! Address Not Found" placeholder has no `data-id`). With `streetNumber` → manual entry (Step 3b); otherwise throws with the typed value and `#search-result` innerHTML. |
| 2 | Address not found (manual entry also fails) | Throws **`Address Not Found Proceed Manually`** — fail-fast, never retried by the recovery wrapper. |
| 3 | "Nearly there!" disambiguation mismatch | Canonicalises payload + every option (uppercase, no commas, PAF-expanded). Exact match is clicked; otherwise the first option is clicked and a `console.warn` is logged. |
| 4 | Plan card missing | `attemptPlanSelection` throws `Plan card "<name>" not found. Available plans: …`; the Steps 2–5 recovery wrapper reloads and retries. |
| 5 | Plan click silently ignored | Retries the click for up to 40 s (1/2/3 s) until the button reads "Selected" **and** the sticky-cart total > $0.00; dismisses "Heads up!" whenever it appears. Never re-clicks a plan that is already selected and in the cart (it would toggle off). |
| 6 | Cart drops to $0.00 after choosing a router | `ensurePlanInCart("router-select")` re-runs plan selection up to 3×, then fails with **`nbn plan missing from cart (router-select)`**. |
| 7 | Cart $0.00 at Order Now | `ensurePlanInCart("order-now")` — same, **`nbn plan missing from cart (order-now)`**. |
| 8 | Order Now click is a no-op | Re-checks the cart and clicks again — up to 3 retries — until the no-modem popup or `checkout/login` appears. |
| 9 | Router-without-plan popup (`#modem-select-withoutNBN`) | Throws **`Portal blocked checkout: cart contains a router but no nbn plan`** (checked at Order Now and at the email step). |
| 10 | Email OTP required (`#otp_code`) | Throws **`Email OTP verification required — submit sale manually`**. |
| 11 | Checkout-email Next is a no-op | Up to 3 retries of Next, racing OTP / contact-details URL / router-without-plan each time. |
| 12 | Reactive form wipes fields asynchronously | `fillAndAssert` refills until `inputValue()` matches (20 s); values are re-asserted right before each Next click; DOB is retyped through its mask until it reads `DD/MM/YYYY`. |
| 13 | Self Care Portal radio not sticking | `checkUntilChecked(label[for='print'], #print, 15 s)`. |
| 14 | AVC ID validation fails | Waits 5 s for a positive message after Check; otherwise ticks `#avcidProvideLater`. Provider falls back to `--Other--` when the payload provider is not in the list. |
| 15 | Process Order & Pay is a no-op | `retryUntil` click → URL contains `checkout/donate` (30 s, 1/2/3 s), dismissing "Heads up!" (it appears on this page after `evaluate-ntd`). |
| 16 | Missing card details | Checked at test start **and** at Step 16: **`Tangerine journey requires payment.card details but none were found`**. |
| 17 | Till Payments iframes slow / missing | Waits up to 60 s for both PAN and CVV iframes; fails with Playwright's visibility error otherwise. |
| 18 | 3-D Secure poll timeout | `expect.poll` for 60 s looking for `#transactionId` (frictionless) or an ACS `<select>` with an "Authenticated" option in a new tab / any frame; fails with `3-D Secure: neither #transactionId nor an ACS challenge appeared`. |
| 19 | Transaction ID never shows | Waits 60 s for `#transactionId`; fails with `#transactionId not visible within 60 s (url …)`. CSV row is marked `failed: …`. |
| 20 | Address → plan flow fails 3× | Steps 2–5 run up to 3 times with `page.reload()` between attempts; after the 3rd failure the last error is re-thrown. |
