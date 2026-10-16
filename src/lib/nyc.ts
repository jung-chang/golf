// NYC public courses: who books where. Shared by the Worker and the app.
// Tee times come from TeeItUp/Kenna; one request per tenant covers all its courses.

export type Borough = 'Bronx' | 'Queens' | 'Brooklyn' | 'Staten Island';
export type Tenant = 'golf-nyc' | 'pelham-bay-split-rock' | 'dyker-beach-golf-course' | 'marine-park-golf-course';

export type NycCourse = {
  code: string;
  name: string;
  borough: Borough;
  /** null = not on TeeItUp (no live times; link out only). */
  tenant: Tenant | null;
  facilityId: number | null;
  /** How many days ahead it books (today = day 0). */
  maxDays: number;
  /** Only for confirmed sub-70 par courses; never inferred. */
  badge?: 'pitch & putt' | 'short course';
  /** Booking page for courses not on TeeItUp. */
  siteUrl?: string;
  /** Shot-tracking course file (courses/<id>.json), if one exists. */
  courseId?: string;
};

export const KENNA_URL = 'https://phx-api-be-east-1b.kenna.io/v2/tee-times';
export const MAX_DAYS = 14;
export const TENANTS: Tenant[] = ['golf-nyc', 'pelham-bay-split-rock', 'dyker-beach-golf-course', 'marine-park-golf-course'];

export const NYC_COURSES: NycCourse[] = [
  { code: 'VCT', name: 'Van Cortlandt', borough: 'Bronx', tenant: 'golf-nyc', facilityId: 5043, maxDays: MAX_DAYS },
  { code: 'SPL', name: 'Split Rock', borough: 'Bronx', tenant: 'pelham-bay-split-rock', facilityId: 19264, maxDays: MAX_DAYS },
  { code: 'PEL', name: 'Pelham Bay', borough: 'Bronx', tenant: 'pelham-bay-split-rock', facilityId: 4111, maxDays: MAX_DAYS },
  { code: 'MOS', name: 'Mosholu', borough: 'Bronx', tenant: null, facilityId: null, maxDays: MAX_DAYS },
  { code: 'FLU', name: 'Flushing Meadows', borough: 'Queens', tenant: 'golf-nyc', facilityId: 16016, maxDays: MAX_DAYS, badge: 'pitch & putt' },
  { code: 'CLR', name: 'Clearview', borough: 'Queens', tenant: 'golf-nyc', facilityId: 4047, maxDays: MAX_DAYS, courseId: 'clearview-park' },
  { code: 'KIS', name: 'Kissena', borough: 'Queens', tenant: 'golf-nyc', facilityId: 5046, maxDays: MAX_DAYS, badge: 'short course' },
  { code: 'DGL', name: 'Douglaston', borough: 'Queens', tenant: 'golf-nyc', facilityId: 5044, maxDays: MAX_DAYS, badge: 'short course' },
  { code: 'FOR', name: 'Forest Park', borough: 'Queens', tenant: 'golf-nyc', facilityId: 5045, maxDays: MAX_DAYS },
  { code: 'SLV', name: 'Silver Lake', borough: 'Staten Island', tenant: 'golf-nyc', facilityId: 4757, maxDays: MAX_DAYS, badge: 'short course' },
  { code: 'SSO', name: 'South Shore', borough: 'Staten Island', tenant: 'golf-nyc', facilityId: 4051, maxDays: MAX_DAYS },
  { code: 'LTO', name: 'La Tourette', borough: 'Staten Island', tenant: 'golf-nyc', facilityId: 4049, maxDays: MAX_DAYS },
  { code: 'DYK', name: 'Dyker Beach', borough: 'Brooklyn', tenant: 'dyker-beach-golf-course', facilityId: 4048, maxDays: 10 },
  { code: 'MPK', name: 'Marine Park', borough: 'Brooklyn', tenant: 'marine-park-golf-course', facilityId: 4857, maxDays: MAX_DAYS },
];

/**
 * Course picker: four borough panels around Manhattan, each laid out roughly as on a map.
 * null = an empty cell; the cells nearest the middle are left empty so the Manhattan hub sits there.
 */
export const PICKER: { borough: Borough; rows: (string | null)[][] }[] = [
  { borough: 'Bronx', rows: [['VCT', 'SPL'], ['MOS', 'PEL']] },
  { borough: 'Queens', rows: [['CLR', 'DGL'], ['FLU', 'KIS'], [null, 'FOR']] },
  { borough: 'Staten Island', rows: [['SLV', null], ['SSO', 'LTO']] },
  { borough: 'Brooklyn', rows: [['DYK', 'MPK']] },
];

export const courseByCode = (code: string) => NYC_COURSES.find((c) => c.code === code);
export const courseByFacility = (id: number) => NYC_COURSES.find((c) => c.facilityId === id);

/** TeeItUp has no per-time deep links; open the course's page for that date. */
export function bookingUrl(c: NycCourse, date: string): string | undefined {
  if (c.tenant && c.facilityId) return `https://${c.tenant}.book.teeitup.com/?course=${c.facilityId}&date=${date}`;
  return c.siteUrl;
}

/** Today's date in New York as YYYY-MM-DD. */
export const nyToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Hour (0–23) and minute on the New York clock. */
export function nyClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { hour: get('hour'), minute: get('minute') };
}

/** YYYY-MM-DD plus n days. */
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Day of the week for a YYYY-MM-DD date, 0 = Sunday. */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Whole days from today (NY) to a YYYY-MM-DD date. */
export const daysOut = (date: string, now = new Date()) =>
  Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${nyToday(now)}T12:00:00Z`)) / 86_400_000);

export const canBook = (c: NycCourse, date: string, now = new Date()) => {
  const d = daysOut(date, now);
  return d >= 0 && d <= c.maxDays;
};
