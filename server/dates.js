// Utilitários de datas trabalhando com strings 'YYYY-MM-DD' (sem fuso)
export function todayIn(tz = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const toD = (s) => new Date(s + 'T00:00:00Z');
const toS = (d) => d.toISOString().slice(0, 10);
export function addDays(s, n) { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toS(d); }
export function weekday(s) { return toD(s).getUTCDay(); } // 0=dom..6=sáb
export function isBusinessDay(s) { const w = weekday(s); return w !== 0 && w !== 6; }
export function nextBusinessDayOnOrAfter(s) { let d = s; while (!isBusinessDay(d)) d = addDays(d, 1); return d; }
export function weekStart(s) { const w = weekday(s); return addDays(s, w === 0 ? -6 : 1 - w); } // segunda-feira
export function addMonths(s, n) {
  const d = toD(s); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toS(d);
}
export function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(toD(s)); }
