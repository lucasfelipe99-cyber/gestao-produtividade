import { one, many } from './db.js';
import { addDays } from './dates.js';

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Métricas da jornada para um conjunto de períodos (minutos desde 00:00 do dia local)
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

// Almoço efetivo: começa no horário configurado, mas se uma atividade está em andamento nesse horário
// ele é empurrado para quando ela (e as que emendam nela) terminar. A duração é sempre a configurada (ex.: 1h).
export function effectiveLunch(entries, ls, le) {
  if (ls == null || le == null || le <= ls) return null;
  const dur = le - ls;
  let start = ls, moved = true, guard = 0;
  while (moved && guard++ < 50) {
    moved = false;
    for (const e of entries) {
      // atividade cobrindo o início do almoço (tolerância de 1 min para segmentos emendados, ex.: troca de subtarefa)
      if (e.start_min <= start + 1 && e.end_min > start + 0.01) { start = e.end_min; moved = true; }
    }
  }
  return { from: Math.round(start * 10) / 10, to: Math.round((start + dur) * 10) / 10, delayed_min: Math.round(start - ls) };
}

// ls/le = almoço: trabalho no almoço conta como hora extra; almoço não conta como ociosidade
// opts.startMin = início considerado do dia (atraso e inatividade só contam a partir dele)
// opts.endMin   = até onde contar inatividade (fim da jornada, ou "agora" se o dia está em andamento)
export function dayMetrics(entries, ws, we, ls0 = null, le0 = null, opts = {}) {
  const lunchWin = effectiveLunch(entries, ls0, le0);
  const ls = lunchWin?.from ?? null, le = lunchWin?.to ?? null;
  const hasLunch = ls != null && le != null && le > ls;
  const startMin = Math.max(ws, opts.startMin ?? ws);
  if (!entries.length) return { first_start: null, last_end: null, delay_min: 0, worked_min: 0, inside_min: 0, overtime_min: 0, before_min: 0, after_min: 0, lunch_min: 0, idle_min: 0, idle_gaps: [], lunch_from: ls0, lunch_to: le0, lunch_delayed_min: 0, start_min: startMin };
  const sorted = [...entries].sort((a, b) => a.start_min - b.start_min);
  const first = sorted[0].start_min;
  const last = Math.max(...sorted.map((e) => e.end_min));
  let worked = 0, inside = 0, before = 0, after = 0, lunch = 0;
  for (const e of sorted) {
    const dur = Math.max(0, e.end_min - e.start_min);
    worked += dur;
    const inWork = overlap(e.start_min, e.end_min, ws, we);
    const inLunch = hasLunch ? overlap(e.start_min, e.end_min, ls, le) : 0;
    inside += inWork - inLunch;
    lunch += inLunch;
    before += Math.max(0, Math.min(e.end_min, ws) - e.start_min);
    after += Math.max(0, e.end_min - Math.max(e.start_min, we));
  }
  // lacunas sem apontamento dentro da jornada (fora do almoço), da 1ª atividade até o fim da jornada / agora
  const gStart = Math.max(startMin, first);
  const gEnd = Math.min(we, Math.max(last, opts.endMin ?? we));
  const busy = sorted.map((e) => [e.start_min, e.end_min]);
  if (hasLunch) busy.push([ls, le]);
  busy.sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cur = gStart;
  for (const [a, b] of busy) {
    if (b <= cur) continue;
    if (a > cur && a - cur >= 1) gaps.push({ from: Math.round(cur * 10) / 10, to: Math.round(Math.min(a, gEnd) * 10) / 10 });
    cur = Math.max(cur, b);
    if (cur >= gEnd) break;
  }
  if (gEnd - cur >= 1) gaps.push({ from: Math.round(cur * 10) / 10, to: Math.round(gEnd * 10) / 10 });
  const idleGaps = gaps.filter((g) => g.to - g.from >= 1);
  const idle = idleGaps.reduce((s, g) => s + (g.to - g.from), 0);
  return {
    first_start: first, last_end: last, start_min: startMin,
    delay_min: 0, // atraso não é mais calculado: a 1ª tarefa conta do início da jornada até a conclusão
    worked_min: Math.round(worked), inside_min: Math.round(inside), overtime_min: Math.round(before + after + lunch),
    before_min: Math.round(before), after_min: Math.round(after), lunch_min: Math.round(lunch), idle_min: Math.round(idle),
    idle_gaps: idleGaps,
    lunch_from: ls, lunch_to: le, lunch_delayed_min: lunchWin?.delayed_min || 0,
  };
}

export async function timeline({ companyId, date, today, userId }) {
  const c = await one(
    `SELECT timezone, to_char(work_start,'HH24:MI') AS work_start, to_char(work_end,'HH24:MI') AS work_end,
       to_char(lunch_start,'HH24:MI') AS lunch_start, to_char(lunch_end,'HH24:MI') AS lunch_end FROM companies WHERE id=$1`, [companyId]);
  const tz = c.timezone;
  const nowRow = await one(`SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS d,
    EXTRACT(EPOCH FROM ((now() AT TIME ZONE $1) - date_trunc('day', now() AT TIME ZONE $1)))/60 AS m`, [tz]);
  const starts = await many(`SELECT to_char(day,'YYYY-MM-DD') AS day, to_char(start_time,'HH24:MI') AS start_time, reason
    FROM day_starts WHERE company_id=$1 AND day BETWEEN $2 AND $3`, [companyId, addDays(date, -6), date]);
  const startOf = (d) => starts.find((x) => x.day === d);
  // opções do dia: início considerado e até onde contar inatividade
  const optsFor = (d) => {
    const st = startOf(d);
    const o = { startMin: st ? toMin(st.start_time) : undefined };
    if (d === nowRow.d) o.endMin = Number(nowRow.m);
    else if (d > nowRow.d) o.endMin = 0;
    return o;
  };
  const ws = toMin(c.work_start), we = toMin(c.work_end), ls = toMin(c.lunch_start), le = toMin(c.lunch_end);
  const from = addDays(date, -6);
  const params = [companyId, from, addDays(date, 1), tz];
  if (userId) params.push(userId);
  const users = await many(
    `SELECT id, name FROM users WHERE company_id=$1 AND active ${userId ? 'AND id=$2' : ''} ORDER BY name`,
    userId ? [companyId, userId] : [companyId]);
  // períodos que tocam o intervalo [from, date+1) no fuso da empresa
  const rows = await many(
    `SELECT e.id, e.user_id, e.task_id, e.subtask_id, e.source, (e.ended_at IS NULL) AS running,
       t.title AS task_title, s.title AS subtask_title, COALESCE(c.color,'#579bfc') AS color, c.name AS category,
       to_char(e.started_at AT TIME ZONE $4, 'YYYY-MM-DD') AS day,
       EXTRACT(EPOCH FROM ((e.started_at AT TIME ZONE $4) - date_trunc('day', e.started_at AT TIME ZONE $4)))/60 AS start_min,
       EXTRACT(EPOCH FROM ((COALESCE(e.ended_at, now()) AT TIME ZONE $4) - date_trunc('day', e.started_at AT TIME ZONE $4)))/60 AS end_min,
       e.started_at, COALESCE(e.ended_at, now()) AS ended_at
     FROM time_entries e JOIN tasks t ON t.id=e.task_id LEFT JOIN subtasks s ON s.id=e.subtask_id LEFT JOIN categories c ON c.id=t.category_id
     WHERE e.company_id=$1 AND e.started_at < ($3::date::timestamp AT TIME ZONE $4)
       AND COALESCE(e.ended_at, now()) > ($2::date::timestamp AT TIME ZONE $4)
       ${userId ? 'AND e.user_id=$5' : ''}
     ORDER BY e.started_at`, params);
  for (const r of rows) { r.start_min = Math.round(r.start_min * 10) / 10; r.end_min = Math.min(Math.round(r.end_min * 10) / 10, 1440); }

  // tarefas com horário previsto no dia (marcadores)
  const planned = await many(
    `SELECT t.id, t.assignee_id, t.title, to_char(t.scheduled_time,'HH24:MI') AS scheduled_time, t.status
     FROM tasks t WHERE t.company_id=$1 AND t.due_date=$2 AND t.scheduled_time IS NOT NULL AND t.status <> 'cancelled' ${userId ? 'AND t.assignee_id=$3' : ''}`,
    userId ? [companyId, date, userId] : [companyId, date]);

  // horários de conclusão das tarefas no dia (marcadores na linha do tempo)
  const completions = await many(
    `SELECT t.id, t.assignee_id, t.title,
       EXTRACT(EPOCH FROM ((t.completed_at AT TIME ZONE $3) - ($2::date)::timestamp))/60 AS min,
       EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id=t.id AND e.source<>'inferred') AS timed
     FROM tasks t WHERE t.company_id=$1 AND t.status='done' AND t.completed_at IS NOT NULL
       AND (t.completed_at AT TIME ZONE $3)::date = $2::date ${userId ? 'AND t.assignee_id=$4' : ''}
     ORDER BY t.completed_at`,
    userId ? [companyId, date, tz, userId] : [companyId, date, tz]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const people = users.map((u) => {
    const mine = rows.filter((r) => r.user_id === u.id);
    const todayEntries = mine.filter((r) => r.day === date);
    const week = days.map((d) => ({ date: d, ...dayMetrics(mine.filter((r) => r.day === d), ws, we, ls, le, optsFor(d)) }));
    return {
      id: u.id, name: u.name,
      entries: todayEntries,
      planned: planned.filter((p) => p.assignee_id === u.id).map((p) => ({ ...p, min: toMin(p.scheduled_time) })),
      done: completions.filter((d) => d.assignee_id === u.id).map((d) => ({ id: d.id, title: d.title, timed: d.timed, min: Math.round(Number(d.min) * 10) / 10 })),
      metrics: dayMetrics(todayEntries, ws, we, ls, le, optsFor(date)),
      week,
    };
  });
  const active = people.filter((p) => p.entries.length);
  const avg = (k) => (active.length ? Math.round(active.reduce((s, p) => s + p.metrics[k], 0) / active.length) : 0);
  return {
    date, today, work_start: c.work_start, work_end: c.work_end, lunch_start: c.lunch_start, lunch_end: c.lunch_end,
    day_start: startOf(date) || null,
    ws, we, ls, le, expected_min: (we - ws) - (le - ls), days, people,
    summary: {
      people_with_time: active.length,
      late_count: active.filter((p) => p.metrics.delay_min > 0).length,
      avg_delay_min: avg('delay_min'),
      total_worked_min: active.reduce((s, p) => s + p.metrics.worked_min, 0),
      total_overtime_min: active.reduce((s, p) => s + p.metrics.overtime_min, 0),
      total_idle_min: active.reduce((s, p) => s + p.metrics.idle_min, 0),
    },
  };
}
