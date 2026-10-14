/** "12/30" → "12/2030"; "12/2030" stays as-is. Month must be 01–12. */
export function toMMYYYY(expiry: string): string {
  const m = String(expiry ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) throw new Error(`Invalid card expiry "${expiry}" — expected MM/YY or MM/YYYY`);
  const month = m[1].padStart(2, '0');
  const n = Number(month);
  if (n < 1 || n > 12) throw new Error(`Invalid card expiry month "${m[1]}" — must be 01–12`);
  const year = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${month}/${year}`;
}
