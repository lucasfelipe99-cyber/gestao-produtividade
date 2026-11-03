import { pool, tx, logEvent, broadcast, many } from './db.js';
import { todayIn, addDays, addMonths, isBusinessDay, nextBusinessDayOnOrAfter, weekStart } from './dates.js';

const INTERVAL_MS = 5 * 60 * 1000;
export const RECURRENCE_HORIZON_DAYS = 92; // ~3 meses de ocorrências visíveis no calendário

// anchor: data da primeira ocorrência (mensal mantém o mesmo dia do mês, ex.: 31 -> 30/28 -> 31)
export function nextOccurrence(freq, date, anchor) {
  if (freq === 'daily') { let d = addDays(date, 1); while (!isBusinessDay(d)) d = addDays(d, 1); return d; }
  if (freq === 'weekly') return addDays(date, 7);
  if (!anchor) return addMonths(date, 1);
  const months = (Number(date.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(anchor.slice(5, 7));
  return addMonths(anchor, months + 1);
}

export async function insertTaskFromTemplate(db, companyId, t, dueDate, recurrenceId, userId) {
  const kind = t.kind === 'weekly' ? 'weekly' : 'daily';
  const { rows } = await db.query(
    `INSERT INTO tasks (company_id, kind, title, description, assignee_id, team_id, category_id, shared, priority,
       due_date, planned_date, week_start, scheduled_time, estimated_minutes, notes, recurrence_id, created_by, business_id, channel_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [companyId, kind, t.title, t.description || '', t.assignee_id || null, t.team_id || null, t.category_id || null,
     !!t.shared, t.priority || 'medium', dueDate, weekStart(dueDate), t.scheduled_time || null,
     Number(t.estimated_minutes) || 0, t.notes || '', recurrenceId, userId || null, t.business_id || null, t.channel_id || null]
  );
  return rows[0];
}

// Gera as ocorrências de uma recorrência de hoje até o horizonte (sem duplicar, sem gerar passado)
export async function generateRecurrence(db, companyId, r, today) {
  const horizon = addDays(today, RECURRENCE_HORIZON_DAYS);
  let d = r.next_date;
  let guard = 0, created = 0;
  while (d < today && guard++ < 1000) d = nextOccurrence(r.frequency, d, r.template.anchor_date);
  const existing = new Set((await db.query(
    'SELECT planned_date FROM tasks WHERE recurrence_id=$1 AND planned_date >= $2', [r.id, d])).rows.map((x) => x.planned_date));
  while (d <= horizon && guard++ < 1000) {
    if (!existing.has(d)) {
      const t = await insertTaskFromTemplate(db, companyId, r.template, d, r.id, r.created_by);
      await logEvent(db, { companyId, taskId: t.id, taskTitle: t.title, userId: null, action: 'created_by_recurrence', details: { frequency: r.frequency } });
      created++;
    }
    d = nextOccurrence(r.frequency, d, r.template.anchor_date);
  }
  await db.query('UPDATE recurrences SET next_date=$1 WHERE id=$2', [d, r.id]);
  return created;
}

export async function runAutomationForCompany(companyId, { force = false } = {}) {
  return tx(async (db) => {
    // trava por empresa para evitar execuções concorrentes
    const lock = await db.query('SELECT pg_try_advisory_xact_lock(4242, $1) AS ok', [companyId]);
    if (!lock.rows[0].ok) return { skipped: true };
    const c = (await db.query('SELECT * FROM companies WHERE id=$1 FOR UPDATE', [companyId])).rows[0];
    if (!c) return { skipped: true };
    if (!force && c.last_automation_at && Date.now() - new Date(c.last_automation_at).getTime() < INTERVAL_MS) {
      return { skipped: true };
    }
    const today = todayIn(c.timezone);
    let changes = 0;

    // 1) Recorrências: mantém ocorrências geradas até o horizonte (próximos meses)
    const recs = (await db.query(
      'SELECT * FROM recurrences WHERE company_id=$1 AND active AND next_date <= $2', [companyId, addDays(today, RECURRENCE_HORIZON_DAYS)])).rows;
    for (const r of recs) changes += await generateRecurrence(db, companyId, r, today);

    // 2) Diárias não concluídas -> próximo dia útil (histórico original preservado em planned_date)
    const target = nextBusinessDayOnOrAfter(today);
    const stale = (await db.query(
      `SELECT id, title, due_date, status FROM tasks
       WHERE company_id=$1 AND kind='daily' AND due_date < $2 AND status NOT IN ('done','cancelled')`,
      [companyId, today])).rows;
    for (const t of stale) {
      const newStatus = t.status === 'not_started' ? 'late' : t.status;
      await db.query(
        `UPDATE tasks SET due_date=$1, rollover_count=rollover_count+1, status=$2, updated_at=now() WHERE id=$3`,
        [target, newStatus, t.id]);
      await logEvent(db, { companyId, taskId: t.id, taskTitle: t.title, action: 'rolled_over', details: { from: t.due_date, to: target } });
      changes++;
    }

    // 3) Semanais com prazo vencido e não iniciadas -> atrasadas
    const lateWeekly = (await db.query(
      `UPDATE tasks SET status='late', updated_at=now()
       WHERE company_id=$1 AND kind='weekly' AND due_date < $2 AND status='not_started' RETURNING id, title`,
      [companyId, today])).rows;
    for (const t of lateWeekly) {
      await logEvent(db, { companyId, taskId: t.id, taskTitle: t.title, action: 'marked_late', details: {} });
      changes++;
    }

    await db.query('UPDATE companies SET last_automation_at=now() WHERE id=$1', [companyId]);
    if (changes) setImmediate(() => broadcast(companyId, { reason: 'automation' }));
    return { changes };
  });
}

export function startAutomationLoop() {
  const run = async () => {
    try {
      const companies = await many('SELECT id FROM companies');
      for (const c of companies) await runAutomationForCompany(c.id);
    } catch (e) { console.error('[automação]', e.message); }
  };
  setTimeout(run, 2000);
  setInterval(run, INTERVAL_MS);
}

// middleware: garante automação recente para a empresa do usuário (Render free hiberna)
export async function ensureAutomation(req, _res, next) {
  try { if (req.user) await runAutomationForCompany(req.user.company_id); } catch (e) { console.error(e.message); }
  next();
}
export { pool };
