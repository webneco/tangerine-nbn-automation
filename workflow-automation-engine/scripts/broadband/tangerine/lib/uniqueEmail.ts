import fs from 'fs';
import path from 'path';

const DEFAULT_DOMAIN = 'yopmail.com';
const MAX_LOCAL = 64;
const CSV_FILE = path.resolve(__dirname, '..', '..', '..', '..', 'run-logs', 'emails-used.csv');
const CSV_HEADER = 'timestamp,email,plan,routerModel,status,transactionId';

const pad = (n: number) => String(n).padStart(2, '0');

function stamp(d = new Date()): string {
  return (
    pad(d.getFullYear() % 100) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function randomSuffix(len = 3): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * Build `<local>.<yyMMddHHmmss><3 random>@<domain>` from the payload email.
 *
 * Env overrides:
 *   UNIQUE_EMAIL  "true" (default) | "false" → return baseEmail unchanged
 *   EMAIL_DOMAIN  overrides the domain
 *   EMAIL_PREFIX  overrides the local part
 */
export function generateUniqueEmail(baseEmail: string): string {
  if ((process.env.UNIQUE_EMAIL ?? 'true').toLowerCase() === 'false') return baseEmail;

  const [rawLocal = '', rawDomain = ''] = String(baseEmail ?? '').trim().split('@');
  const domain = (process.env.EMAIL_DOMAIN || rawDomain || DEFAULT_DOMAIN).toLowerCase().replace(/[^a-z0-9.-]/g, '');

  let local = (process.env.EMAIL_PREFIX || rawLocal).split('+')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!local) local = 'tangerine';

  const suffix = `${stamp()}${randomSuffix()}`; // 15 chars
  local = local.slice(0, MAX_LOCAL - suffix.length - 1);
  return `${local}.${suffix}@${domain || DEFAULT_DOMAIN}`;
}

// ---------- run-logs/emails-used.csv ----------

export interface EmailLogRow {
  timestamp: string;
  email: string;
  plan: string;
  routerModel: string;
  status: string;
  transactionId: string;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function appendEmailLog(row: EmailLogRow): void {
  fs.mkdirSync(path.dirname(CSV_FILE), { recursive: true });
  if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, CSV_HEADER + '\n');
  const line = [row.timestamp, row.email, row.plan, row.routerModel, row.status, row.transactionId].map(csvCell).join(',');
  fs.appendFileSync(CSV_FILE, line + '\n');
}

/** Update status / transactionId of the row matching `email` (latest occurrence). */
export function updateEmailLog(email: string, patch: Partial<Pick<EmailLogRow, 'status' | 'transactionId'>>): void {
  if (!fs.existsSync(CSV_FILE)) return;
  const lines = fs.readFileSync(CSV_FILE, 'utf8').split(/\r?\n/);
  for (let i = lines.length - 1; i > 0; i--) {
    if (!lines[i]) continue;
    const cells = parseCsvLine(lines[i]);
    if (cells[1] !== email) continue;
    if (patch.status !== undefined) cells[4] = patch.status;
    if (patch.transactionId !== undefined) cells[5] = patch.transactionId;
    lines[i] = cells.map(csvCell).join(',');
    break;
  }
  fs.writeFileSync(CSV_FILE, lines.join('\n'));
}

export const EMAIL_LOG_FILE = CSV_FILE;
