import fs from 'fs';
import path from 'path';
import type { JobPayload, PaymentCard } from './types';

const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr'];
const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const ROUTER_MODELS = ['BYO Modem', 'Amazon eero 7', 'NetComm'];
const DEFAULT_DATA_FILE = path.resolve(__dirname, '..', 'tangerineData.json');

const isBlank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === '';

/**
 * Load the job payload. Priority:
 *   1. env JOB_PAYLOAD      (JSON string)
 *   2. env JOB_PAYLOAD_FILE (path to JSON file)
 *   3. tangerineData.json next to the spec
 */
export function loadPayload(): JobPayload {
  let raw: string;
  let source: string;
  if (process.env.JOB_PAYLOAD && process.env.JOB_PAYLOAD.trim()) {
    raw = process.env.JOB_PAYLOAD;
    source = 'env JOB_PAYLOAD';
  } else if (process.env.JOB_PAYLOAD_FILE && process.env.JOB_PAYLOAD_FILE.trim()) {
    const file = path.resolve(process.env.JOB_PAYLOAD_FILE);
    raw = fs.readFileSync(file, 'utf8');
    source = `JOB_PAYLOAD_FILE ${file}`;
  } else {
    raw = fs.readFileSync(DEFAULT_DATA_FILE, 'utf8');
    source = DEFAULT_DATA_FILE;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`Invalid JSON payload from ${source}: ${(e as Error).message}`);
  }
  validatePayload(parsed, source);
  return parsed as JobPayload;
}

/** Validate every required field and throw ONE error listing all problems. */
export function validatePayload(p: any, source = 'payload'): asserts p is JobPayload {
  const errors: string[] = [];
  const req = (value: unknown, field: string) => {
    if (isBlank(value)) errors.push(`${field} is required`);
  };

  req(p?.portal?.url, 'portal.url');
  if (!isBlank(p?.portal?.url) && !/^https?:\/\//i.test(p.portal.url)) errors.push('portal.url must be an http(s) URL');

  const c = p?.customer ?? {};
  req(c.title, 'customer.title');
  if (!isBlank(c.title) && !TITLES.includes(c.title)) errors.push(`customer.title must be one of ${TITLES.join('|')}`);
  req(c.firstName, 'customer.firstName');
  req(c.lastName, 'customer.lastName');
  req(c.email, 'customer.email');
  if (!isBlank(c.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.push('customer.email is not a valid email');
  req(c.phone, 'customer.phone');
  if (!isBlank(c.phone) && !/^(\+?61|0)4\d{8}$/.test(String(c.phone).replace(/[\s-]/g, '')))
    errors.push('customer.phone must be an AU mobile (04XXXXXXXX)');
  req(c.dateOfBirth, 'customer.dateOfBirth');
  if (!isBlank(c.dateOfBirth) && !/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/.test(c.dateOfBirth))
    errors.push('customer.dateOfBirth must be DD/MM/YYYY');

  const a = p?.connectionAddress?.mainAddress ?? {};
  req(a.fullAddress, 'connectionAddress.mainAddress.fullAddress');
  if (!isBlank(a.streetNumber) && isBlank(a.streetName))
    errors.push('connectionAddress.mainAddress.streetName is required when streetNumber is set');
  if (!isBlank(a.state) && !STATES.includes(String(a.state).toUpperCase()))
    errors.push(`connectionAddress.mainAddress.state must be one of ${STATES.join('|')}`);

  req(p?.plan?.name, 'plan.name');

  const r = p?.addOns?.router;
  if (typeof r?.enabled !== 'boolean') errors.push('addOns.router.enabled is required (boolean)');
  if (r?.enabled === true) {
    req(r.model, 'addOns.router.model');
    if (!isBlank(r.model) && !ROUTER_MODELS.some((m) => m.toLowerCase() === String(r.model).toLowerCase()))
      errors.push(`addOns.router.model must be one of ${ROUTER_MODELS.map((m) => `"${m}"`).join(' | ')}`);
  }

  // Missing card fields are reported by getPaymentCard() → the caller throws
  // "Tangerine journey requires payment.card details but none were found".
  // Here we only validate the format of fields that were supplied.
  const card = p?.payment?.card ?? {};
  if (!isBlank(card.expiry) && !/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/.test(card.expiry))
    errors.push('payment.card.expiry must be MM/YY or MM/YYYY');
  if (!isBlank(card.cardNumber) && !/^\d{12,19}$/.test(String(card.cardNumber).replace(/\s/g, '')))
    errors.push('payment.card.cardNumber must be 12–19 digits');
  if (!isBlank(card.cvv) && !/^\d{3,4}$/.test(String(card.cvv))) errors.push('payment.card.cvv must be 3–4 digits');

  if (errors.length) {
    throw new Error(`Invalid job payload (${source}):\n  - ${errors.join('\n  - ')}`);
  }
}

/** Returns the card details, or null when any card field is missing. */
export function getPaymentCard(payload: JobPayload): PaymentCard | null {
  const c = payload.payment?.card;
  if (!c || isBlank(c.cardNumber) || isBlank(c.cvv) || isBlank(c.expiry) || isBlank(c.nameOnCard)) return null;
  return {
    cardNumber: String(c.cardNumber).replace(/\s/g, ''),
    cvv: String(c.cvv),
    expiry: String(c.expiry),
    nameOnCard: String(c.nameOnCard),
  };
}
