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

FAILURE_TABLE_PLACEHOLDER
