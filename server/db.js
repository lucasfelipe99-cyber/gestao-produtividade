import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Datas (DATE) voltam como texto 'YYYY-MM-DD' para evitar deslocamento de fuso
pg.types.setTypeParser(1082, (v) => v);
// BIGINT/NUMERIC como número
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  console.error('[erro] Variável DATABASE_URL não configurada. Defina a URL do PostgreSQL nas variáveis de ambiente.');
  process.exit(1);
}
const connectionString = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/gestao';
const needsSsl = /render\.com|sslmode=require/.test(connectionString) || process.env.PGSSL === 'true';

export const pool = new pg.Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0];
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// Registra evento de auditoria
export async function logEvent(db, { companyId, taskId, taskTitle, userId, action, details = {} }) {
  await db.query(
    `INSERT INTO task_events (company_id, task_id, task_title, user_id, action, details)
     VALUES ($1,$2,COALESCE($3::text,(SELECT title FROM tasks WHERE id=$2::int)),$4,$5,$6)`,
    [companyId, taskId ?? null, taskTitle ?? null, userId ?? null, action, JSON.stringify(details)]
  );
}

// ---- Tempo real (Server-Sent Events) por empresa ----
const subscribers = new Map(); // companyId -> Set(res)
export function subscribe(companyId, res) {
  if (!subscribers.has(companyId)) subscribers.set(companyId, new Set());
  subscribers.get(companyId).add(res);
  return () => subscribers.get(companyId)?.delete(res);
}
export function broadcast(companyId, payload = {}) {
  const set = subscribers.get(companyId);
  if (!set) return;
  const data = `data: ${JSON.stringify({ type: 'changed', at: Date.now(), ...payload })}\n\n`;
  for (const res of set) res.write(data);
}
