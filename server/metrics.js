import { many, one } from './db.js';
import { addDays, weekStart, todayIn } from './dates.js';

// Constrói filtros comuns de tarefas. Retorna { where, params }
function taskFilter({ companyId, from, to, userId, categoryId, status, alias = 't' }) {
  const params = [companyId, from, to];
  const w = [`${alias}.company_id=$1`, `${alias}.planned_date BETWEEN $2 AND $3`, `${alias}.status <> 'cancelled'`];
  if (userId) { params.push(userId); w.push(`${alias}.assignee_id=$${params.length}`); }
  if (categoryId) { params.push(categoryId); w.push(`${alias}.category_id=$${params.length}`); }
  if (status) {
    if (status === 'overdue') w.push(`${alias}.status NOT IN ('done','cancelled')`);
    else { params.push(status); w.push(`${alias}.status=$${params.length}`); }
  }
  return { where: w.join(' AND '), params };
}

function entryFilter({ companyId, from, to, tz, userId, categoryId }) {
  const params = [companyId, from, to, tz];
  const w = ['e.company_id=$1', 'e.ended_at IS NOT NULL', '(e.started_at AT TIME ZONE $4)::date BETWEEN $2 AND $3'];
  if (userId) { params.push(userId); w.push(`e.user_id=$${params.length}`); }
  if (categoryId) { params.push(categoryId); w.push(`t.category_id=$${params.length}`); }
  return { where: w.join(' AND '), params };
}

const pct = (done, planned) => (planned > 0 ? Math.round((done / planned) * 1000) / 10 : 0);

// Atingimento = concluídas dentro do período ÷ planejadas para o período × 100 (canceladas excluídas)
export async function attainment({ companyId, tz, from, to, userId }) {
  const f = taskFilter({ companyId, from, to, userId });
  f.params.push(tz);
  const r = await one(
    `SELECT count(*)::int AS planned,
            count(*) FILTER (WHERE t.status='done' AND (t.completed_at AT TIME ZONE $${f.params.length})::date <= $3)::int AS done,
            count(*) FILTER (WHERE t.status NOT IN ('done'))::int AS pending
     FROM tasks t WHERE ${f.where}`, f.params);
  return { ...r, percent: pct(r.done, r.planned) };
}

export async function perUser({ companyId, tz, from, to, userId, categoryId }) {
  const today = todayIn(tz);
  const params = [companyId, from, to, tz, today];
  let extra = '';
  if (userId) { params.push(userId); extra += ` AND u.id=$${params.length}`; }
  let cat = '';
  if (categoryId) { params.push(categoryId); cat = ` AND t.category_id=$${params.length}`; }
  const rows = await many(
    `SELECT u.id, u.name, u.role,
       (SELECT count(*) FROM tasks t WHERE t.assignee_id=u.id AND t.planned_date BETWEEN $2 AND $3 AND t.status<>'cancelled'${cat})::int AS planned,
       (SELECT count(*) FROM tasks t WHERE t.assignee_id=u.id AND t.planned_date BETWEEN $2 AND $3 AND t.status='done'
          AND (t.completed_at AT TIME ZONE $4)::date <= $3${cat})::int AS done,
       (SELECT count(*) FROM tasks t WHERE t.assignee_id=u.id AND t.planned_date BETWEEN $2 AND $3 AND t.status NOT IN ('done','cancelled')
          AND ((t.kind='daily' AND t.planned_date < $5) OR (t.kind='weekly' AND t.due_date < $5))${cat})::int AS late,
       (SELECT COALESCE(sum(e.seconds),0) FROM time_entries e JOIN tasks t ON t.id=e.task_id WHERE e.user_id=u.id AND e.ended_at IS NOT NULL
          AND (e.started_at AT TIME ZONE $4)::date BETWEEN $2 AND $3${cat})::int AS seconds,
       (SELECT count(DISTINCT e.task_id) FROM time_entries e JOIN tasks t ON t.id=e.task_id WHERE e.user_id=u.id AND e.ended_at IS NOT NULL
          AND (e.started_at AT TIME ZONE $4)::date BETWEEN $2 AND $3${cat})::int AS tasks_with_time
     FROM users u WHERE u.company_id=$1 AND u.active${extra}
     ORDER BY u.name`, params);
  return rows.map((r) => ({
    ...r,
    percent: pct(r.done, r.planned),
    avg_seconds: r.tasks_with_time ? Math.round(r.seconds / r.tasks_with_time) : 0,
  }));
}

export async function dailySeries({ companyId, tz, from, to, userId, categoryId }) {
  const params = [companyId, from, to, tz];
  let fu = '', fe = '', fc = '';
  if (userId) { params.push(userId); fu = ` AND t.assignee_id=$${params.length}`; fe = ` AND e.user_id=$${params.length}`; }
  if (categoryId) { params.push(categoryId); fc = ` AND t.category_id=$${params.length}`; }
  const rows = await many(
    `WITH days AS (SELECT generate_series($2::date, $3::date, '1 day')::date AS d)
     SELECT to_char(d,'YYYY-MM-DD') AS date,
       (SELECT count(*) FROM tasks t WHERE t.company_id=$1 AND t.planned_date=d AND t.status<>'cancelled'${fu}${fc})::int AS planned,
       (SELECT count(*) FROM tasks t WHERE t.company_id=$1 AND t.planned_date=d AND t.status='done'${fu}${fc})::int AS planned_done,
       (SELECT count(*) FROM tasks t WHERE t.company_id=$1 AND t.status='done' AND (t.completed_at AT TIME ZONE $4)::date=d${fu}${fc})::int AS completed,
       (SELECT COALESCE(sum(e.seconds),0) FROM time_entries e JOIN tasks t ON t.id=e.task_id WHERE e.company_id=$1 AND e.ended_at IS NOT NULL
          AND (e.started_at AT TIME ZONE $4)::date=d${fe}${fc})::int AS seconds
     FROM days ORDER BY d`, params);
  return rows.map((r) => ({ ...r, percent: pct(r.planned_done, r.planned) }));
}

export async function weeklySeries({ companyId, tz, weeks = 8, userId, endDate }) {
  const end = weekStart(endDate || todayIn(tz));
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = addDays(end, -7 * i);
    const to = addDays(from, 6);
    const a = await attainment({ companyId, tz, from, to, userId });
    const s = await one(
      `SELECT COALESCE(sum(seconds),0)::int AS seconds FROM time_entries e WHERE e.company_id=$1 AND e.ended_at IS NOT NULL
       AND (e.started_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 ${userId ? 'AND e.user_id=$5' : ''}`,
      userId ? [companyId, from, to, tz, userId] : [companyId, from, to, tz]);
    out.push({ week: from, ...a, seconds: s.seconds });
  }
  return out;
}

export async function dashboard({ companyId, tz, from, to, userId }) {
  const today = todayIn(tz);
  const f = taskFilter({ companyId, from, to, userId });
  f.params.push(today);
  const counts = await one(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE status='done')::int AS done,
       count(*) FILTER (WHERE status='in_progress')::int AS in_progress,
       count(*) FILTER (WHERE status IN ('not_started','paused','late'))::int AS pending,
       count(*) FILTER (WHERE status='paused')::int AS paused,
       COALESCE(sum(estimated_minutes),0)::int AS estimated_minutes
     FROM tasks t WHERE ${f.where}`, f.params.slice(0, -1));
  // atrasadas agora (todas as tarefas abertas com data vencida)
  const lp = [companyId, today];
  if (userId) lp.push(userId);
  const late = await one(
    `SELECT count(*)::int AS n FROM tasks t WHERE t.company_id=$1 AND t.status NOT IN ('done','cancelled')
     AND ((t.kind='daily' AND t.planned_date < $2) OR (t.kind='weekly' AND t.due_date < $2)) ${userId ? 'AND t.assignee_id=$3' : ''}`, lp);
  const att = await attainment({ companyId, tz, from, to, userId });
  const ef = entryFilter({ companyId, from, to, tz, userId });
  const time = await one(
    `SELECT COALESCE(sum(e.seconds),0)::int AS seconds, count(DISTINCT e.task_id)::int AS tasks
     FROM time_entries e JOIN tasks t ON t.id=e.task_id WHERE ${ef.where}`, ef.params);
  const users = await perUser({ companyId, tz, from, to, userId });
  // série diária: período selecionado, mínimo 14 dias
  const seriesFrom = from > addDays(to, -13) ? addDays(to, -13) : from;
  const daily = await dailySeries({ companyId, tz, from: seriesFrom, to, userId });
  const weekly = await weeklySeries({ companyId, tz, weeks: 8, userId, endDate: to });
  const goal = await one(
    `SELECT * FROM goals WHERE company_id=$1 AND period='weekly' AND (user_id IS NULL ${userId ? 'OR user_id = $2' : ''})
     ORDER BY user_id NULLS LAST LIMIT 1`,
    userId ? [companyId, userId] : [companyId]);
  const actualMinutes = Math.round(time.seconds / 60);
  return {
    period: { from, to, today },
    counts: { ...counts, late: late.n },
    attainment: att,
    time: { seconds: time.seconds, avg_seconds: time.tasks ? Math.round(time.seconds / time.tasks) : 0, estimated_minutes: counts.estimated_minutes, actual_minutes: actualMinutes },
    users,
    daily,
    weekly,
    weeklyTarget: goal?.target_percent ?? null,
  };
}

export async function report({ companyId, tz, from, to, userId, categoryId, status }) {
  const f = taskFilter({ companyId, from, to, userId, categoryId, status });
  const today = todayIn(tz);
  const ef = entryFilter({ companyId, from, to, tz, userId, categoryId });

  const summary = await one(
    `SELECT count(*)::int AS tasks, count(*) FILTER (WHERE status='done')::int AS done,
       COALESCE(sum(estimated_minutes),0)::int AS estimated_minutes FROM tasks t WHERE ${f.where}`, f.params);
  const timeTotal = await one(`SELECT COALESCE(sum(e.seconds),0)::int AS seconds FROM time_entries e JOIN tasks t ON t.id=e.task_id WHERE ${ef.where}`, ef.params);

  const byCategory = await many(
    `SELECT COALESCE(c.name,'Sem categoria') AS category, COALESCE(c.color,'#c4c4c4') AS color,
       count(DISTINCT e.task_id)::int AS tasks, COALESCE(sum(e.seconds),0)::int AS seconds
     FROM time_entries e JOIN tasks t ON t.id=e.task_id LEFT JOIN categories c ON c.id=t.category_id
     WHERE ${ef.where} GROUP BY 1,2 ORDER BY seconds DESC`, ef.params);

  const byUser = await many(
    `SELECT u.name AS user, count(DISTINCT e.task_id)::int AS tasks, COALESCE(sum(e.seconds),0)::int AS seconds
     FROM time_entries e JOIN tasks t ON t.id=e.task_id JOIN users u ON u.id=e.user_id
     WHERE ${ef.where} GROUP BY 1 ORDER BY seconds DESC`, ef.params);

  const topActivities = await many(
    `SELECT t.title AS activity, COALESCE(c.name,'Sem categoria') AS category, count(DISTINCT t.id)::int AS occurrences,
       COALESCE(sum(e.seconds),0)::int AS seconds, round(avg(t.estimated_minutes))::int AS avg_estimated_minutes
     FROM time_entries e JOIN tasks t ON t.id=e.task_id LEFT JOIN categories c ON c.id=t.category_id
     WHERE ${ef.where} GROUP BY t.title, c.name ORDER BY seconds DESC LIMIT 15`, ef.params);

  f.params.push(today, tz);
  const ti = f.params.length - 1, tzi = f.params.length;
  const lateByCategory = await many(
    `SELECT COALESCE(c.name,'Sem categoria') AS category, count(*)::int AS tasks,
       count(*) FILTER (WHERE t.rollover_count>0
         OR (t.status='done' AND (t.completed_at AT TIME ZONE $${tzi})::date > (CASE WHEN t.kind='daily' THEN t.planned_date ELSE t.due_date END))
         OR (t.status<>'done' AND (CASE WHEN t.kind='daily' THEN t.planned_date ELSE t.due_date END) < $${ti}))::int AS late
     FROM tasks t LEFT JOIN categories c ON c.id=t.category_id WHERE ${f.where} GROUP BY 1 ORDER BY late DESC`, f.params);
  lateByCategory.forEach((r) => (r.late_rate = pct(r.late, r.tasks)));

  const mostLate = await many(
    `SELECT t.id, t.title, u.name AS assignee, t.planned_date, t.due_date, t.status, t.rollover_count,
       GREATEST(0, (CASE WHEN t.status='done' THEN (t.completed_at AT TIME ZONE $${tzi})::date ELSE $${ti}::date END)
         - (CASE WHEN t.kind='daily' THEN t.planned_date ELSE t.due_date END))::int AS days_late
     FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE ${f.where}
     ORDER BY days_late DESC, rollover_count DESC LIMIT 15`, f.params);

  const tasks = await many(
    `SELECT t.id, t.kind, t.title, u.name AS assignee, COALESCE(c.name,'') AS category, t.priority, t.status,
       t.planned_date, t.due_date, t.estimated_minutes, t.tracked_seconds, t.rollover_count,
       to_char(t.started_at AT TIME ZONE $${tzi}, 'YYYY-MM-DD HH24:MI') AS started_at,
       to_char(t.completed_at AT TIME ZONE $${tzi}, 'YYYY-MM-DD HH24:MI') AS completed_at, t.notes
     FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN categories c ON c.id=t.category_id
     WHERE ${f.where} AND $${ti}::date IS NOT NULL ORDER BY t.planned_date, t.id`, f.params);
  const done = tasks.filter((t) => t.status === 'done');
  const estVsActual = {
    estimated_minutes: done.reduce((s, t) => s + t.estimated_minutes, 0),
    actual_minutes: Math.round(done.reduce((s, t) => s + t.tracked_seconds, 0) / 60),
    tasks: done.filter((t) => t.estimated_minutes > 0).slice(0, 200).map((t) => ({
      title: t.title, assignee: t.assignee, estimated_minutes: t.estimated_minutes, actual_minutes: Math.round(t.tracked_seconds / 60),
    })),
  };
  const evolution = await dailySeries({ companyId, tz, from, to, userId, categoryId });
  const users = await perUser({ companyId, tz, from, to, userId, categoryId });
  return { summary: { ...summary, seconds: timeTotal.seconds }, byCategory, byUser, topActivities, lateByCategory, mostLate, estVsActual, evolution, users, tasks };
}
