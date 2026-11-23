// Number and date formatting for every screen (design-system layer). en-US, US Eastern, integer arithmetic for money.
// Units are always written out: "$18 per month", "48 days", "12.5%". Money is never set in a monospace face (see .ui-num in primitives.css).
// The page never computes a business number: cents arrive as integers from the server and are only written out here.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TZ = 'America/New_York';
const DASH = '—';

/** @param {number} n integer */
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Integer cents to dollars. 'auto' (default) drops ".00": 134400 -> "$1,344", 215080 -> "$2,150.80", 0 -> "$0".
 * 'always' keeps cents: "$1,344.00". Anything that is not an integer reads as an em dash.
 * @param {number | null | undefined} cents
 * @param {{ cents?: 'auto' | 'always' }} [opts]
 */
export function money(cents, opts = {}) {
  if (cents == null || !Number.isInteger(cents)) return DASH;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100), rest = abs % 100;
  const showCents = opts.cents === 'always' || rest !== 0;
  return `${cents < 0 ? '-' : ''}$${group(whole)}${showCents ? '.' + String(rest).padStart(2, '0') : ''}`;
}
/** "$18 per month". @param {number | null | undefined} cents @param {{ cents?: 'auto' | 'always' }} [opts] */
export const moneyPerMonth = (cents, opts) => (cents == null || !Number.isInteger(cents) ? DASH : `${money(cents, opts)} per month`);
/** "$1,344 per year". @param {number | null | undefined} cents @param {{ cents?: 'auto' | 'always' }} [opts] */
export const moneyPerYear = (cents, opts) => (cents == null || !Number.isInteger(cents) ? DASH : `${money(cents, opts)} per year`);

/** "1,234". @param {number | null | undefined} n */
export const count = (n) => (n == null || !Number.isInteger(n) ? DASH : (n < 0 ? '-' : '') + group(Math.abs(n)));
/** "3 members", "1 member". @param {number} n @param {string} one @param {string} [many] */
export const plural = (n, one, many = one + 's') => `${count(n)} ${n === 1 ? one : many}`;

/**
 * A percentage that is already in percent points: 12.5 -> "12.5%", 12.5 with digits 0 -> "13%". Never a bare number.
 * @param {number | null | undefined} pct @param {{ digits?: number }} [opts]
 */
export function percent(pct, opts = {}) {
  if (pct == null || !Number.isFinite(pct)) return DASH;
  const d = opts.digits ?? (Number.isInteger(pct) ? 0 : 1);
  const f = 10 ** d, r = Math.round(Math.abs(pct) * f + 1e-9) / f;
  return `${pct < 0 && r !== 0 ? '-' : ''}${r.toFixed(d)}%`;
}
/** "x of y" as a percentage, integer arithmetic on the inputs. @param {number} part @param {number} whole @param {{ digits?: number }} [opts] */
export const percentOf = (part, whole, opts) => (whole > 0 ? percent((part * 100) / whole, opts) : DASH);

/** @param {string | undefined | null} d @returns {RegExpExecArray | null} */
const ymd = (d) => /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
const dayOnly = (/** @type {string} */ s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * The calendar parts of a value. A bare date ("2026-12-31") is taken as written; an instant (with a time) is read in US Eastern.
 * @param {string | undefined | null} v @returns {{ y: number, m: number, d: number, hh?: number, mm?: number, ss?: number } | null}
 */
function parts(v) {
  if (!v) return null;
  if (dayOnly(v)) { const m = ymd(v); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  /** @type {Record<string, number>} */ const o = {};
  for (const p of f.formatToParts(t)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, hh: o.hour % 24, mm: o.minute, ss: o.second };
}

/** A hash for display: the first 12 characters, never an ellipsis. Shown as `idCode(shortHash(h))`. @param {string | undefined | null} h */
export const shortHash = (h) => (typeof h === 'string' && h ? h.slice(0, 12) : DASH);

/** "Dec 31, 2026". @param {string | undefined | null} v */
export function dateLong(v) { const p = parts(v); return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : DASH; }
/** "Dec 31" (table cells). @param {string | undefined | null} v */
export function dateShort(v) { const p = parts(v); return p ? `${MONTHS[p.m - 1]} ${p.d}` : DASH; }
/** @param {number} h @param {number} m */
const clock12 = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
/** "Oct 22, 10:00 AM ET" (an instant, read in US Eastern). @param {string | undefined | null} iso */
export function dateTime(iso) {
  const p = parts(iso);
  if (!p || p.hh == null || p.mm == null) return DASH;
  return `${MONTHS[p.m - 1]} ${p.d}, ${clock12(p.hh, p.mm)} ${p.hh < 12 ? 'AM' : 'PM'} ET`;
}
/** "10:00:12 AM" (an instant, US Eastern). @param {string | undefined | null} iso */
export function timeOfDay(iso) {
  const p = parts(iso);
  if (!p || p.hh == null || p.mm == null || p.ss == null) return DASH;
  return `${clock12(p.hh, p.mm)}:${String(p.ss).padStart(2, '0')} ${p.hh < 12 ? 'AM' : 'PM'}`;
}

/** "48 days", "1 day", "0 days". @param {number | null | undefined} n */
export const days = (n) => (n == null || !Number.isInteger(n) ? DASH : `${count(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`);

/** Whole days from one calendar date to another (later minus earlier), DST-safe. @param {string} from @param {string} to */
export function daysBetween(from, to) {
  const a = ymd(from), b = ymd(to);
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000);
}
