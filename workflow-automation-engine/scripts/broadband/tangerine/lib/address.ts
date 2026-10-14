import { PAF_STREET_TYPES } from './paf';

/**
 * Canonical form for comparing addresses: uppercase, no commas, street-type
 * abbreviations expanded token by token via the PAF map, whitespace collapsed.
 */
export function canonicaliseAddress(s: string | null | undefined): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => PAF_STREET_TYPES[tok.replace(/\.$/, '')] ?? tok)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
