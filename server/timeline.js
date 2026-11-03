import { one, many } from './db.js';
import { addDays } from './dates.js';

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Métricas da jornada para um conjunto de períodos (minutos desde 00:00 do dia local)
export function dayMetrics(entries, ws, we) {
  if (!entries.length) return { first_start: null, last_end: null, delay_min: 0, worked_min: 0, inside_min: 0, overtime_min: 0, before_min: 0, after_min: 0, idle_min: 0 };
  const sorted = [...entries].sort((a, b) => a.start_min - b.start_min);
  const first = sorted[0].start_min;
  const last = Math.max(...sorted.map((e) => e.end_min));
  let worked = 0, inside = 0, before = 0, after = 0;
  for (const e of sorted) {
    const dur = Math.max(0, e.end_min - e.start_min);
    worked += dur;
    inside += Math.max(0, Math.min(e.end_min, we) - Math.max(e.start_min, ws));
    before += Math.max(0, Math.min(e.end_min, ws) - e.start_min);
    after += Math.max(0, e.end_min - Math.max(e.start_min, we));
  }
  // tempo sem apontamento dentro da jornada, entre a 1ª atividade e o fim (ou a última atividade)
  const winStart = Math.max(ws, first), winEnd = Math.min(we, last);
  const idle = Math.max(0, winEnd - winStart - inside);
  return {
    first_start: first, last_end: last,
    delay_min: Math.round(Math.max(0, first - ws)),
    worked_min: Math.round(worked), inside_min: Math.round(inside), overtime_min: Math.round(before + after),
    before_min: Math.round(before), after_min: Math.round(after), idle_min: Math.round(idle),
  };
}

export async function timeline({ companyId, date, today, userId }) {
  const c = await one(
    `SELECT timezone, to_char(work_start,'HH24:MI') AS work_start, to_char(work_end,'HH24:MI') AS work_end FROM companies WHERE id=$1`, [companyId]);
  const tz = c.timezone;
  const ws = toMin(c.work_start), we = toMin(c.work_end);
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

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const people = users.map((u) => {
    const mine = rows.filter((r) => r.user_id === u.id);
    const todayEntries = mine.filter((r) => r.day === date);
    const week = days.map((d) => ({ date: d, ...dayMetrics(mine.filter((r) => r.day === d), ws, we) }));
    return {
      id: u.id, name: u.name,
      entries: todayEntries,
      planned: planned.filter((p) => p.assignee_id === u.id).map((p) => ({ ...p, min: toMin(p.scheduled_time) })),
      metrics: dayMetrics(todayEntries, ws, we),
      week,
    };
  });
  const active = people.filter((p) => p.entries.length);
  const avg = (k) => (active.length ? Math.round(active.reduce((s, p) => s + p.metrics[k], 0) / active.length) : 0);
  return {
    date, today, work_start: c.work_start, work_end: c.work_end, ws, we, days, people,
    summary: {
      people_with_time: active.length,
      late_count: active.filter((p) => p.metrics.delay_min > 0).length,
      avg_delay_min: avg('delay_min'),
      total_worked_min: active.reduce((s, p) => s + p.metrics.worked_min, 0),
      total_overtime_min: active.reduce((s, p) => s + p.metrics.overtime_min, 0),
    },
  };
}
