import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool, q, one, many, tx, migrate, logEvent, subscribe, broadcast } from './db.js';
import { runAutomationForCompany, startAutomationLoop, ensureAutomation, insertTaskFromTemplate, generateRecurrence, nextOccurrence, RECURRENCE_HORIZON_DAYS } from './automation.js';
import { timeline, effectiveLunch } from './timeline.js';
import { aiEnabled, summarizeNotes } from './ai.js';
import { dashboard, report, attainment, perUser, weeklySeries } from './metrics.js';
import { todayIn, addDays, weekStart, isDate, isBusinessDay, addMonths } from './dates.js';
import { buildWorkbook } from './export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[aviso] JWT_SECRET não definido; usando segredo temporário.');
  return crypto.randomBytes(32).toString('hex');
})();
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------- utilidades ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isAdmin = (u) => u.role === 'admin';
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['not_started', 'in_progress', 'paused', 'done', 'late', 'cancelled'];
const changed = (req, extra) => broadcast(req.user.company_id, extra);

function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 30 * 24 * 3600 * 1000 });
}

async function auth(req, _res, next) {
  try {
    const token = req.cookies.sid;
    if (!token) throw new HttpError(401, 'Não autenticado');
    const { uid } = jwt.verify(token, JWT_SECRET);
    const u = await one(
      `SELECT u.id, u.company_id, u.team_id, u.name, u.email, u.role, u.active, u.allowed_tabs, c.name AS company_name, c.timezone
       FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=$1`, [uid]);
    if (!u || !u.active) throw new HttpError(401, 'Sessão inválida');
    req.user = u;
    next();
  } catch (e) { next(e.status ? e : new HttpError(401, 'Sessão inválida')); }
}
const adminOnly = (req, _res, next) => (isAdmin(req.user) ? next() : next(new HttpError(403, 'Apenas administradores')));
// Abas do sistema que o administrador pode liberar/bloquear por colaborador
export const TABS = ['dashboard', 'tarefas', 'grupo', 'clientes', 'linha-do-tempo', 'metas', 'relatorios', 'historico'];
const canTab = (u, tab) => isAdmin(u) || !u.allowed_tabs || u.allowed_tabs.includes(tab);
const requireTab = (tab) => (req, _res, next) => (canTab(req.user, tab) ? next() : next(new HttpError(403, 'Você não tem acesso a esta área')));

// Visibilidade de tarefas para colaboradores: próprias, compartilhadas ou da equipe sem responsável
function visibilitySql(user, alias = 't', startIdx) {
  if (isAdmin(user)) return { sql: 'TRUE', params: [] };
  return {
    sql: `(${alias}.assignee_id=$${startIdx} OR (${alias}.requested AND ${alias}.created_by=$${startIdx}))`,
    params: [user.id],
  };
}

async function loadTask(db, req, id, { forUpdate = false, related = false } = {}) {
  const t = (await db.query(`SELECT * FROM tasks WHERE id=$1 AND company_id=$2 ${forUpdate ? 'FOR UPDATE' : ''}`, [id, req.user.company_id])).rows[0];
  if (!t) throw new HttpError(404, 'Tarefa não encontrada');
  const u = req.user;
  if (!isAdmin(u) && t.assignee_id !== u.id && !(related && await isRelated(db, t, u.id))) {
    throw new HttpError(403, 'Sem acesso a esta tarefa');
  }
  return t;
}
// Em tarefas em grupo, quem tem uma entrega pode ver a principal, e o dono da principal vê as entregas
async function isRelated(db, t, userId) {
  if (t.created_by === userId) return true;
  if (t.parent_task_id && (await db.query('SELECT 1 FROM tasks WHERE id=$1 AND assignee_id=$2', [t.parent_task_id, userId])).rowCount) return true;
  return (await db.query('SELECT 1 FROM tasks WHERE parent_task_id=$1 AND assignee_id=$2', [t.id, userId])).rowCount > 0;
}

const TASK_SELECT = `
  SELECT t.*, u.name AS assignee_name, c.name AS category_name, c.color AS category_color, tm.name AS team_name,
    b.name AS business_name, b.color AS business_color, ch.name AS channel_name, ch.color AS channel_color,
    cb.name AS created_by_name,
    a.user_id AS active_user_id, au.name AS active_user_name, a.started_at AS active_started_at,
    a.subtask_id AS active_subtask_id, ast.title AS active_subtask_title,
    COALESCE(sc.total, 0) AS subtasks_total, COALESCE(sc.done, 0) AS subtasks_done,
    (t.status NOT IN ('done','cancelled') AND ((t.kind='daily' AND t.planned_date < $TODAY) OR (t.kind<>'daily' AND t.due_date < $TODAY))) AS overdue,
    pt.title AS parent_title, pt.assignee_id AS parent_assignee_id, pu.name AS parent_assignee_name, pt.status AS parent_status,
    dep.items AS partners
  FROM tasks t
  LEFT JOIN tasks pt ON pt.id=t.parent_task_id
  LEFT JOIN users pu ON pu.id=pt.assignee_id
  LEFT JOIN LATERAL (SELECT json_agg(json_build_object('id', d.id, 'title', d.title, 'assignee_id', d.assignee_id, 'assignee_name', du.name,
      'due_date', to_char(d.due_date,'YYYY-MM-DD'), 'scheduled_time', to_char(d.scheduled_time,'HH24:MI'), 'status', d.status,
      'completed_at', d.completed_at, 'late', d.status NOT IN ('done','cancelled') AND d.due_date < $TODAY) ORDER BY d.due_date, d.id) AS items
    FROM tasks d LEFT JOIN users du ON du.id=d.assignee_id WHERE d.parent_task_id=t.id AND d.status<>'cancelled') dep ON TRUE
  LEFT JOIN users u ON u.id=t.assignee_id
  LEFT JOIN users cb ON cb.id=t.created_by
  LEFT JOIN categories c ON c.id=t.category_id
  LEFT JOIN teams tm ON tm.id=t.team_id
  LEFT JOIN businesses b ON b.id=t.business_id
  LEFT JOIN channels ch ON ch.id=t.channel_id
  LEFT JOIN LATERAL (SELECT user_id, started_at, subtask_id FROM time_entries e WHERE e.task_id=t.id AND e.ended_at IS NULL LIMIT 1) a ON TRUE
  LEFT JOIN users au ON au.id=a.user_id
  LEFT JOIN subtasks ast ON ast.id=a.subtask_id
  LEFT JOIN LATERAL (SELECT count(*)::int AS total, count(*) FILTER (WHERE done)::int AS done FROM subtasks s WHERE s.task_id=t.id) sc ON TRUE`;

async function fetchTask(id, req) {
  const today = todayIn(req.user.timezone);
  return one(TASK_SELECT.replaceAll('$TODAY', '$2') + ' WHERE t.id=$1', [id, today]);
}

// Validação de dados de tarefa
function cleanTask(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('title')) {
    const title = String(body.title || '').trim();
    if (!title) throw new HttpError(400, 'Informe o nome da tarefa');
    out.title = title.slice(0, 300);
  }
  if (has('description')) out.description = String(body.description || '').slice(0, 10000);
  if (has('notes')) out.notes = String(body.notes || '').slice(0, 10000);
  if (has('kind')) { if (!['daily', 'weekly', 'oneoff'].includes(body.kind)) throw new HttpError(400, 'Tipo inválido'); out.kind = body.kind; }
  if (has('priority')) { if (!PRIORITIES.includes(body.priority)) throw new HttpError(400, 'Prioridade inválida'); out.priority = body.priority; }
  if (has('status')) { if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Status inválido'); out.status = body.status; }
  if (has('due_date')) { if (!isDate(body.due_date)) throw new HttpError(400, 'Data inválida'); out.due_date = body.due_date; }
  else if (!partial) throw new HttpError(400, 'Informe a data');
  if (has('scheduled_time')) {
    const v = body.scheduled_time || null;
    if (v && !/^\d{2}:\d{2}(:\d{2})?$/.test(v)) throw new HttpError(400, 'Horário inválido');
    out.scheduled_time = v;
  }
  if (has('estimated_minutes')) out.estimated_minutes = Math.max(0, Math.min(100000, parseInt(body.estimated_minutes, 10) || 0));
  for (const k of ['assignee_id', 'team_id', 'category_id', 'business_id', 'channel_id']) if (has(k)) out[k] = body[k] ? parseInt(body[k], 10) : null;
  if (has('shared')) out.shared = !!body.shared;
  return out;
}

async function assertRefs(db, companyId, data) {
  const checks = [['assignee_id', 'users'], ['team_id', 'teams'], ['category_id', 'categories'], ['business_id', 'businesses'], ['channel_id', 'channels']];
  for (const [k, table] of checks) {
    if (data[k]) {
      const r = await db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND company_id=$2`, [data[k], companyId]);
      if (!r.rowCount) throw new HttpError(400, `Referência inválida: ${k}`);
    }
  }
}

// null = todas as abas; lista vazia não é permitida (precisa ao menos uma aba de tarefas)
function cleanTabs(v) {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new HttpError(400, 'Lista de abas inválida');
  const list = [...new Set(v.filter((t) => TABS.includes(t)))];
  if (!list.length) throw new HttpError(400, 'Libere ao menos uma aba para o colaborador');
  return list.length === TABS.length ? null : list;
}

// ---------- autenticação ----------
app.post('/api/auth/signup', wrap(async (req, res) => {
  const { company, name, email, password } = req.body || {};
  if (!company?.trim() || !name?.trim() || !email?.trim()) throw new HttpError(400, 'Preencha empresa, nome e e-mail');
  if (!password || password.length < 6) throw new HttpError(400, 'A senha precisa ter ao menos 6 caracteres');
  const exists = await one('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email.trim()]);
  if (exists) throw new HttpError(409, 'E-mail já cadastrado');
  const hash = await bcrypt.hash(password, 10);
  const user = await tx(async (db) => {
    const c = (await db.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [company.trim()])).rows[0];
    const u = (await db.query(
      `INSERT INTO users (company_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'admin') RETURNING id`,
      [c.id, name.trim(), email.trim().toLowerCase(), hash])).rows[0];
    await db.query(`INSERT INTO goals (company_id, user_id, period, target_percent) VALUES ($1,NULL,'daily',90),($1,NULL,'weekly',90)`, [c.id]);
    return u;
  });
  setSession(res, user);
  res.json({ ok: true });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const u = await one('SELECT * FROM users WHERE lower(email)=lower($1)', [String(email || '').trim()]);
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) throw new HttpError(401, 'E-mail ou senha incorretos');
  if (!u.active) throw new HttpError(403, 'Usuário desativado. Fale com o administrador.');
  setSession(res, u);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (_req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });

app.use('/api', auth, ensureAutomation);

app.get('/api/me', wrap(async (req, res) => {
  res.json({ ...req.user, today: todayIn(req.user.timezone) });
}));

app.post('/api/me/password', wrap(async (req, res) => {
  const { current, next: nw } = req.body || {};
  const u = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), u.password_hash))) throw new HttpError(400, 'Senha atual incorreta');
  if (!nw || nw.length < 6) throw new HttpError(400, 'A nova senha precisa ter ao menos 6 caracteres');
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(nw, 10), req.user.id]);
  res.json({ ok: true });
}));

// ---------- tempo real ----------
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const unsub = subscribe(req.user.company_id, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); unsub(); });
});

// ---------- cadastros: usuários, equipes, categorias ----------
app.get('/api/users', wrap(async (req, res) => {
  res.json(await many(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.team_id, u.allowed_tabs, t.name AS team_name, u.created_at
     FROM users u LEFT JOIN teams t ON t.id=u.team_id WHERE u.company_id=$1 ${isAdmin(req.user) ? '' : 'AND u.id=$2'}
     ORDER BY u.active DESC, u.name`, isAdmin(req.user) ? [req.user.company_id] : [req.user.company_id, req.user.id]));
}));

// Lista mínima (só nomes) dos colegas ativos, para escolher parceiro em tarefa em grupo
app.get('/api/users/directory', wrap(async (req, res) => {
  res.json(await many('SELECT id, name FROM users WHERE company_id=$1 AND active ORDER BY name', [req.user.company_id]));
}));

app.post('/api/users', adminOnly, wrap(async (req, res) => {
  const { name, email, password, role = 'member', team_id, allowed_tabs } = req.body || {};
  if (!name?.trim() || !email?.trim()) throw new HttpError(400, 'Informe nome e e-mail');
  if (!password || password.length < 6) throw new HttpError(400, 'A senha precisa ter ao menos 6 caracteres');
  if (!['admin', 'member'].includes(role)) throw new HttpError(400, 'Perfil inválido');
  if (await one('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email.trim()])) throw new HttpError(409, 'E-mail já cadastrado');
  await assertRefs(pool, req.user.company_id, { team_id });
  const u = await one(
    `INSERT INTO users (company_id, name, email, password_hash, role, team_id, allowed_tabs) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user.company_id, name.trim(), email.trim().toLowerCase(), await bcrypt.hash(password, 10), role, team_id || null, cleanTabs(allowed_tabs)]);
  changed(req);
  res.json(u);
}));

app.patch('/api/users/:id', adminOnly, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = await one('SELECT * FROM users WHERE id=$1 AND company_id=$2', [id, req.user.company_id]);
  if (!target) throw new HttpError(404, 'Usuário não encontrado');
  const b = req.body || {};
  const sets = []; const params = [];
  const add = (col, v) => { params.push(v); sets.push(`${col}=$${params.length}`); };
  if (b.name !== undefined) add('name', String(b.name).trim());
  if (b.email !== undefined) {
    const dup = await one('SELECT 1 FROM users WHERE lower(email)=lower($1) AND id<>$2', [b.email.trim(), id]);
    if (dup) throw new HttpError(409, 'E-mail já cadastrado');
    add('email', b.email.trim().toLowerCase());
  }
  if (b.role !== undefined) {
    if (!['admin', 'member'].includes(b.role)) throw new HttpError(400, 'Perfil inválido');
    if (id === req.user.id && b.role !== 'admin') throw new HttpError(400, 'Você não pode remover seu próprio acesso de administrador');
    add('role', b.role);
  }
  if (b.team_id !== undefined) { await assertRefs(pool, req.user.company_id, { team_id: b.team_id }); add('team_id', b.team_id || null); }
  if (b.active !== undefined) {
    if (id === req.user.id && !b.active) throw new HttpError(400, 'Você não pode desativar seu próprio usuário');
    add('active', !!b.active);
  }
  if (b.password) { if (b.password.length < 6) throw new HttpError(400, 'Senha muito curta'); add('password_hash', await bcrypt.hash(b.password, 10)); }
  if (b.allowed_tabs !== undefined) add('allowed_tabs', cleanTabs(b.allowed_tabs));
  if (sets.length) { params.push(id); await q(`UPDATE users SET ${sets.join(',')} WHERE id=$${params.length}`, params); }
  changed(req);
  res.json({ ok: true });
}));

const COLORED = ['categories', 'businesses', 'channels'];
for (const [route, table] of [['teams', 'teams'], ['categories', 'categories'], ['businesses', 'businesses'], ['channels', 'channels']]) {
  app.get(`/api/${route}`, wrap(async (req, res) => {
    res.json(await many(`SELECT * FROM ${table} WHERE company_id=$1 ORDER BY name`, [req.user.company_id]));
  }));
  app.post(`/api/${route}`, adminOnly, wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Informe o nome');
    const row = COLORED.includes(table)
      ? await one(`INSERT INTO ${table} (company_id, name, color) VALUES ($1,$2,$3) RETURNING *`, [req.user.company_id, name, req.body.color || '#579bfc'])
      : await one('INSERT INTO teams (company_id, name) VALUES ($1,$2) RETURNING *', [req.user.company_id, name]);
    changed(req);
    res.json(row);
  }));
  app.patch(`/api/${route}/:id`, adminOnly, wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Informe o nome');
    if (COLORED.includes(table)) await q(`UPDATE ${table} SET name=$1, color=COALESCE($2,color) WHERE id=$3 AND company_id=$4`, [name, req.body.color || null, req.params.id, req.user.company_id]);
    else await q('UPDATE teams SET name=$1 WHERE id=$2 AND company_id=$3', [name, req.params.id, req.user.company_id]);
    changed(req);
    res.json({ ok: true });
  }));
  app.delete(`/api/${route}/:id`, adminOnly, wrap(async (req, res) => {
    await q(`DELETE FROM ${table} WHERE id=$1 AND company_id=$2`, [req.params.id, req.user.company_id]);
    changed(req);
    res.json({ ok: true });
  }));
}

// ---------- tarefas ----------
app.get('/api/tasks', wrap(async (req, res) => {
  const u = req.user;
  const today = todayIn(u.timezone);
  const { from, to, week, assignee, status, category, team, mine, business, channel } = req.query;
  let { kind } = req.query;
  // colaborador só recebe os tipos de tarefa das abas liberadas para ele
  const kinds = canTab(u, 'tarefas') ? ['daily', 'weekly', 'oneoff'] : [];
  if (!kinds.length) throw new HttpError(403, 'Você não tem acesso às tarefas');
  if (kind && !kinds.includes(kind)) return res.json([]);
  const params = [u.company_id, today];
  const w = ['t.company_id=$1'];
  const vis = visibilitySql(u, 't', params.length + 1);
  params.push(...vis.params); w.push(vis.sql);
  let carriedExpr = 'FALSE';
  if (kind) { params.push(kind); w.push(`t.kind=$${params.length}`); }
  else if (kinds.length < 3) { params.push(kinds); w.push(`t.kind = ANY($${params.length}::text[])`); }
  if (week && isDate(week)) {
    const ws = weekStart(week);
    params.push(ws);
    const i = params.length;
    // semana atual + pendências de semanas anteriores
    w.push(`(t.week_start=$${i} OR (t.week_start < $${i} AND t.status NOT IN ('done','cancelled')))`);
    carriedExpr = `(t.week_start < $${i})`;
  } else {
    if (from && isDate(from)) { params.push(from); w.push(`t.due_date >= $${params.length}`); }
    if (to && isDate(to)) { params.push(to); w.push(`t.due_date <= $${params.length}`); }
  }
  if (assignee) { if (assignee === 'none') w.push('t.assignee_id IS NULL'); else { params.push(parseInt(assignee, 10)); w.push(`t.assignee_id=$${params.length}`); } }
  if (mine === '1') { params.push(u.id); w.push(`t.assignee_id=$${params.length}`); }
  if (status) {
    if (status === 'overdue') w.push(`(t.status NOT IN ('done','cancelled') AND ((t.kind='daily' AND t.planned_date < $2) OR (t.kind<>'daily' AND t.due_date < $2)))`);
    else { params.push(status); w.push(`t.status=$${params.length}`); }
  }
  if (category) { params.push(parseInt(category, 10)); w.push(`t.category_id=$${params.length}`); }
  if (team) { params.push(parseInt(team, 10)); w.push(`t.team_id=$${params.length}`); }
  for (const [val, col] of [[business, 'business_id'], [channel, 'channel_id']]) {
    if (val === 'none') w.push(`t.${col} IS NULL`);
    else if (val) { params.push(parseInt(val, 10)); w.push(`t.${col}=$${params.length}`); }
  }
  const sql = TASK_SELECT.replaceAll('$TODAY', '$2').replace('SELECT t.*,', `SELECT t.*, ${carriedExpr} AS carried,`) +
    ` WHERE ${w.join(' AND ')}
      ORDER BY t.due_date, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.scheduled_time NULLS LAST, t.id
      LIMIT 6000`;
  res.json(await many(sql, params));
}));

app.get('/api/tasks/:id', wrap(async (req, res) => {
  await loadTask(pool, req, req.params.id, { related: true });
  const task = await fetchTask(req.params.id, req);
  const entries = await many(
    `SELECT e.*, u.name AS user_name, s.title AS subtask_title FROM time_entries e JOIN users u ON u.id=e.user_id
     LEFT JOIN subtasks s ON s.id=e.subtask_id WHERE e.task_id=$1 ORDER BY e.started_at DESC`, [task.id]);
  const notes = await many(
    `SELECT n.*, u.name AS user_name FROM task_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.task_id=$1 ORDER BY n.created_at DESC`, [task.id]);
  const events = await many(
    `SELECT ev.*, u.name AS user_name FROM task_events ev LEFT JOIN users u ON u.id=ev.user_id WHERE ev.task_id=$1 AND ev.company_id=$2 ORDER BY ev.created_at DESC, ev.id DESC`,
    [task.id, req.user.company_id]);
  const recurrence = task.recurrence_id ? await one(
    `SELECT r.id, r.frequency, r.next_date, r.active,
       (SELECT count(*)::int FROM tasks x WHERE x.recurrence_id=r.id AND x.due_date >= $2) AS upcoming,
       (SELECT max(planned_date) FROM tasks x WHERE x.recurrence_id=r.id) AS last_date
     FROM recurrences r WHERE r.id=$1`, [task.recurrence_id, todayIn(req.user.timezone)]) : null;
  const subtasks = await many(
    `SELECT s.*, a.user_id AS active_user_id, a.started_at AS active_started_at FROM subtasks s
     LEFT JOIN LATERAL (SELECT user_id, started_at FROM time_entries e WHERE e.subtask_id=s.id AND e.ended_at IS NULL LIMIT 1) a ON TRUE
     WHERE s.task_id=$1 ORDER BY s.position, s.id`, [task.id]);
  res.json({ task, entries, notes, events, recurrence, subtasks });
}));

app.post('/api/tasks', wrap(async (req, res) => {
  const data = cleanTask(req.body || {});
  data.kind = data.kind || 'daily';
  const requestTo = req.body?.request_to ? parseInt(req.body.request_to, 10) : null;
  if (requestTo) {
    // tarefa enviada a outro colaborador: começa hoje e precisa de data final depois de hoje
    const today = todayIn(req.user.timezone);
    if (requestTo === req.user.id) throw new HttpError(400, 'Escolha outro colaborador para enviar a tarefa');
    if (!data.due_date || data.due_date <= today) throw new HttpError(400, 'Informe a data final: ela precisa ser depois de hoje');
    const to = await one('SELECT id, team_id FROM users WHERE id=$1 AND company_id=$2 AND active', [requestTo, req.user.company_id]);
    if (!to) throw new HttpError(400, 'Colaborador inválido');
    Object.assign(data, { kind: 'oneoff', assignee_id: to.id, team_id: to.team_id || null, requested: true, start_date: today });
    req.body.recurrence = null;
  } else if (!isAdmin(req.user)) { // colaborador: tarefa sempre dele, sem recorrência
    data.assignee_id = req.user.id;
    data.team_id = req.user.team_id || null;
    req.body.recurrence = null;
  }
  if (data.kind === 'oneoff') req.body.recurrence = null; // pontual não se repete
  const recurrence = req.body.recurrence;
  if (recurrence && !['daily', 'weekly', 'monthly'].includes(recurrence)) throw new HttpError(400, 'Recorrência inválida');
  const task = await tx(async (db) => {
    await assertRefs(db, req.user.company_id, data);
    let recId = null;
    let rec = null;
    if (recurrence) {
      const template = { ...data, anchor_date: data.due_date };
      rec = (await db.query(
        `INSERT INTO recurrences (company_id, frequency, template, next_date, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.company_id, recurrence, JSON.stringify(template), nextOccurrence(recurrence, data.due_date, data.due_date), req.user.id])).rows[0];
      recId = rec.id;
    }
    const t = await insertTaskFromTemplate(db, req.user.company_id, data, data.due_date, recId, req.user.id);
    if (data.requested) {
      await db.query('UPDATE tasks SET requested=true, start_date=$1 WHERE id=$2', [data.start_date, t.id]);
      t.requested = true;
    }
    let generated = 0;
    if (rec) generated = await generateRecurrence(db, req.user.company_id, rec, todayIn(req.user.timezone));
    await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'created',
      details: { recurrence: recurrence || null, generated, ...(data.requested && { requested_to: data.assignee_id, due_date: data.due_date }) } });
    t.generated = generated;
    return t;
  });
  changed(req);
  res.json({ ...(await fetchTask(task.id, req)), generated: task.generated || 0 });
}));

const FIELD_LABELS = {
  title: 'nome', description: 'descrição', assignee_id: 'responsável', team_id: 'equipe', category_id: 'categoria', shared: 'compartilhada',
  business_id: 'empresa', channel_id: 'canal',
  priority: 'prioridade', status: 'status', due_date: 'data', scheduled_time: 'horário', estimated_minutes: 'tempo estimado', notes: 'observações', kind: 'tipo',
};

app.patch('/api/tasks/:id', wrap(async (req, res) => {
  const u = req.user;
  let data = cleanTask(req.body || {}, { partial: true });
  const applySeries = isAdmin(u) && !!req.body?.apply_to_series;
  const own = !isAdmin(u) && (await one('SELECT 1 AS ok FROM tasks WHERE id=$1 AND created_by=$2 AND (assignee_id=$2 OR requested)', [req.params.id, u.id]))?.ok;
  if (data.due_date) {
    const rq = await one('SELECT requested, to_char(start_date,\'YYYY-MM-DD\') AS start_date FROM tasks WHERE id=$1', [req.params.id]);
    if (rq?.requested && data.due_date <= rq.start_date) throw new HttpError(400, 'A data final precisa ser depois do dia em que a tarefa foi enviada');
  }
  if (!isAdmin(u) && own) {
    // tarefa criada pelo próprio colaborador: pode editar tudo, menos o responsável
    delete data.assignee_id; delete data.team_id;
    if (data.status && !['not_started', 'paused', 'in_progress', 'done'].includes(data.status)) throw new HttpError(403, 'Status não permitido');
  } else if (!isAdmin(u)) {
    // colaborador: pode atualizar andamento (status) e observações
    const allowed = {};
    if ('notes' in data) allowed.notes = data.notes;
    if ('status' in data) {
      if (!['not_started', 'paused', 'in_progress', 'done'].includes(data.status)) throw new HttpError(403, 'Status não permitido');
      allowed.status = data.status;
    }
    data = allowed;
  }
  if (!Object.keys(data).length) throw new HttpError(400, 'Nada para atualizar');
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true, related: !!own });
    if (t.requested) delete data.kind;
    await assertRefs(db, u.company_id, data);
    if (data.due_date && data.due_date !== t.due_date) {
      data.week_start = weekStart(data.due_date);
      // remarcação manual pelo administrador redefine a data planejada (histórico guarda a anterior)
      data.planned_date = data.due_date;
    }
    if (data.status && data.status !== t.status) {
      if (data.status === 'done') data.completed_at = new Date();
      else if (t.status === 'done') { data.completed_at = null; await dropInferred(db, 'task_id=$1', [t.id]); }
      if (['done', 'paused', 'cancelled', 'not_started'].includes(data.status)) await closeOpenEntries(db, t);
      if (data.status === 'done') await inferTime(db, t, u.id);
    }
    const diff = {};
    for (const [k, v] of Object.entries(data)) {
      const old = t[k] instanceof Date ? t[k].toISOString() : t[k];
      const nv = v instanceof Date ? v.toISOString() : v;
      if (String(old ?? '') !== String(nv ?? '') && FIELD_LABELS[k]) diff[k] = { from: old ?? null, to: nv ?? null };
    }
    const keys = Object.keys(data);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k}=$${i + 1}`);
      await db.query(`UPDATE tasks SET ${sets.join(',')}, updated_at=now() WHERE id=$${keys.length + 1}`, [...keys.map((k) => data[k]), t.id]);
    }
    if (Object.keys(diff).length) {
      await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: data.title || t.title, userId: u.id,
        action: diff.status ? (data.status === 'cancelled' ? 'cancelled' : 'status_changed') : 'updated', details: diff });
    }
    // aplica nome/descrição/responsável/etc. às próximas ocorrências ainda não iniciadas
    if (applySeries && t.recurrence_id) {
      const SERIES = ['title', 'description', 'assignee_id', 'team_id', 'category_id', 'business_id', 'channel_id', 'priority', 'scheduled_time', 'estimated_minutes'];
      const upd = Object.fromEntries(SERIES.filter((k) => k in data).map((k) => [k, data[k]]));
      if (Object.keys(upd).length) {
        await db.query(`UPDATE recurrences SET template = template || $1::jsonb WHERE id=$2`, [JSON.stringify(upd), t.recurrence_id]);
        const ks = Object.keys(upd);
        const r = await db.query(
          `UPDATE tasks SET ${ks.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=now()
           WHERE recurrence_id=$${ks.length + 1} AND id<>$${ks.length + 2} AND due_date >= $${ks.length + 3}
             AND status IN ('not_started','late') AND tracked_seconds=0`,
          [...ks.map((k) => upd[k]), t.recurrence_id, t.id, t.due_date]);
        await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: data.title || t.title, userId: u.id, action: 'series_updated',
          details: { fields: ks, tasks: r.rowCount } });
      }
    }
  });
  changed(req);
  res.json(await fetchTask(req.params.id, req));
}));

app.delete('/api/tasks/:id', wrap(async (req, res) => {
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true, related: true });
    if (!isAdmin(req.user) && t.created_by !== req.user.id) throw new HttpError(403, 'Só é possível excluir tarefas que você criou. Use "Tirar do meu dia".');
    if (t.parent_task_id) await logEvent(db, { companyId: req.user.company_id, taskId: t.parent_task_id, userId: req.user.id, action: 'partner_removed', details: { partner_task: t.title, assignee_id: t.assignee_id } });
    await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'deleted',
      details: { planned_date: t.planned_date, assignee_id: t.assignee_id, tracked_seconds: t.tracked_seconds } });
    await db.query('DELETE FROM tasks WHERE id=$1', [t.id]);
  });
  changed(req);
  res.json({ ok: true });
}));

// Colaborador tira uma tarefa do próprio dia: se ele criou, exclui; se foi atribuída, cancela com motivo (fica no histórico)
app.post('/api/tasks/:id/remove-from-day', wrap(async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  let result;
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true });
    if (t.status === 'done') throw new HttpError(400, 'Tarefa já concluída');
    const open = (await db.query('SELECT 1 FROM time_entries WHERE task_id=$1 AND ended_at IS NULL', [t.id])).rowCount;
    if (open) throw new HttpError(400, 'Pause o cronômetro antes de tirar a tarefa do dia');
    if (t.created_by === req.user.id && !t.tracked_seconds) {
      await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'deleted', details: { by_assignee: true } });
      if (t.parent_task_id) await logEvent(db, { companyId: req.user.company_id, taskId: t.parent_task_id, userId: req.user.id, action: 'partner_removed', details: { partner_task: t.title } });
      await db.query('DELETE FROM tasks WHERE id=$1', [t.id]);
      result = 'deleted';
    } else {
      if (!reason && !isAdmin(req.user)) throw new HttpError(400, 'Informe o motivo para tirar esta tarefa do seu dia');
      await db.query(`UPDATE tasks SET status='cancelled', updated_at=now() WHERE id=$1`, [t.id]);
      await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'removed_from_day', details: { reason, previous_status: t.status } });
      if (t.parent_task_id) await logEvent(db, { companyId: req.user.company_id, taskId: t.parent_task_id, userId: req.user.id, action: 'partner_removed', details: { partner_task: t.title, reason } });
      result = 'cancelled';
    }
  });
  changed(req);
  res.json({ ok: true, result });
}));

// Tarefas em grupo: adiciona um parceiro com a entrega e o prazo dele (vira uma tarefa no dia do parceiro)
app.post('/api/tasks/:id/partners', wrap(async (req, res) => {
  const b = req.body || {};
  const partnerId = parseInt(b.user_id, 10);
  const title = String(b.title || '').trim().slice(0, 300);
  if (!partnerId) throw new HttpError(400, 'Escolha o colaborador parceiro');
  if (!title) throw new HttpError(400, 'Descreva o que o parceiro precisa entregar');
  if (!isDate(b.due_date)) throw new HttpError(400, 'Informe o prazo de entrega do parceiro');
  if (b.scheduled_time && !/^\d{2}:\d{2}$/.test(b.scheduled_time)) throw new HttpError(400, 'Horário inválido');
  let child;
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true });
    if (!isAdmin(req.user) && t.assignee_id !== req.user.id) throw new HttpError(403, 'Só o responsável pela tarefa ou um administrador adiciona parceiros');
    if (['done', 'cancelled'].includes(t.status)) throw new HttpError(400, 'A tarefa já foi encerrada');
    const partner = (await db.query('SELECT id, name FROM users WHERE id=$1 AND company_id=$2 AND active', [partnerId, req.user.company_id])).rows[0];
    if (!partner) throw new HttpError(400, 'Colaborador inválido');
    const owner = t.assignee_id ? (await db.query('SELECT name FROM users WHERE id=$1', [t.assignee_id])).rows[0]?.name : null;
    child = await insertTaskFromTemplate(db, req.user.company_id, {
      kind: 'daily', title, assignee_id: partner.id, team_id: null, category_id: t.category_id, business_id: t.business_id, channel_id: t.channel_id,
      priority: t.priority, scheduled_time: b.scheduled_time || null, estimated_minutes: Number(b.estimated_minutes) || 0,
      description: [`Entrega para a tarefa “${t.title}”${owner ? ` de ${owner}` : ''}.`, String(b.description || '').trim()].filter(Boolean).join('\n\n'),
    }, b.due_date, null, req.user.id);
    await db.query('UPDATE tasks SET parent_task_id=$1 WHERE id=$2', [t.id, child.id]);
    await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'partner_added',
      details: { partner: partner.name, partner_task: title, due_date: b.due_date } });
    await logEvent(db, { companyId: req.user.company_id, taskId: child.id, taskTitle: title, userId: req.user.id, action: 'created', details: { partner_of: t.id } });
  });
  changed(req);
  res.json(await fetchTask(child.id, req));
}));

app.post('/api/recurrences/:id/stop', adminOnly, wrap(async (req, res) => {
  const today = todayIn(req.user.timezone);
  const removed = await tx(async (db) => {
    const r = (await db.query('UPDATE recurrences SET active=false WHERE id=$1 AND company_id=$2 RETURNING id', [req.params.id, req.user.company_id])).rows[0];
    if (!r) throw new HttpError(404, 'Recorrência não encontrada');
    const del = await db.query(
      `DELETE FROM tasks WHERE recurrence_id=$1 AND due_date > $2 AND status='not_started' AND tracked_seconds=0
         AND NOT EXISTS (SELECT 1 FROM subtasks s WHERE s.task_id=tasks.id) RETURNING id`, [r.id, today]);
    await logEvent(db, { companyId: req.user.company_id, userId: req.user.id, action: 'recurrence_stopped', details: { removed: del.rowCount } });
    return del.rowCount;
  });
  changed(req);
  res.json({ ok: true, removed });
}));

// ---------- controle de tempo ----------

// ---------- tempo estimado (tarefa concluída sem cronômetro) ----------
// Período = da última conclusão/fim de atividade do colaborador no dia (ou do início da jornada) até agora,
// só nas lacunas (nunca sobre tempo lançado manualmente) e sem o almoço. Sem limite de duração.
const INFER_MAX_MIN = 24 * 60;
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
async function inferTime(db, t, userId, at = new Date()) {
  if (!t.assignee_id || t.assignee_id !== userId) return 0;
  if ((await db.query('SELECT 1 FROM time_entries WHERE task_id=$1 LIMIT 1', [t.id])).rowCount) return 0;
  const c = (await db.query(
    `SELECT c.timezone AS tz, to_char(c.work_start,'HH24:MI') AS ws, to_char(c.lunch_start,'HH24:MI') AS ls, to_char(c.lunch_end,'HH24:MI') AS le,
       to_char($2::timestamptz AT TIME ZONE c.timezone,'YYYY-MM-DD') AS day,
       EXTRACT(EPOCH FROM (($2::timestamptz AT TIME ZONE c.timezone) - date_trunc('day', $2::timestamptz AT TIME ZONE c.timezone)))/60 AS now_min,
       (SELECT to_char(d.start_time,'HH24:MI') FROM day_starts d WHERE d.company_id=c.id AND d.day=($2::timestamptz AT TIME ZONE c.timezone)::date) AS day_start
     FROM companies c WHERE c.id=$1`, [t.company_id, at])).rows[0];
  const end = Number(c.now_min);
  const minOf = (col) => `EXTRACT(EPOCH FROM ((${col} AT TIME ZONE $2) - ($3::date)::timestamp))/60`;
  const ents = (await db.query(
    `SELECT ${minOf('e.started_at')} AS s, ${minOf('COALESCE(e.ended_at, now())')} AS e, e.source FROM time_entries e
     WHERE e.user_id=$1 AND COALESCE(e.ended_at, now()) > ($3::date::timestamp AT TIME ZONE $2) AND e.started_at < ($3::date::timestamp AT TIME ZONE $2) + interval '1 day'`,
    [userId, c.tz, c.day])).rows.map((r) => ({ start_min: Math.max(0, Number(r.s)), end_min: Number(r.e), source: r.source }));
  const lastDone = (await db.query(
    `SELECT max(${minOf('completed_at')}) AS m FROM tasks WHERE assignee_id=$1 AND id<>$4 AND status='done'
       AND completed_at >= ($3::date::timestamp AT TIME ZONE $2) AND completed_at < $5`, [userId, c.tz, c.day, t.id, at])).rows[0].m;
  let start = hm(c.day_start || c.ws);
  for (const e of ents) if (e.end_min <= end + 0.01) start = Math.max(start, e.end_min);
  if (lastDone != null) start = Math.max(start, Number(lastDone));
  if (end - start < 1) return 0;
  const lunch = effectiveLunch(ents.filter((e) => e.source !== 'inferred'), hm(c.ls), hm(c.le));
  const busy = ents.map((e) => [e.start_min, e.end_min]);
  if (lunch) busy.push([lunch.from, lunch.to]);
  busy.sort((a, b) => a[0] - b[0]);
  const segs = [];
  let cur = start;
  for (const [a, b] of busy) {
    if (b <= cur) continue;
    if (a >= end) break;
    if (a > cur) segs.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (end > cur) segs.push([cur, end]);
  const good = segs.filter(([a, b]) => b - a >= 1);
  const total = good.reduce((s, [a, b]) => s + (b - a), 0);
  if (total < 1 || total > INFER_MAX_MIN) return 0;
  let secs = 0;
  for (const [a, b] of good) {
    const r = (await db.query(
      `INSERT INTO time_entries (company_id, task_id, user_id, started_at, ended_at, seconds, source)
       VALUES ($1,$2,$3, ($4::date::timestamp + make_interval(secs => $5)) AT TIME ZONE $7, LEAST($8::timestamptz, ($4::date::timestamp + make_interval(secs => $6)) AT TIME ZONE $7),
         GREATEST(1, round($6 - $5)::int), 'inferred') RETURNING seconds, started_at`,
      [t.company_id, t.id, userId, c.day, a * 60, b * 60, c.tz, at])).rows[0];
    secs += r.seconds;
  }
  await db.query(`UPDATE tasks SET tracked_seconds=tracked_seconds+$1, started_at=COALESCE(started_at, $3::timestamptz - make_interval(secs => $1)) WHERE id=$2`, [secs, t.id, at]);
  return secs;
}
// Preenche tempo estimado de um dia já passado: tarefas concluídas sem nenhum registro de tempo,
// na ordem de conclusão, por colaborador (dia no fuso da empresa)
export async function backfillInferred(companyId, day) {
  return tx(async (db) => {
    const tz = (await db.query('SELECT timezone FROM companies WHERE id=$1', [companyId])).rows[0].timezone;
    const tasks = (await db.query(
      `SELECT t.* FROM tasks t WHERE t.company_id=$1 AND t.status='done' AND t.assignee_id IS NOT NULL
         AND (t.completed_at AT TIME ZONE $3)::date = $2::date
         AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id=t.id)
       ORDER BY t.assignee_id, t.completed_at`, [companyId, day, tz])).rows;
    let n = 0, secs = 0;
    for (const t of tasks) {
      const s = await inferTime(db, t, t.assignee_id, t.completed_at);
      if (s) { n++; secs += s; }
    }
    return { candidates: tasks.length, filled: n, seconds: secs };
  });
}

// remove tempo estimado (tarefa reaberta ou período substituído por lançamento real)
async function dropInferred(db, where, params) {
  const rows = (await db.query(`DELETE FROM time_entries WHERE source='inferred' AND ${where} RETURNING task_id, seconds`, params)).rows;
  for (const r of rows) await db.query('UPDATE tasks SET tracked_seconds=GREATEST(0, tracked_seconds-$1) WHERE id=$2', [r.seconds, r.task_id]);
  return rows.length;
}

async function applyClosed(db, taskId, rows) {
  const add = rows.reduce((s, r) => s + r.seconds, 0);
  if (add) await db.query('UPDATE tasks SET tracked_seconds=tracked_seconds+$1 WHERE id=$2', [add, taskId]);
  for (const r of rows) if (r.subtask_id) await db.query('UPDATE subtasks SET tracked_seconds=tracked_seconds+$1 WHERE id=$2', [r.seconds, r.subtask_id]);
  return add;
}
async function closeOpenEntries(db, task) {
  const open = (await db.query(
    `UPDATE time_entries SET ended_at=now(), seconds=GREATEST(1, EXTRACT(EPOCH FROM (now()-started_at))::int)
     WHERE task_id=$1 AND ended_at IS NULL RETURNING seconds, subtask_id`, [task.id])).rows;
  return applyClosed(db, task.id, open);
}
// Encerra o segmento atual e abre outro na mesma tarefa (troca de subtarefa sem parar o cronômetro)
async function switchSegment(db, entry, subtaskId) {
  const closed = (await db.query(
    `UPDATE time_entries SET ended_at=now(), seconds=GREATEST(1, EXTRACT(EPOCH FROM (now()-started_at))::int)
     WHERE id=$1 RETURNING seconds, subtask_id`, [entry.id])).rows;
  await applyClosed(db, entry.task_id, closed);
  await db.query(`INSERT INTO time_entries (company_id, task_id, user_id, started_at, source, subtask_id) VALUES ($1,$2,$3,now(),'timer',$4)`,
    [entry.company_id, entry.task_id, entry.user_id, subtaskId]);
}

app.get('/api/timer/active', wrap(async (req, res) => {
  const e = await one(
    `SELECT e.id, e.task_id, e.started_at, t.title, t.tracked_seconds, s.title AS subtask_title FROM time_entries e JOIN tasks t ON t.id=e.task_id
     LEFT JOIN subtasks s ON s.id=e.subtask_id WHERE e.user_id=$1 AND e.ended_at IS NULL`, [req.user.id]);
  res.json(e || null);
}));

app.post('/api/tasks/:id/start', wrap(async (req, res) => {
  const u = req.user;
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true });
    if (t.status === 'cancelled') throw new HttpError(400, 'Tarefa cancelada');
    const running = (await db.query(
      `SELECT e.task_id, tk.title FROM time_entries e JOIN tasks tk ON tk.id=e.task_id WHERE e.user_id=$1 AND e.ended_at IS NULL`, [u.id])).rows[0];
    if (running) {
      throw new HttpError(409, running.task_id === t.id
        ? 'O cronômetro desta tarefa já está rodando'
        : `Você já tem um cronômetro ativo em "${running.title}". Pause ou finalize antes de iniciar outra tarefa.`);
    }
    const otherUser = (await db.query('SELECT 1 FROM time_entries WHERE task_id=$1 AND ended_at IS NULL', [t.id])).rowCount;
    if (otherUser) throw new HttpError(409, 'Outro colaborador está com o cronômetro desta tarefa ativo');
    const wasDone = t.status === 'done';
    if (wasDone) await dropInferred(db, 'task_id=$1', [t.id]);
    await db.query(`INSERT INTO time_entries (company_id, task_id, user_id, started_at, source) VALUES ($1,$2,$3,now(),'timer')`, [u.company_id, t.id, u.id]);
    await db.query(
      `UPDATE tasks SET status='in_progress', started_at=COALESCE(started_at, now()), completed_at=NULL, updated_at=now() WHERE id=$1`, [t.id]);
    const action = wasDone ? 'reopened' : t.status === 'paused' ? 'resumed' : 'started';
    await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: t.title, userId: u.id, action, details: { previous_status: t.status } });
  });
  changed(req);
  res.json(await fetchTask(req.params.id, req));
}));

app.post('/api/tasks/:id/pause', wrap(async (req, res) => {
  const u = req.user;
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true });
    const open = (await db.query('SELECT user_id FROM time_entries WHERE task_id=$1 AND ended_at IS NULL', [t.id])).rows[0];
    if (!open) throw new HttpError(400, 'Não há cronômetro ativo nesta tarefa');
    if (open.user_id !== u.id && !isAdmin(u)) throw new HttpError(403, 'Apenas quem iniciou (ou um administrador) pode pausar');
    const secs = await closeOpenEntries(db, t);
    await db.query(`UPDATE tasks SET status='paused', updated_at=now() WHERE id=$1`, [t.id]);
    await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: t.title, userId: u.id, action: 'paused', details: { seconds: secs } });
  });
  changed(req);
  res.json(await fetchTask(req.params.id, req));
}));

app.post('/api/tasks/:id/finish', wrap(async (req, res) => {
  const u = req.user;
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true });
    if (t.status === 'done') throw new HttpError(400, 'Tarefa já concluída');
    if (t.status === 'cancelled') throw new HttpError(400, 'Tarefa cancelada');
    const open = (await db.query('SELECT user_id FROM time_entries WHERE task_id=$1 AND ended_at IS NULL', [t.id])).rows[0];
    if (open && open.user_id !== u.id && !isAdmin(u)) throw new HttpError(403, 'Outro colaborador está com o cronômetro ativo nesta tarefa');
    const secs = await closeOpenEntries(db, t);
    const inferred = await inferTime(db, t, u.id);
    const r = (await db.query(
      `UPDATE tasks SET status='done', completed_at=now(), updated_at=now() WHERE id=$1 RETURNING tracked_seconds`, [t.id])).rows[0];
    await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: t.title, userId: u.id, action: 'finished',
      details: { last_period_seconds: secs, total_seconds: r.tracked_seconds, ...(inferred && { inferred_seconds: inferred }) } });
    if (t.parent_task_id) await logEvent(db, { companyId: u.company_id, taskId: t.parent_task_id, userId: u.id, action: 'partner_delivered', details: { partner_task: t.title } });
  });
  changed(req);
  res.json(await fetchTask(req.params.id, req));
}));

// Lançamento manual de horário (início e fim)
app.post('/api/tasks/:id/manual-time', wrap(async (req, res) => {
  const u = req.user;
  const { started_at, ended_at, finish, user_id } = req.body || {};
  const subtaskId = req.body?.subtask_id ? parseInt(req.body.subtask_id, 10) : null;
  const s = new Date(started_at), e = new Date(ended_at);
  if (isNaN(s) || isNaN(e)) throw new HttpError(400, 'Informe data e horário de início e de finalização');
  if (e <= s) throw new HttpError(400, 'O horário de finalização deve ser posterior ao início');
  if (e - s > 24 * 3600 * 1000) throw new HttpError(400, 'Período maior que 24 horas. Divida em lançamentos menores.');
  if (e > new Date(Date.now() + 5 * 60 * 1000)) throw new HttpError(400, 'Não é possível lançar horários no futuro');
  const who = isAdmin(u) && user_id ? parseInt(user_id, 10) : u.id;
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true });
    if (t.status === 'cancelled') throw new HttpError(400, 'Tarefa cancelada');
    await assertRefs(db, u.company_id, { assignee_id: who });
    // lançamento real substitui tempo estimado no mesmo período
    await dropInferred(db, 'user_id=$1 AND tstzrange(started_at, ended_at) && tstzrange($2,$3)', [who, s, e]);
    const overlap = (await db.query(
      `SELECT 1 FROM time_entries WHERE user_id=$1 AND tstzrange(started_at, COALESCE(ended_at, now())) && tstzrange($2,$3)`, [who, s, e])).rowCount;
    if (overlap) throw new HttpError(409, 'Esse período se sobrepõe a outro registro de tempo do colaborador');
    const secs = Math.round((e - s) / 1000);
    if (subtaskId && !(await db.query('SELECT 1 FROM subtasks WHERE id=$1 AND task_id=$2', [subtaskId, t.id])).rowCount) throw new HttpError(400, 'Subtarefa inválida');
    await db.query(
      `INSERT INTO time_entries (company_id, task_id, user_id, started_at, ended_at, seconds, source, subtask_id) VALUES ($1,$2,$3,$4,$5,$6,'manual',$7)`,
      [u.company_id, t.id, who, s, e, secs, subtaskId]);
    if (subtaskId) await db.query('UPDATE subtasks SET tracked_seconds=tracked_seconds+$1 WHERE id=$2', [secs, subtaskId]);
    const sets = ['tracked_seconds=tracked_seconds+$1', 'started_at=LEAST(COALESCE(started_at,$2),$2)', 'updated_at=now()'];
    const params = [secs, s];
    if (finish) {
      await closeOpenEntries(db, t);
      params.push(e); sets.push(`status='done'`, `completed_at=$${params.length}`);
    } else if (t.status === 'not_started' || t.status === 'late') sets.push(`status='paused'`);
    params.push(t.id);
    await db.query(`UPDATE tasks SET ${sets.join(',')} WHERE id=$${params.length}`, params);
    await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: t.title, userId: u.id, action: 'manual_time',
      details: { started_at: s.toISOString(), ended_at: e.toISOString(), seconds: secs, for_user: who, finished: !!finish } });
  });
  changed(req);
  res.json(await fetchTask(req.params.id, req));
}));

app.delete('/api/time-entries/:id', adminOnly, wrap(async (req, res) => {
  await tx(async (db) => {
    const e = (await db.query('SELECT * FROM time_entries WHERE id=$1 AND company_id=$2', [req.params.id, req.user.company_id])).rows[0];
    if (!e) throw new HttpError(404, 'Registro não encontrado');
    if (!e.ended_at) throw new HttpError(400, 'Pause o cronômetro antes de excluir o registro');
    await db.query('DELETE FROM time_entries WHERE id=$1', [e.id]);
    const t = (await db.query('UPDATE tasks SET tracked_seconds=GREATEST(0,tracked_seconds-$1) WHERE id=$2 RETURNING title', [e.seconds, e.task_id])).rows[0];
    if (e.subtask_id) await db.query('UPDATE subtasks SET tracked_seconds=GREATEST(0,tracked_seconds-$1) WHERE id=$2', [e.seconds, e.subtask_id]);
    await logEvent(db, { companyId: req.user.company_id, taskId: e.task_id, taskTitle: t?.title, userId: req.user.id, action: 'time_removed',
      details: { seconds: e.seconds, started_at: e.started_at, ended_at: e.ended_at } });
  });
  changed(req);
  res.json({ ok: true });
}));

// Observações / dificuldades / andamento
app.post('/api/tasks/:id/notes', wrap(async (req, res) => {
  const body = String(req.body?.body || '').trim();
  const kind = ['note', 'difficulty', 'progress'].includes(req.body?.kind) ? req.body.kind : 'note';
  if (!body) throw new HttpError(400, 'Escreva a observação');
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { related: true }); // parceiros de tarefa em grupo também comentam
    await db.query('INSERT INTO task_notes (company_id, task_id, user_id, kind, body) VALUES ($1,$2,$3,$4,$5)', [req.user.company_id, t.id, req.user.id, kind, body.slice(0, 5000)]);
    await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'note_added', details: { kind } });
  });
  changed(req);
  res.json({ ok: true });
}));

// ---------- subtarefas ----------
async function loadSubtask(db, req, id) {
  const st = (await db.query('SELECT * FROM subtasks WHERE id=$1 AND company_id=$2 FOR UPDATE', [id, req.user.company_id])).rows[0];
  if (!st) throw new HttpError(404, 'Subtarefa não encontrada');
  const t = await loadTask(db, req, st.task_id, { forUpdate: true });
  return { st, t };
}
const myOpenEntry = async (db, userId) =>
  (await db.query(`SELECT e.*, tk.title FROM time_entries e JOIN tasks tk ON tk.id=e.task_id WHERE e.user_id=$1 AND e.ended_at IS NULL`, [userId])).rows[0];

app.post('/api/tasks/:id/subtasks', wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 300);
  if (!title) throw new HttpError(400, 'Informe o nome da subtarefa');
  let started = false;
  await tx(async (db) => {
    const t = await loadTask(db, req, req.params.id, { forUpdate: true });
    if (t.status === 'cancelled') throw new HttpError(400, 'Tarefa cancelada');
    const st = (await db.query(
      `INSERT INTO subtasks (company_id, task_id, title, created_by, position)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(max(position),0)+1 FROM subtasks WHERE task_id=$2)) RETURNING *`,
      [req.user.company_id, t.id, title, req.user.id])).rows[0];
    await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'subtask_added', details: { subtask: title } });
    // cronômetro da tarefa rodando com este usuário: a nova subtarefa já começa a contar
    const open = await myOpenEntry(db, req.user.id);
    if (open && open.task_id === t.id) {
      await switchSegment(db, open, st.id);
      await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'subtask_started', details: { subtask: title } });
      started = true;
    }
  });
  changed(req);
  res.json({ ok: true, started });
}));

app.patch('/api/subtasks/:id', wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 300);
  if (!title) throw new HttpError(400, 'Informe o nome da subtarefa');
  await tx(async (db) => { const { st } = await loadSubtask(db, req, req.params.id); await db.query('UPDATE subtasks SET title=$1 WHERE id=$2', [title, st.id]); });
  changed(req);
  res.json({ ok: true });
}));

app.delete('/api/subtasks/:id', wrap(async (req, res) => {
  await tx(async (db) => {
    const { st, t } = await loadSubtask(db, req, req.params.id);
    const open = (await db.query('SELECT * FROM time_entries WHERE subtask_id=$1 AND ended_at IS NULL', [st.id])).rows[0];
    if (open) await switchSegment(db, open, null);
    await db.query('DELETE FROM subtasks WHERE id=$1', [st.id]); // o tempo continua contando na tarefa principal
    await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'subtask_removed', details: { subtask: st.title, seconds: st.tracked_seconds } });
  });
  changed(req);
  res.json({ ok: true });
}));

app.post('/api/subtasks/:id/start', wrap(async (req, res) => {
  const u = req.user;
  await tx(async (db) => {
    const { st, t } = await loadSubtask(db, req, req.params.id);
    if (t.status === 'cancelled') throw new HttpError(400, 'Tarefa cancelada');
    if (st.done) await db.query('UPDATE subtasks SET done=false, completed_at=NULL WHERE id=$1', [st.id]);
    const open = await myOpenEntry(db, u.id);
    if (open && open.task_id !== t.id) throw new HttpError(409, `Você já tem um cronômetro ativo em "${open.title}". Pause ou finalize antes de iniciar outra tarefa.`);
    if (open && open.subtask_id === st.id) throw new HttpError(409, 'Esta subtarefa já está em andamento');
    if (open) await switchSegment(db, open, st.id);
    else {
      if ((await db.query('SELECT 1 FROM time_entries WHERE task_id=$1 AND ended_at IS NULL', [t.id])).rowCount) {
        throw new HttpError(409, 'Outro colaborador está com o cronômetro desta tarefa ativo');
      }
      await db.query(`INSERT INTO time_entries (company_id, task_id, user_id, started_at, source, subtask_id) VALUES ($1,$2,$3,now(),'timer',$4)`, [u.company_id, t.id, u.id, st.id]);
      await db.query(`UPDATE tasks SET status='in_progress', started_at=COALESCE(started_at, now()), completed_at=NULL, updated_at=now() WHERE id=$1`, [t.id]);
    }
    await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: t.title, userId: u.id, action: 'subtask_started', details: { subtask: st.title } });
  });
  changed(req);
  res.json({ ok: true });
}));

app.post('/api/subtasks/:id/finish', wrap(async (req, res) => {
  const u = req.user;
  await tx(async (db) => {
    const { st, t } = await loadSubtask(db, req, req.params.id);
    // se estava rodando, o cronômetro continua na tarefa principal
    const open = (await db.query('SELECT * FROM time_entries WHERE subtask_id=$1 AND ended_at IS NULL', [st.id])).rows[0];
    if (open) await switchSegment(db, open, null);
    const r = (await db.query('UPDATE subtasks SET done=true, completed_at=now() WHERE id=$1 RETURNING tracked_seconds', [st.id])).rows[0];
    await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: t.title, userId: u.id, action: 'subtask_finished', details: { subtask: st.title, seconds: r.tracked_seconds } });
  });
  changed(req);
  res.json({ ok: true });
}));

app.post('/api/subtasks/:id/reopen', wrap(async (req, res) => {
  await tx(async (db) => {
    const { st, t } = await loadSubtask(db, req, req.params.id);
    await db.query('UPDATE subtasks SET done=false, completed_at=NULL WHERE id=$1', [st.id]);
    await logEvent(db, { companyId: req.user.company_id, taskId: t.id, taskTitle: t.title, userId: req.user.id, action: 'subtask_reopened', details: { subtask: st.title } });
  });
  changed(req);
  res.json({ ok: true });
}));

// ---------- linha do tempo / jornada ----------
app.get('/api/timeline', requireTab('linha-do-tempo'), wrap(async (req, res) => {
  const today = todayIn(req.user.timezone);
  const date = isDate(req.query.date) ? req.query.date : today;
  res.json(await timeline({ companyId: req.user.company_id, date, today, userId: isAdmin(req.user) ? (req.query.user ? parseInt(req.query.user, 10) : null) : req.user.id }));
}));

app.get('/api/company', wrap(async (req, res) => {
  res.json(await one(`SELECT id, name, timezone, to_char(work_start,'HH24:MI') AS work_start, to_char(work_end,'HH24:MI') AS work_end,
    to_char(lunch_start,'HH24:MI') AS lunch_start, to_char(lunch_end,'HH24:MI') AS lunch_end FROM companies WHERE id=$1`, [req.user.company_id]));
}));

app.post('/api/timeline/backfill', adminOnly, wrap(async (req, res) => {
  const { day } = req.body || {};
  if (!isDate(day)) throw new HttpError(400, 'Data inválida');
  if (day >= todayIn(req.user.timezone)) throw new HttpError(400, 'Use apenas para dias anteriores');
  const r = await backfillInferred(req.user.company_id, day);
  broadcast(req.user.company_id, { type: 'tasks' });
  res.json(r);
}));



// ---------- tarefas em grupo ----------
const cleanLink = (v) => {
  const t = String(v || '').trim().slice(0, 2000);
  if (!t) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
};
const cleanText = (v, n = 5000) => { const t = String(v ?? '').trim(); return t ? t.slice(0, n) : null; };
async function loadGroup(db, req, { manage = false } = {}) {
  const g = (await db.query('SELECT * FROM group_tasks WHERE id=$1 AND company_id=$2', [req.params.id, req.user.company_id])).rows[0];
  if (!g) throw new HttpError(404, 'Tarefa em grupo não encontrada');
  if (isAdmin(req.user) || g.created_by === req.user.id) return g;
  const member = (await db.query('SELECT 1 FROM group_task_members WHERE group_id=$1 AND user_id=$2', [g.id, req.user.id])).rowCount;
  if (!member) throw new HttpError(403, 'Você não participa desta tarefa em grupo');
  if (manage) throw new HttpError(403, 'Só quem criou (ou um administrador) pode alterar');
  return g;
}
async function setMembers(db, companyId, groupId, ids) {
  const clean = [...new Set((ids || []).map((x) => parseInt(x, 10)).filter(Boolean))];
  const valid = clean.length ? (await db.query('SELECT id FROM users WHERE company_id=$1 AND active AND id = ANY($2::int[])', [companyId, clean])).rows.map((r) => r.id) : [];
  await db.query('DELETE FROM group_task_members WHERE group_id=$1 AND NOT (user_id = ANY($2::int[]))', [groupId, valid]);
  for (const id of valid) await db.query('INSERT INTO group_task_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, id]);
  // quem saiu do grupo larga os itens que estava fazendo
  await db.query(`UPDATE group_items SET status='todo', user_id=NULL, started_at=NULL WHERE group_id=$1 AND status='doing' AND NOT (user_id = ANY($2::int[]))`, [groupId, valid]);
}
const GROUP_SELECT = `SELECT g.id, g.title, g.description, g.link, g.business_id, b.name AS business_name, b.color AS business_color,
    g.channel_id, ch.name AS channel_name, ch.color AS channel_color, to_char(g.due_date,'YYYY-MM-DD') AS due_date,
    g.status, g.created_by, cu.name AS created_by_name, g.created_at, g.updated_at, g.done_at,
    (SELECT count(*)::int FROM group_items i WHERE i.group_id=g.id) AS items_total,
    (SELECT count(*)::int FROM group_items i WHERE i.group_id=g.id AND i.status='done') AS items_done,
    (SELECT count(*)::int FROM group_items i WHERE i.group_id=g.id AND i.status='doing') AS items_doing,
    COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'doing_since', m.doing_since,
        'item_id', (SELECT i.id FROM group_items i WHERE i.group_id=g.id AND i.user_id=u.id AND i.status='doing' LIMIT 1),
        'done', (SELECT count(*) FROM group_items i WHERE i.group_id=g.id AND i.user_id=u.id AND i.status='done'))
        ORDER BY u.name) FROM group_task_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=g.id), '[]') AS members
  FROM group_tasks g LEFT JOIN businesses b ON b.id=g.business_id LEFT JOIN channels ch ON ch.id=g.channel_id
  LEFT JOIN users cu ON cu.id=g.created_by`;
const groupVis = (req, params) => {
  if (isAdmin(req.user)) return '';
  params.push(req.user.id);
  return ` AND (g.created_by=$${params.length} OR EXISTS (SELECT 1 FROM group_task_members m WHERE m.group_id=g.id AND m.user_id=$${params.length}))`;
};
app.get('/api/groups', requireTab('grupo'), wrap(async (req, res) => {
  const params = [req.user.company_id];
  let where = 'g.company_id=$1' + groupVis(req, params);
  if (req.query.status === 'open' || req.query.status === 'done') { params.push(req.query.status); where += ` AND g.status=$${params.length}`; }
  if (req.query.business) { params.push(parseInt(req.query.business, 10)); where += ` AND g.business_id=$${params.length}`; }
  res.json(await many(`${GROUP_SELECT} WHERE ${where} ORDER BY g.status, g.due_date NULLS LAST, g.created_at DESC LIMIT 300`, params));
}));
app.get('/api/groups/:id', requireTab('grupo'), wrap(async (req, res) => {
  const g0 = await tx((db) => loadGroup(db, req));
  const g = await one(`${GROUP_SELECT} WHERE g.id=$1`, [g0.id]);
  g.items = await many(`SELECT i.id, i.link, i.description, i.status, i.user_id, u.name AS user_name, i.started_at, i.done_at, i.created_at, i.created_by
    FROM group_items i LEFT JOIN users u ON u.id=i.user_id WHERE i.group_id=$1 ORDER BY i.position, i.id`, [g0.id]);
  res.json(g);
}));
async function insertItems(db, groupId, userId, items) {
  const list = (Array.isArray(items) ? items : []).map((i) => ({ link: cleanLink(i.link), description: cleanText(i.description, 2000) })).filter((i) => i.link || i.description).slice(0, 500);
  if (!list.length) return 0;
  const start = (await db.query('SELECT COALESCE(max(position),0) AS p FROM group_items WHERE group_id=$1', [groupId])).rows[0].p;
  for (const [k, i] of list.entries()) {
    await db.query('INSERT INTO group_items (group_id, link, description, created_by, position) VALUES ($1,$2,$3,$4,$5)', [groupId, i.link, i.description, userId, start + k + 1]);
  }
  return list.length;
}
app.post('/api/groups', requireTab('grupo'), wrap(async (req, res) => {
  const u = req.user, b = req.body || {};
  const title = cleanText(b.title, 300);
  if (!title) throw new HttpError(400, 'Informe o nome da tarefa em grupo');
  const data = { business_id: b.business_id ? parseInt(b.business_id, 10) : null, channel_id: b.channel_id ? parseInt(b.channel_id, 10) : null };
  const id = await tx(async (db) => {
    await assertRefs(db, u.company_id, data);
    const g = (await db.query(`INSERT INTO group_tasks (company_id, title, description, link, business_id, channel_id, due_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u.company_id, title, cleanText(b.description), cleanLink(b.link), data.business_id, data.channel_id, isDate(b.due_date) ? b.due_date : null, u.id])).rows[0];
    const ids = b.all_members ? (await db.query('SELECT id FROM users WHERE company_id=$1 AND active', [u.company_id])).rows.map((r) => r.id) : [...(b.member_ids || []), u.id];
    await setMembers(db, u.company_id, g.id, ids);
    await insertItems(db, g.id, u.id, b.items);
    return g.id;
  });
  broadcast(u.company_id, { type: 'groups' });
  res.json(await one(`${GROUP_SELECT} WHERE g.id=$1`, [id]));
}));
app.patch('/api/groups/:id', requireTab('grupo'), wrap(async (req, res) => {
  const u = req.user, b = req.body || {};
  await tx(async (db) => {
    const onlyStatus = Object.keys(b).every((k) => k === 'status');
    const g = await loadGroup(db, req, { manage: !onlyStatus });
    const sets = [], params = [];
    const add = (k, v) => { params.push(v); sets.push(`${k}=$${params.length}`); };
    if ('title' in b) { const t = cleanText(b.title, 300); if (!t) throw new HttpError(400, 'O nome não pode ficar vazio'); add('title', t); }
    if ('description' in b) add('description', cleanText(b.description));
    if ('link' in b) add('link', cleanLink(b.link));
    if ('due_date' in b) add('due_date', isDate(b.due_date) ? b.due_date : null);
    for (const k of ['business_id', 'channel_id']) if (k in b) { const v = b[k] ? parseInt(b[k], 10) : null; await assertRefs(db, u.company_id, { [k]: v }); add(k, v); }
    if (b.status === 'done' || b.status === 'open') {
      add('status', b.status); sets.push(b.status === 'done' ? 'done_at=now()' : 'done_at=NULL');
      if (b.status === 'done') await db.query('UPDATE group_task_members SET doing_since=NULL WHERE group_id=$1', [g.id]);
    }
    if (sets.length) { sets.push('updated_at=now()'); params.push(g.id); await db.query(`UPDATE group_tasks SET ${sets.join(',')} WHERE id=$${params.length}`, params); }
    if (b.all_members) await setMembers(db, u.company_id, g.id, (await db.query('SELECT id FROM users WHERE company_id=$1 AND active', [u.company_id])).rows.map((r) => r.id));
    else if (Array.isArray(b.member_ids)) await setMembers(db, u.company_id, g.id, [...b.member_ids, g.created_by].filter(Boolean));
  });
  broadcast(u.company_id, { type: 'groups' });
  res.json({ ok: true });
}));
app.delete('/api/groups/:id', requireTab('grupo'), wrap(async (req, res) => {
  await tx(async (db) => { const g = await loadGroup(db, req, { manage: true }); await db.query('DELETE FROM group_tasks WHERE id=$1', [g.id]); });
  broadcast(req.user.company_id, { type: 'groups' });
  res.json({ ok: true });
}));
// "Fazendo isso" na atividade (sem item específico)
app.post('/api/groups/:id/doing', requireTab('grupo'), wrap(async (req, res) => {
  const on = req.body?.on !== false;
  await tx(async (db) => {
    const g = await loadGroup(db, req);
    if (g.status === 'done' && on) throw new HttpError(400, 'Esta tarefa em grupo já foi concluída');
    await db.query('INSERT INTO group_task_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [g.id, req.user.id]);
    await db.query('UPDATE group_task_members SET doing_since=$3 WHERE group_id=$1 AND user_id=$2', [g.id, req.user.id, on ? new Date() : null]);
    if (!on) await db.query(`UPDATE group_items SET status='todo', user_id=NULL, started_at=NULL WHERE group_id=$1 AND user_id=$2 AND status='doing'`, [g.id, req.user.id]);
  });
  broadcast(req.user.company_id, { type: 'groups' });
  res.json({ ok: true });
}));
app.post('/api/groups/:id/items', requireTab('grupo'), wrap(async (req, res) => {
  const n = await tx(async (db) => { const g = await loadGroup(db, req); return insertItems(db, g.id, req.user.id, req.body?.items); });
  if (!n) throw new HttpError(400, 'Informe ao menos um link ou descrição');
  broadcast(req.user.company_id, { type: 'groups' });
  res.json({ added: n });
}));
async function loadItem(db, req) {
  const i = (await db.query('SELECT * FROM group_items WHERE id=$1', [req.params.id])).rows[0];
  if (!i) throw new HttpError(404, 'Item não encontrado');
  const g = await loadGroup(db, { ...req, params: { id: i.group_id } });
  return { i, g };
}
app.patch('/api/group-items/:id', requireTab('grupo'), wrap(async (req, res) => {
  const u = req.user, b = req.body || {};
  await tx(async (db) => {
    const { i, g } = await loadItem(db, req);
    const canManage = isAdmin(u) || g.created_by === u.id;
    const takenByOther = i.status === 'doing' && i.user_id && i.user_id !== u.id;
    if (b.action === 'doing') {
      if (g.status === 'done') throw new HttpError(400, 'Esta tarefa em grupo já foi concluída');
      if (takenByOther) throw new HttpError(409, 'Outra pessoa já está fazendo este item');
      if (i.status === 'done') throw new HttpError(400, 'Este item já foi feito');
      // um item por vez: o que eu estava fazendo volta para "livre"
      await db.query(`UPDATE group_items SET status='todo', user_id=NULL, started_at=NULL WHERE group_id=$1 AND user_id=$2 AND status='doing' AND id<>$3`, [g.id, u.id, i.id]);
      await db.query(`UPDATE group_items SET status='doing', user_id=$2, started_at=now(), done_at=NULL WHERE id=$1`, [i.id, u.id]);
      await db.query('INSERT INTO group_task_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [g.id, u.id]);
      await db.query('UPDATE group_task_members SET doing_since=COALESCE(doing_since, now()) WHERE group_id=$1 AND user_id=$2', [g.id, u.id]);
    } else if (b.action === 'done') {
      if (takenByOther && !canManage) throw new HttpError(409, 'Outra pessoa está fazendo este item');
      await db.query(`UPDATE group_items SET status='done', user_id=COALESCE(user_id,$2), done_at=now() WHERE id=$1`, [i.id, u.id]);
    } else if (b.action === 'release' || b.action === 'reopen') {
      if (i.user_id && i.user_id !== u.id && !canManage) throw new HttpError(403, 'Só quem pegou o item (ou quem criou a tarefa) pode soltar');
      await db.query(`UPDATE group_items SET status='todo', user_id=NULL, started_at=NULL, done_at=NULL WHERE id=$1`, [i.id]);
    } else {
      if (i.created_by !== u.id && !canManage) throw new HttpError(403, 'Só quem adicionou o item (ou quem criou a tarefa) pode editar');
      const link = 'link' in b ? cleanLink(b.link) : i.link, description = 'description' in b ? cleanText(b.description, 2000) : i.description;
      if (!link && !description) throw new HttpError(400, 'Informe o link ou a descrição');
      await db.query('UPDATE group_items SET link=$2, description=$3 WHERE id=$1', [i.id, link, description]);
    }
    await db.query('UPDATE group_tasks SET updated_at=now() WHERE id=$1', [g.id]);
  });
  broadcast(u.company_id, { type: 'groups' });
  res.json({ ok: true });
}));
app.delete('/api/group-items/:id', requireTab('grupo'), wrap(async (req, res) => {
  await tx(async (db) => {
    const { i, g } = await loadItem(db, req);
    if (i.created_by !== req.user.id && !isAdmin(req.user) && g.created_by !== req.user.id) throw new HttpError(403, 'Só quem adicionou o item (ou quem criou a tarefa) pode excluir');
    await db.query('DELETE FROM group_items WHERE id=$1', [i.id]);
  });
  broadcast(req.user.company_id, { type: 'groups' });
  res.json({ ok: true });
}));

// ---------- mural de clientes ----------
const POST_SELECT = `SELECT p.id, p.business_id, p.parent_id, p.author_id, u.name AS author_name, p.kind,
    to_char(p.meeting_date,'YYYY-MM-DD') AS meeting_date, p.body, p.pinned, p.created_at, p.updated_at
  FROM client_posts p LEFT JOIN users u ON u.id=p.author_id`;
app.get('/api/client-posts/summary', requireTab('clientes'), wrap(async (req, res) => {
  res.json(await many(
    `SELECT p.business_id, count(*) FILTER (WHERE p.parent_id IS NULL)::int AS posts,
       count(*) FILTER (WHERE p.kind='meeting' AND p.parent_id IS NULL)::int AS meetings, max(p.created_at) AS last_at
     FROM client_posts p WHERE p.company_id=$1 GROUP BY p.business_id`, [req.user.company_id]));
}));
app.get('/api/client-posts', requireTab('clientes'), wrap(async (req, res) => {
  const b = req.query.business;
  const params = [req.user.company_id];
  let where = 'p.company_id=$1 AND p.parent_id IS NULL';
  if (b === 'general') where += ' AND p.business_id IS NULL';
  else if (b && b !== 'all') { params.push(parseInt(b, 10)); where += ` AND p.business_id=$${params.length}`; }
  if (req.query.kind === 'meeting') where += " AND p.kind='meeting'";
  if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 100)}%`); where += ` AND (p.body ILIKE $${params.length} OR EXISTS (SELECT 1 FROM client_posts r WHERE r.parent_id=p.id AND r.body ILIKE $${params.length}))`; }
  const posts = await many(`${POST_SELECT} WHERE ${where} ORDER BY p.pinned DESC, COALESCE(p.meeting_date, p.created_at::date) DESC, p.created_at DESC LIMIT 200`, params);
  const ids = posts.map((p) => p.id);
  const replies = ids.length ? await many(`${POST_SELECT} WHERE p.parent_id = ANY($1::int[]) ORDER BY p.created_at`, [ids]) : [];
  for (const p of posts) p.replies = replies.filter((r) => r.parent_id === p.id);
  res.json(posts);
}));
app.post('/api/client-posts', requireTab('clientes'), wrap(async (req, res) => {
  const u = req.user;
  const body = String(req.body?.body || '').trim();
  if (!body) throw new HttpError(400, 'Escreva o comentário');
  let businessId = req.body?.business_id ? parseInt(req.body.business_id, 10) : null;
  const parentId = req.body?.parent_id ? parseInt(req.body.parent_id, 10) : null;
  let kind = req.body?.kind === 'meeting' ? 'meeting' : 'comment';
  let meetingDate = kind === 'meeting' ? (isDate(req.body?.meeting_date) ? req.body.meeting_date : todayIn(u.timezone)) : null;
  if (parentId) {
    const parent = await one('SELECT business_id FROM client_posts WHERE id=$1 AND company_id=$2 AND parent_id IS NULL', [parentId, u.company_id]);
    if (!parent) throw new HttpError(404, 'Comentário não encontrado');
    businessId = parent.business_id; kind = 'comment'; meetingDate = null;
  } else if (businessId && !(await one('SELECT 1 AS x FROM businesses WHERE id=$1 AND company_id=$2', [businessId, u.company_id]))) {
    throw new HttpError(400, 'Empresa inválida');
  }
  const r = await one(`INSERT INTO client_posts (company_id, business_id, parent_id, author_id, kind, meeting_date, body) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [u.company_id, businessId, parentId, u.id, kind, meetingDate, body.slice(0, 20000)]);
  broadcast(u.company_id, { type: 'client_posts' });
  res.json(r);
}));
async function loadPost(req) {
  const p = await one('SELECT * FROM client_posts WHERE id=$1 AND company_id=$2', [req.params.id, req.user.company_id]);
  if (!p) throw new HttpError(404, 'Comentário não encontrado');
  return p;
}
app.patch('/api/client-posts/:id', requireTab('clientes'), wrap(async (req, res) => {
  const p = await loadPost(req);
  const b = req.body || {};
  const onlyPin = Object.keys(b).length === 1 && 'pinned' in b;
  if (!onlyPin && p.author_id !== req.user.id && !isAdmin(req.user)) throw new HttpError(403, 'Só quem escreveu (ou um administrador) pode editar');
  const sets = [], params = [];
  const add = (k, v) => { params.push(v); sets.push(`${k}=$${params.length}`); };
  if ('body' in b) { const t = String(b.body || '').trim(); if (!t) throw new HttpError(400, 'O comentário não pode ficar vazio'); add('body', t.slice(0, 20000)); }
  if ('pinned' in b && !p.parent_id) add('pinned', !!b.pinned);
  if (!p.parent_id && 'kind' in b) add('kind', b.kind === 'meeting' ? 'meeting' : 'comment');
  if (!p.parent_id && 'meeting_date' in b) add('meeting_date', isDate(b.meeting_date) ? b.meeting_date : null);
  if (!p.parent_id && 'business_id' in b) add('business_id', b.business_id ? parseInt(b.business_id, 10) : null);
  if (!sets.length) throw new HttpError(400, 'Nada para atualizar');
  if (!onlyPin) sets.push('updated_at=now()');
  params.push(p.id);
  await q(`UPDATE client_posts SET ${sets.join(',')} WHERE id=$${params.length}`, params);
  broadcast(req.user.company_id, { type: 'client_posts' });
  res.json({ ok: true });
}));
app.delete('/api/client-posts/:id', requireTab('clientes'), wrap(async (req, res) => {
  const p = await loadPost(req);
  if (p.author_id !== req.user.id && !isAdmin(req.user)) throw new HttpError(403, 'Só quem escreveu (ou um administrador) pode excluir');
  await q('DELETE FROM client_posts WHERE id=$1', [p.id]);
  broadcast(req.user.company_id, { type: 'client_posts' });
  res.json({ ok: true });
}));

// início considerado de um dia específico (admin): antes dele não conta atraso nem inatividade
app.put('/api/day-start', adminOnly, wrap(async (req, res) => {
  const { day, start_time, reason } = req.body || {};
  if (!isDate(day)) throw new HttpError(400, 'Data inválida');
  if (!start_time) {
    await q('DELETE FROM day_starts WHERE company_id=$1 AND day=$2', [req.user.company_id, day]);
  } else {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)) throw new HttpError(400, 'Horário inválido');
    await q(`INSERT INTO day_starts (company_id, day, start_time, reason) VALUES ($1,$2,$3,$4)
      ON CONFLICT (company_id, day) DO UPDATE SET start_time=EXCLUDED.start_time, reason=EXCLUDED.reason`,
      [req.user.company_id, day, start_time, reason?.trim() || null]);
  }
  broadcast(req.user.company_id, { type: 'company' });
  res.json({ ok: true });
}));

app.patch('/api/company', adminOnly, wrap(async (req, res) => {
  const { name, work_start, work_end, lunch_start, lunch_end } = req.body || {};
  const re = /^\d{2}:\d{2}$/;
  if (work_start && !re.test(work_start)) throw new HttpError(400, 'Horário de início inválido');
  if (work_end && !re.test(work_end)) throw new HttpError(400, 'Horário de término inválido');
  if (work_start && work_end && work_end <= work_start) throw new HttpError(400, 'O término da jornada deve ser depois do início');
  for (const v of [lunch_start, lunch_end]) if (v && !re.test(v)) throw new HttpError(400, 'Horário de almoço inválido');
  if (lunch_start && lunch_end && lunch_end <= lunch_start) throw new HttpError(400, 'O fim do almoço deve ser depois do início');
  if (lunch_start && work_start && (lunch_start < work_start || lunch_end > work_end)) throw new HttpError(400, 'O almoço deve estar dentro da jornada');
  await q(`UPDATE companies SET name=COALESCE($1,name), work_start=COALESCE($2::time,work_start), work_end=COALESCE($3::time,work_end),
     lunch_start=COALESCE($5::time,lunch_start), lunch_end=COALESCE($6::time,lunch_end) WHERE id=$4`,
    [name?.trim() || null, work_start || null, work_end || null, req.user.company_id, lunch_start || null, lunch_end || null]);
  changed(req);
  res.json({ ok: true });
}));

// ---------- administração: limpar atividades ----------
app.post('/api/admin/clear-tasks', adminOnly, wrap(async (req, res) => {
  const { confirm, user_id } = req.body || {};
  if (confirm !== 'LIMPAR') throw new HttpError(400, 'Digite LIMPAR para confirmar');
  const cid = req.user.company_id;
  const uid = user_id ? parseInt(user_id, 10) : null;
  if (uid) await assertRefs(pool, cid, { assignee_id: uid });
  const result = await tx(async (db) => {
    const ids = (await db.query(`SELECT id FROM tasks WHERE company_id=$1 ${uid ? 'AND assignee_id=$2' : ''}`, uid ? [cid, uid] : [cid])).rows.map((r) => r.id);
    // recorrências: todas da empresa, ou as do colaborador (responsável no modelo)
    const recs = await db.query(
      `DELETE FROM recurrences WHERE company_id=$1 ${uid ? `AND (template->>'assignee_id')::int = $2` : ''} RETURNING id`, uid ? [cid, uid] : [cid]);
    const entries = await db.query(
      `DELETE FROM time_entries WHERE company_id=$1 AND (task_id = ANY($2::int[]) ${uid ? 'OR user_id=$3' : 'OR TRUE'}) RETURNING id`,
      uid ? [cid, ids, uid] : [cid, ids]);
    await db.query('DELETE FROM task_events WHERE company_id=$1 AND task_id = ANY($2::int[])', [cid, ids]);
    const del = await db.query('DELETE FROM tasks WHERE id = ANY($1::int[])', [ids]);
    // recalcula o tempo das tarefas restantes (caso tenha removido registros de outra pessoa nelas)
    if (uid) await db.query(`UPDATE tasks t SET tracked_seconds = COALESCE((SELECT sum(seconds) FROM time_entries e WHERE e.task_id=t.id AND e.ended_at IS NOT NULL),0) WHERE company_id=$1`, [cid]);
    await logEvent(db, { companyId: cid, userId: req.user.id, action: 'tasks_cleared',
      details: { user_id: uid, tasks: del.rowCount, recurrences: recs.rowCount, time_entries: entries.rowCount } });
    return { tasks: del.rowCount, recurrences: recs.rowCount, time_entries: entries.rowCount };
  });
  changed(req);
  res.json({ ok: true, ...result });
}));

// ---------- rotina em lote ----------
// Cria recorrências para cada combinação colaborador × canal × empresa × atividade
app.post('/api/routines/bulk', adminOnly, wrap(async (req, res) => {
  const cid = req.user.company_id;
  const today = todayIn(req.user.timezone);
  const { assignments = [], business_ids = [], daily = [], weekly = [], category_id, start_date, include_current_week } = req.body || {};
  const start = isDate(start_date) && start_date >= today ? start_date : today;
  const biz = business_ids.length ? business_ids.map(Number) : [null];
  const clean = (list) => list.map((a) => ({ ...a, title: String(a.title || '').trim().slice(0, 300) })).filter((a) => a.title);
  const D = clean(daily), W = clean(weekly);
  const combos = [];
  for (const a of assignments) {
    const chans = a.channel_ids?.length ? a.channel_ids.map(Number) : [null];
    for (const ch of chans) for (const b of biz) combos.push({ user: Number(a.user_id), channel: ch, business: b });
  }
  if (!combos.length || (!D.length && !W.length)) throw new HttpError(400, 'Escolha colaboradores e ao menos uma atividade');
  const plan = [];
  for (const c of combos) {
    for (const a of D) if (!(a.exclude_channel_ids || []).map(Number).includes(c.channel)) plan.push({ ...c, a, freq: 'daily' });
    for (const a of W) if (!(a.exclude_channel_ids || []).map(Number).includes(c.channel)) plan.push({ ...c, a, freq: 'weekly' });
  }
  if (plan.length > 600) throw new HttpError(400, `São ${plan.length} rotinas; o limite por vez é 600`);
  const out = await tx(async (db) => {
    for (const c of combos) await assertRefs(db, cid, { assignee_id: c.user, channel_id: c.channel, business_id: c.business, category_id: category_id || null });
    let recurrences = 0, tasks = 0;
    for (const p of plan) {
      let first;
      if (p.freq === 'daily') first = nextBusinessDay(start);
      else { // próximo dia da semana escolhido (1=segunda ... 5=sexta), a partir da data inicial
        const wd = Math.min(7, Math.max(1, Number(p.a.weekday) || 1));
        // incluir a semana atual: parte da segunda-feira desta semana (a ocorrência já passada entra como atrasada)
        first = include_current_week ? weekStart(start) : start; let g = 0;
        while (((new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1 !== wd && g++ < 7) first = addDays(first, 1);
      }
      const template = {
        title: p.a.title, description: p.a.description || '', kind: p.freq === 'daily' ? 'daily' : 'weekly',
        assignee_id: p.user, business_id: p.business, channel_id: p.channel, category_id: category_id || null,
        priority: p.a.priority || 'medium', estimated_minutes: Number(p.a.estimated_minutes) || 0, scheduled_time: p.a.scheduled_time || null,
        anchor_date: first,
      };
      const r = (await db.query(
        `INSERT INTO recurrences (company_id, frequency, template, next_date, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [cid, p.freq, JSON.stringify(template), first, req.user.id])).rows[0];
      recurrences++;
      if (first < today) { // ocorrência desta semana que já passou: cria mesmo assim (aparece como pendente/atrasada)
        await insertTaskFromTemplate(db, cid, template, first, r.id, req.user.id);
        r.next_date = nextOccurrence(p.freq, first, first);
        tasks++;
      }
      tasks += await generateRecurrence(db, cid, r, today);
    }
    await logEvent(db, { companyId: cid, userId: req.user.id, action: 'routine_created', details: { recurrences, tasks } });
    return { recurrences, tasks };
  });
  changed(req);
  res.json({ ok: true, ...out });
}));
const nextBusinessDay = (d) => { let x = d; while (!isBusinessDay(x)) x = addDays(x, 1); return x; };

// ---------- aba Resumo: apontamentos e lembretes pessoais ----------
// Cada pessoa cria e edita os próprios; administradores podem consultar os de qualquer colaborador.
const NOTE_SELECT = `
  SELECT n.*, to_char(n.remind_time,'HH24:MI') AS remind_time, b.name AS business_name, b.color AS business_color,
    ch.name AS channel_name, ch.color AS channel_color, t.status AS task_status, t.due_date AS task_due_date
  FROM notes n LEFT JOIN businesses b ON b.id=n.business_id LEFT JOIN channels ch ON ch.id=n.channel_id
  LEFT JOIN tasks t ON t.id=n.task_id`;

function noteOwner(req) {
  const asked = req.query.user ? parseInt(req.query.user, 10) : null;
  return isAdmin(req.user) && asked ? asked : req.user.id;
}

function cleanNote(b, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (!partial) {
    if (!['note', 'reminder'].includes(b.kind)) throw new HttpError(400, 'Tipo inválido');
    out.kind = b.kind;
  }
  if (has('title')) out.title = String(b.title || '').trim().slice(0, 300);
  if (has('body')) out.body = String(b.body || '').slice(0, 10000);
  if (has('pinned')) out.pinned = !!b.pinned;
  if (has('remind_date')) { if (b.remind_date && !isDate(b.remind_date)) throw new HttpError(400, 'Data do lembrete inválida'); out.remind_date = b.remind_date || null; }
  if (has('remind_time')) {
    const v = b.remind_time || null;
    if (v && !/^\d{2}:\d{2}(:\d{2})?$/.test(v)) throw new HttpError(400, 'Horário do lembrete inválido');
    out.remind_time = v;
  }
  for (const k of ['business_id', 'channel_id']) if (has(k)) out[k] = b[k] ? parseInt(b[k], 10) : null;
  return out;
}

app.get('/api/notes', wrap(async (req, res) => {
  const uid = noteOwner(req);
  const params = [req.user.company_id, uid];
  let w = 'n.company_id=$1 AND n.user_id=$2';
  if (req.query.kind === 'note' || req.query.kind === 'reminder') { params.push(req.query.kind); w += ` AND n.kind=$${params.length}`; }
  res.json(await many(`${NOTE_SELECT} WHERE ${w}
    ORDER BY CASE WHEN n.kind='reminder' THEN n.remind_date END NULLS LAST, n.remind_time NULLS LAST, n.pinned DESC, n.created_at DESC LIMIT 500`, params));
}));

app.post('/api/notes', wrap(async (req, res) => {
  const u = req.user;
  const data = cleanNote(req.body || {});
  const today = todayIn(u.timezone);
  if (data.kind === 'note' && !data.body?.trim() && !data.title) throw new HttpError(400, 'Escreva o apontamento');
  if (data.kind === 'reminder') {
    if (!data.title) throw new HttpError(400, 'Informe o assunto do lembrete');
    if (!data.remind_date) throw new HttpError(400, 'Informe a data do lembrete');
    if (data.remind_date < today) throw new HttpError(400, 'A data do lembrete não pode estar no passado');
  }
  const note = await tx(async (db) => {
    await assertRefs(db, u.company_id, { business_id: data.business_id, channel_id: data.channel_id });
    let taskId = null;
    if (data.kind === 'reminder') {
      // o lembrete já vira uma tarefa do próprio colaborador na data marcada
      const t = await insertTaskFromTemplate(db, u.company_id, {
        kind: 'daily', title: data.title, assignee_id: u.id, priority: req.body.priority || 'medium',
        description: [data.body, '(Tarefa criada a partir de um lembrete)'].filter(Boolean).join('\n\n'),
        scheduled_time: data.remind_time, business_id: data.business_id, channel_id: data.channel_id,
      }, data.remind_date, null, u.id);
      await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: t.title, userId: u.id, action: 'created', details: { from_reminder: true } });
      taskId = t.id;
    }
    const cols = { ...data, company_id: u.company_id, user_id: u.id, task_id: taskId };
    const keys = Object.keys(cols);
    const row = (await db.query(`INSERT INTO notes (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, keys.map((k) => cols[k]))).rows[0];
    if (data.kind === 'note') await touchDay(db, u.company_id, u.id, today);
    return row;
  });
  changed(req);
  res.json(await one(`${NOTE_SELECT} WHERE n.id=$1`, [note.id]));
}));

async function loadOwnNote(db, req, id) {
  const n = (await db.query('SELECT * FROM notes WHERE id=$1 AND company_id=$2 FOR UPDATE', [id, req.user.company_id])).rows[0];
  if (!n) throw new HttpError(404, 'Registro não encontrado');
  if (n.user_id !== req.user.id) throw new HttpError(403, 'Só quem criou pode alterar');
  return n;
}

app.patch('/api/notes/:id', wrap(async (req, res) => {
  const u = req.user;
  const data = cleanNote(req.body || {}, { partial: true });
  const today = todayIn(u.timezone);
  await tx(async (db) => {
    const n = await loadOwnNote(db, req, req.params.id);
    await assertRefs(db, u.company_id, { business_id: data.business_id, channel_id: data.channel_id });
    if (n.kind === 'reminder') {
      if ('title' in data && !data.title) throw new HttpError(400, 'Informe o assunto do lembrete');
      if ('remind_date' in data && (!data.remind_date || (data.remind_date < today && data.remind_date !== n.remind_date))) throw new HttpError(400, 'Data do lembrete inválida');
    }
    const keys = Object.keys(data);
    if (keys.length) await db.query(`UPDATE notes SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=now() WHERE id=$${keys.length + 1}`, [...keys.map((k) => data[k]), n.id]);
    if (n.kind === 'note' && keys.some((k) => k !== 'pinned')) await touchDay(db, u.company_id, u.id, await noteDay(db, n.id));
    // mantém a tarefa do lembrete em sincronia enquanto ela não foi concluída
    if (n.kind === 'reminder' && n.task_id) {
      const t = (await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [n.task_id])).rows[0];
      if (t && !['done', 'cancelled'].includes(t.status)) {
        const sets = {};
        if ('title' in data) sets.title = data.title;
        if ('remind_time' in data) sets.scheduled_time = data.remind_time;
        if ('business_id' in data) sets.business_id = data.business_id;
        if ('channel_id' in data) sets.channel_id = data.channel_id;
        if ('remind_date' in data && data.remind_date !== t.planned_date) Object.assign(sets, { due_date: data.remind_date, planned_date: data.remind_date, week_start: weekStart(data.remind_date) });
        const ks = Object.keys(sets);
        if (ks.length) {
          await db.query(`UPDATE tasks SET ${ks.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=now() WHERE id=$${ks.length + 1}`, [...ks.map((k) => sets[k]), t.id]);
          await logEvent(db, { companyId: u.company_id, taskId: t.id, taskTitle: sets.title || t.title, userId: u.id, action: 'updated', details: { from_reminder: true, fields: ks } });
        }
      }
    }
  });
  changed(req);
  res.json(await one(`${NOTE_SELECT} WHERE n.id=$1`, [req.params.id]));
}));

app.delete('/api/notes/:id', wrap(async (req, res) => {
  let taskRemoved = false;
  await tx(async (db) => {
    const n = await loadOwnNote(db, req, req.params.id);
    if (n.kind === 'reminder' && n.task_id) {
      // remove a tarefa só se ainda não foi trabalhada; senão ela fica no histórico
      const del = await db.query(
        `DELETE FROM tasks WHERE id=$1 AND status IN ('not_started','late') AND tracked_seconds=0
           AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id=tasks.id) RETURNING id, title`, [n.task_id]);
      if (del.rowCount) {
        taskRemoved = true;
        await logEvent(db, { companyId: req.user.company_id, taskId: n.task_id, taskTitle: del.rows[0].title, userId: req.user.id, action: 'deleted', details: { from_reminder: true } });
      }
    }
    if (n.kind === 'note') await touchDay(db, req.user.company_id, req.user.id, await noteDay(db, n.id));
    await db.query('DELETE FROM notes WHERE id=$1', [n.id]);
  });
  changed(req);
  res.json({ ok: true, task_removed: taskRemoved });
}));

// Resumo do dia de uma pessoa (a própria, ou qualquer colaborador para administradores)
app.get('/api/summary', wrap(async (req, res) => {
  const u = req.user;
  const uid = noteOwner(req);
  const today = todayIn(u.timezone);
  const person = await one('SELECT id, name FROM users WHERE id=$1 AND company_id=$2', [uid, u.company_id]);
  if (!person) throw new HttpError(404, 'Colaborador não encontrado');
  const counts = await one(
    `SELECT count(*) FILTER (WHERE due_date=$3 AND status<>'cancelled')::int AS total,
       count(*) FILTER (WHERE due_date=$3 AND status='done')::int AS done,
       count(*) FILTER (WHERE due_date=$3 AND status='in_progress')::int AS in_progress,
       count(*) FILTER (WHERE status NOT IN ('done','cancelled') AND ((kind='daily' AND planned_date < $3) OR (kind<>'daily' AND due_date < $3)))::int AS overdue,
       count(*) FILTER (WHERE kind='weekly' AND week_start=$4 AND status<>'cancelled')::int AS week_total,
       count(*) FILTER (WHERE kind='weekly' AND week_start=$4 AND status='done')::int AS week_done
     FROM tasks WHERE company_id=$1 AND assignee_id=$2`, [u.company_id, uid, today, weekStart(today)]);
  const time = await one(
    `SELECT COALESCE(sum(CASE WHEN ended_at IS NULL THEN EXTRACT(EPOCH FROM now()-started_at) ELSE seconds END),0)::int AS seconds
     FROM time_entries WHERE company_id=$1 AND user_id=$2 AND (started_at AT TIME ZONE $4)::date=$3`, [u.company_id, uid, today, u.timezone]);
  const tl = await timeline({ companyId: u.company_id, date: today, today, userId: uid });
  const reminders = await many(`${NOTE_SELECT} WHERE n.user_id=$1 AND n.kind='reminder' AND n.remind_date >= $2
      AND COALESCE(t.status,'') NOT IN ('done','cancelled') ORDER BY n.remind_date, n.remind_time NULLS LAST LIMIT 5`, [uid, today]);
  const notesToday = await one(`SELECT count(*)::int AS n FROM notes WHERE user_id=$1 AND kind='note' AND (created_at AT TIME ZONE $3)::date=$2`, [uid, today, u.timezone]);
  res.json({ today, person, counts, seconds: time.seconds, day: tl.people[0]?.metrics || null, work_start: tl.work_start, reminders, notes_today: notesToday.n });
}));

// ---------- lançamentos do dia + resumo por IA ----------
// Os lançamentos ficam em notes (kind='note'); a tabela notepads guarda o resumo de cada pessoa por dia.
const localDay = (col) => `(${col} AT TIME ZONE (SELECT timezone FROM companies WHERE id=n.company_id))::date`;

// marca o dia como alterado (para o resumo automático refazer)
async function touchDay(db, companyId, userId, day) {
  await db.query(
    `INSERT INTO notepads (company_id, user_id, day) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, day) DO UPDATE SET updated_at=now()`, [companyId, userId, day]);
}
const noteDay = async (db, noteId) => (await db.query(`SELECT to_char(${localDay('n.created_at')},'YYYY-MM-DD') AS d FROM notes n WHERE n.id=$1`, [noteId])).rows[0]?.d;

const SUMMARY_COLS = `to_char(day,'YYYY-MM-DD') AS day, summary, summary_at, summary_error, updated_at`;

app.get('/api/notepad', wrap(async (req, res) => {
  const uid = noteOwner(req);
  const today = todayIn(req.user.timezone);
  const day = isDate(req.query.date) ? req.query.date : today;
  if (uid !== req.user.id) await assertRefs(pool, req.user.company_id, { assignee_id: uid });
  const pad = await one(`SELECT ${SUMMARY_COLS} FROM notepads WHERE user_id=$1 AND day=$2`, [uid, day]);
  const entries = await many(`${NOTE_SELECT} WHERE n.user_id=$1 AND n.kind='note' AND ${localDay('n.created_at')}=$2 ORDER BY n.created_at DESC`, [uid, day]);
  const days = await many(
    `SELECT to_char(${localDay('n.created_at')},'YYYY-MM-DD') AS day, count(*)::int AS entries
     FROM notes n WHERE n.user_id=$1 AND n.kind='note' GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, [uid]);
  const summarized = new Set((await many(`SELECT to_char(day,'YYYY-MM-DD') AS d FROM notepads WHERE user_id=$1 AND summary IS NOT NULL`, [uid])).map((r) => r.d));
  days.forEach((d) => (d.has_summary = summarized.has(d.day)));
  res.json({ day, today, ai: aiEnabled(), readonly: uid !== req.user.id, entries, days,
    pad: pad || { day, summary: null, summary_at: null, summary_error: null, updated_at: null } });
}));

export async function summarizeDay(companyId, userId, day) {
  const person = await one('SELECT name FROM users WHERE id=$1', [userId]);
  const entries = await many(
    `SELECT to_char(n.created_at AT TIME ZONE c.timezone,'HH24:MI') AS hm, n.title, n.body, b.name AS business, ch.name AS channel
     FROM notes n JOIN companies c ON c.id=n.company_id LEFT JOIN businesses b ON b.id=n.business_id LEFT JOIN channels ch ON ch.id=n.channel_id
     WHERE n.user_id=$1 AND n.kind='note' AND (n.created_at AT TIME ZONE c.timezone)::date=$2 ORDER BY n.created_at`, [userId, day]);
  if (!entries.length) throw new HttpError(400, 'Não há lançamentos neste dia para resumir');
  const content = entries.map((e) => {
    const tag = [e.business, e.channel].filter(Boolean).join(' · ');
    return `${e.hm}${tag ? ` [${tag}]` : ''} ${e.title ? e.title + ' — ' : ''}${e.body}`;
  }).join('\n');
  const [biz, chans] = await Promise.all([
    many('SELECT name FROM businesses WHERE company_id=$1 ORDER BY name', [companyId]),
    many('SELECT name FROM channels WHERE company_id=$1 ORDER BY name', [companyId]),
  ]);
  await q(`INSERT INTO notepads (company_id, user_id, day) VALUES ($1,$2,$3) ON CONFLICT (user_id, day) DO NOTHING`, [companyId, userId, day]);
  try {
    const summary = await summarizeNotes({ content, personName: person.name, day, businesses: biz.map((b) => b.name), channels: chans.map((c) => c.name) });
    await q('UPDATE notepads SET summary=$1, summary_at=now(), summary_error=NULL WHERE user_id=$2 AND day=$3', [JSON.stringify(summary), userId, day]);
  } catch (e) {
    await q('UPDATE notepads SET summary_error=$1 WHERE user_id=$2 AND day=$3', [e.message.slice(0, 500), userId, day]);
    throw new HttpError(502, e.message);
  }
  broadcast(companyId, { reason: 'notepad' });
}

app.post('/api/notepad/:day/summarize', wrap(async (req, res) => {
  const uid = noteOwner(req);
  if (!isDate(req.params.day)) throw new HttpError(400, 'Data inválida');
  if (!aiEnabled()) throw new HttpError(400, 'A IA ainda não foi configurada no servidor (ANTHROPIC_API_KEY)');
  if (uid !== req.user.id) await assertRefs(pool, req.user.company_id, { assignee_id: uid });
  await summarizeDay(req.user.company_id, uid, req.params.day);
  res.json(await one(`SELECT ${SUMMARY_COLS} FROM notepads WHERE user_id=$1 AND day=$2`, [uid, req.params.day]));
}));

// Resumo automático no fim do dia: dias anteriores, ou hoje após o fim da jornada (sem lançamentos nos últimos 15 min)
let autoBusy = false;
async function autoSummarize() {
  if (!aiEnabled() || autoBusy) return;
  autoBusy = true;
  try {
    const pending = await many(
      `SELECT p.company_id, p.user_id, to_char(p.day,'YYYY-MM-DD') AS day FROM notepads p JOIN companies c ON c.id=p.company_id
       WHERE (p.day < (now() AT TIME ZONE c.timezone)::date
              OR (p.day = (now() AT TIME ZONE c.timezone)::date AND (now() AT TIME ZONE c.timezone)::time >= c.work_end))
         AND p.updated_at < now() - interval '15 minutes'
         AND (p.summary_at IS NULL OR p.summary_at < p.updated_at)
         AND (p.summary_error IS NULL OR p.updated_at > now() - interval '1 day')
         AND EXISTS (SELECT 1 FROM notes n WHERE n.user_id=p.user_id AND n.kind='note' AND (n.created_at AT TIME ZONE c.timezone)::date=p.day)
       ORDER BY p.day DESC LIMIT 5`);
    for (const p of pending) { try { await summarizeDay(p.company_id, p.user_id, p.day); } catch (e) { console.error('[resumo IA]', e.message); } }
  } finally { autoBusy = false; }
}
setInterval(autoSummarize, 10 * 60 * 1000);
setTimeout(autoSummarize, 30000);

// ---------- alertas ----------
app.get('/api/alerts', wrap(async (req, res) => {
  const u = req.user;
  const today = todayIn(u.timezone);
  const tomorrow = addDays(today, 1);
  const params = [u.company_id, today, tomorrow];
  const vis = isAdmin(u) ? 'TRUE' : `t.assignee_id=$4`;
  if (!isAdmin(u)) params.push(u.id);
  const rows = await many(
    `SELECT t.id, t.title, t.kind, t.due_date, t.planned_date, t.scheduled_time, t.priority, t.status, u.name AS assignee_name,
       CASE WHEN (t.kind='daily' AND t.planned_date < $2) OR (t.kind<>'daily' AND t.due_date < $2) THEN 'overdue'
            WHEN t.due_date = $2 THEN 'today' ELSE 'tomorrow' END AS level
     FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.company_id=$1 AND ${vis} AND t.status NOT IN ('done','cancelled')
       AND ( (t.kind='daily' AND t.planned_date < $2) OR (t.kind<>'daily' AND t.due_date <= $3) OR (t.kind='daily' AND t.due_date=$2 AND t.priority IN ('high','urgent')) )
     ORDER BY CASE WHEN (t.kind='daily' AND t.planned_date < $2) OR (t.kind<>'daily' AND t.due_date < $2) THEN 0 WHEN t.due_date=$2 THEN 1 ELSE 2 END, t.due_date
     LIMIT 50`, params);
  const reminders = await many(
    `SELECT n.id AS note_id, n.task_id AS id, n.title, n.remind_date, to_char(n.remind_time,'HH24:MI') AS remind_time,
       COALESCE(t.status,'not_started') AS status, 'reminder' AS level, 'reminder' AS kind
     FROM notes n LEFT JOIN tasks t ON t.id=n.task_id
     WHERE n.user_id=$1 AND n.kind='reminder' AND n.remind_date <= $2 AND COALESCE(t.status,'') NOT IN ('done','cancelled')
     ORDER BY n.remind_date, n.remind_time NULLS FIRST LIMIT 20`, [u.id, today]);
  // a tarefa do lembrete já aparece como lembrete: evita duplicar
  const ids = new Set(reminders.map((r) => r.id));
  res.json([...reminders, ...rows.filter((r) => !ids.has(r.id))]);
}));

// ---------- histórico ----------
app.get('/api/events', requireTab('historico'), wrap(async (req, res) => {
  const u = req.user;
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
  const params = [u.company_id];
  let w = `ev.company_id=$1 AND ev.action <> 'created_by_recurrence'`;
  if (!isAdmin(u)) { params.push(u.id); w += ` AND ev.task_id IN (SELECT id FROM tasks WHERE assignee_id=$2)`; }
  if (req.query.user && isAdmin(u)) { params.push(parseInt(req.query.user, 10)); w += ` AND ev.user_id=$${params.length}`; }
  params.push(limit);
  res.json(await many(
    `SELECT ev.*, u.name AS user_name FROM task_events ev LEFT JOIN users u ON u.id=ev.user_id WHERE ${w} ORDER BY ev.created_at DESC, ev.id DESC LIMIT $${params.length}`, params));
}));

// ---------- métricas ----------
function periodFromQuery(req) {
  const today = todayIn(req.user.timezone);
  let { from, to, period } = req.query;
  if (!isDate(from) || !isDate(to)) {
    if (period === 'today') { from = today; to = today; }
    else if (period === 'month') { from = today.slice(0, 8) + '01'; to = addDays(addMonths(from, 1), -1); }
    else { from = weekStart(today); to = addDays(from, 6); }
  }
  if (from > to) [from, to] = [to, from];
  if (addDays(from, 366) < to) throw new HttpError(400, 'Período máximo de 1 ano');
  return { from, to };
}
const dimsFromQuery = (req) => ({ categoryId: req.query.category || null, businessId: req.query.business || null, channelId: req.query.channel || null });
const scopeUser = (req) => (isAdmin(req.user) ? (req.query.user ? parseInt(req.query.user, 10) : null) : req.user.id);

app.get('/api/dashboard', requireTab('dashboard'), wrap(async (req, res) => {
  const { from, to } = periodFromQuery(req);
  res.json(await dashboard({ companyId: req.user.company_id, tz: req.user.timezone, from, to, userId: scopeUser(req), dims: dimsFromQuery(req) }));
}));

app.get('/api/reports', requireTab('relatorios'), wrap(async (req, res) => {
  const { from, to } = periodFromQuery(req);
  res.json(await report({ companyId: req.user.company_id, tz: req.user.timezone, from, to, userId: scopeUser(req),
    status: req.query.status || null, dims: dimsFromQuery(req) }));
}));

app.get('/api/reports/export.xlsx', requireTab('relatorios'), wrap(async (req, res) => {
  const { from, to } = periodFromQuery(req);
  const data = await report({ companyId: req.user.company_id, tz: req.user.timezone, from, to, userId: scopeUser(req),
    status: req.query.status || null, dims: dimsFromQuery(req) });
  const wb = buildWorkbook(data, { from, to, company: req.user.company_name });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// ---------- metas ----------
app.get('/api/goals', requireTab('metas'), wrap(async (req, res) => {
  const u = req.user;
  const tz = u.timezone;
  const today = todayIn(tz);
  const ws = weekStart(today), we = addDays(ws, 6);
  const goals = await many(
    `SELECT g.*, us.name AS user_name FROM goals g LEFT JOIN users us ON us.id=g.user_id
     WHERE g.company_id=$1 ${isAdmin(u) ? '' : 'AND (g.user_id IS NULL OR g.user_id=$2)'} ORDER BY g.user_id NULLS FIRST, g.period`,
    isAdmin(u) ? [u.company_id] : [u.company_id, u.id]);
  const scope = isAdmin(u) ? null : u.id;
  const teamDay = await attainment({ companyId: u.company_id, tz, from: today, to: today, userId: scope });
  const teamWeek = await attainment({ companyId: u.company_id, tz, from: ws, to: we, userId: scope });
  const usersDay = await perUser({ companyId: u.company_id, tz, from: today, to: today, userId: scope });
  const usersWeek = await perUser({ companyId: u.company_id, tz, from: ws, to: we, userId: scope });
  const weeks = await weeklySeries({ companyId: u.company_id, tz, weeks: 8, userId: scope });
  res.json({ today, week: { from: ws, to: we }, goals, team: { day: teamDay, week: teamWeek }, usersDay, usersWeek, weeks });
}));

app.put('/api/goals', adminOnly, wrap(async (req, res) => {
  const { user_id, period, target_percent, target_tasks, target_minutes } = req.body || {};
  if (!['daily', 'weekly'].includes(period)) throw new HttpError(400, 'Período inválido');
  const tp = parseInt(target_percent, 10);
  if (!(tp >= 1 && tp <= 100)) throw new HttpError(400, 'Meta de atingimento deve estar entre 1 e 100%');
  if (user_id) await assertRefs(pool, req.user.company_id, { assignee_id: user_id });
  await q(
    `INSERT INTO goals (company_id, user_id, period, target_percent, target_tasks, target_minutes) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (company_id, COALESCE(user_id,0), period) DO UPDATE SET target_percent=EXCLUDED.target_percent,
       target_tasks=EXCLUDED.target_tasks, target_minutes=EXCLUDED.target_minutes`,
    [req.user.company_id, user_id || null, period, tp, target_tasks ? parseInt(target_tasks, 10) : null, target_minutes ? parseInt(target_minutes, 10) : null]);
  changed(req);
  res.json({ ok: true });
}));

app.delete('/api/goals/:id', adminOnly, wrap(async (req, res) => {
  await q('DELETE FROM goals WHERE id=$1 AND company_id=$2 AND user_id IS NOT NULL', [req.params.id, req.user.company_id]);
  changed(req);
  res.json({ ok: true });
}));

app.post('/api/automation/run', adminOnly, wrap(async (req, res) => {
  res.json(await runAutomationForCompany(req.user.company_id, { force: true }));
}));

// ---------- erros e frontend ----------
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));
app.use((err, _req, res, _next) => {
  if (err.code === '23505' && /one_active_timer/.test(err.constraint || '')) {
    return res.status(409).json({ error: 'Você já tem um cronômetro ativo. Pause ou finalize antes de iniciar outra tarefa.' });
  }
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro interno do servidor' });
});

app.get('/healthz', (_req, res) => res.send('ok'));

const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

await migrate();
// uma vez: calcula o tempo pela conclusão (sem teto) para os dias desde o início do uso
for (const day of ['2026-11-04', '2026-11-05', '2026-11-06']) {
  const key = `v12_backfill_${day}`;
  if (!(await one('SELECT 1 AS x FROM app_meta WHERE key=$1', [key]))) {
    for (const c of await many('SELECT id FROM companies')) {
      try { console.log('Tempo estimado', day, 'empresa', c.id, await backfillInferred(c.id, day)); } catch (e) { console.error('backfill', e.message); }
    }
    await q('INSERT INTO app_meta (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  }
}
startAutomationLoop();
app.listen(PORT, () => console.log(`Servidor ouvindo na porta ${PORT}`));
