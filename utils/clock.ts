/**
 * The single source of "now" and "today" for the client domain layer (RP-03#AC3).
 *
 * Every view-model and hook that needs the current date reads it from here, so the same-number
 * guarantee holds (People, Allocations and Capacity Outlook all agree on what "today" is) and
 * tests can pin the date with `setClock()`.
 *
 * Pure: no React, DOM, Node or Netlify imports.
 */
import type { ISODate, ISODateTime } from '../shared/contracts/dto';

type NowFn = () => Date;

const systemNow: NowFn = () => new Date();
let current: NowFn = systemNow;

/** The current instant. */
export function now(): Date {
  return current();
}

/** The current instant as an RFC 3339 UTC string. */
export function nowIso(): ISODateTime {
  return current().toISOString();
}

/** Today's calendar date in the user's local time zone, as 'YYYY-MM-DD'. */
export function today(): ISODate {
  return toIsoDate(current());
}

/** Formats a Date as a local 'YYYY-MM-DD' (the calendar day the user sees). */
export function toIsoDate(d: Date): ISODate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Pins the clock (tests, demo screenshots). Pass a Date, an ISO string, or a function; pass
 * nothing to restore the system clock.
 */
export function setClock(value?: Date | string | NowFn): void {
  if (value === undefined) current = systemNow;
  else if (typeof value === 'function') current = value;
  else {
    const fixed = typeof value === 'string' ? parseFixed(value) : new Date(value.getTime());
    current = () => new Date(fixed.getTime());
  }
}

/** 'YYYY-MM-DD' is read as local midnight (so `today()` returns that day); anything else via Date. */
function parseFixed(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return new Date(value);
}
