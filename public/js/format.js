// Display formatting only. The page never computes a business number: money arrives as integer cents and is only written out here.

/** Integer cents to "$1,344.00" using integer arithmetic only. @param {number | null | undefined} cents */
export function money(cents) {
  if (cents == null || !Number.isInteger(cents)) return '—';
  const neg = cents < 0, abs = Math.abs(cents);
  const dollars = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** "Lorain" and "Lorain County" both read "Lorain County" (never "Lorain County County"). @param {string | null | undefined} c */
export const countyName = (c) => (c && !/county$/i.test(c) ? `${c} County` : (c ?? ''));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-12-07" to "Dec 7, 2026". @param {string | undefined} d */
export function dateLong(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(d ?? '');
}
/** "2026-12-31" to "12/31/2026". @param {string | undefined} d */
export function dateUs(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(d ?? '');
}

const TZ = 'America/New_York';
const fTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
const fShort = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const fIso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "10:03:12 AM" in New York. @param {string} iso */
export const etTime = (iso) => fTime.format(new Date(iso));
/** "Tue Oct 20, 10:00 AM ET". @param {string} iso */
export const etStamp = (iso) => `${fDay.format(new Date(iso))}, ${fShort.format(new Date(iso))} ET`;
/** "2025-11-12" (New York day). @param {string} iso */
export const etDay = (iso) => fIso.format(new Date(iso));
/** "Oct 19, 3:42 PM ET". @param {string} iso */
export const etShort = (iso) => `${new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date(iso))}, ${fShort.format(new Date(iso))} ET`;

/** "5 min 35 s". @param {number} ms */
export function duration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.trunc(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

/** First 12 hex characters of a hash. @param {string | undefined} hash */
export const shortHash = (hash) => (hash ? hash.slice(0, 12) : '—');

/** @param {string} id kebab/dotted id to a readable fallback label */
export const humanize = (id) => id.replace(/^(plan|prov|fac|drug|ben|county|ep|agent|carrier)-/, '').replace(/[-_.]/g, ' ');
