import { useEffect, useState, useCallback, useRef } from 'react';

// ---------- API ----------
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || 'Erro de comunicação com o servidor');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Tempo real ----------
const listeners = new Set();
let source;
export function connectLive() {
  if (source) return;
  source = new EventSource('/api/stream');
  source.onmessage = () => listeners.forEach((fn) => fn());
}
export function disconnectLive() { source?.close(); source = null; }
export function onLive(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitLocal() { listeners.forEach((fn) => fn()); }

// Busca dados e refaz automaticamente quando algo muda no servidor
export function useData(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;
  const load = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api(pathRef.current);
      setData(d); setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { setLoading(true); load(); }, [path, ...deps]); // eslint-disable-line
  useEffect(() => {
    let t;
    const off = onLive(() => { clearTimeout(t); t = setTimeout(load, 250); });
    return () => { off(); clearTimeout(t); };
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function useTick(ms = 1000, enabled = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

// ---------- Toasts ----------
const toastListeners = new Set();
export function toast(message, type = 'info') { toastListeners.forEach((fn) => fn({ id: Math.random(), message, type })); }
export function onToast(fn) { toastListeners.add(fn); return () => toastListeners.delete(fn); }

// ---------- Rótulos e cores (padrão Monday) ----------
export const STATUS = {
  not_started: { label: 'Não iniciada', color: '#c4c4c4' },
  in_progress: { label: 'Em andamento', color: '#fdab3d' },
  paused: { label: 'Pausada', color: '#a25ddc' },
  done: { label: 'Concluída', color: '#00c875' },
  late: { label: 'Atrasada', color: '#e2445c' },
  cancelled: { label: 'Cancelada', color: '#676879' },
};
export const STATUS_ORDER = ['late', 'in_progress', 'paused', 'not_started', 'done', 'cancelled'];
export const PRIORITY = {
  urgent: { label: 'Urgente', color: '#333333' },
  high: { label: 'Alta', color: '#401694' },
  medium: { label: 'Média', color: '#5559df' },
  low: { label: 'Baixa', color: '#579bfc' },
};
export const ACTIONS = {
  created: 'criou a tarefa', created_by_recurrence: 'gerou pela recorrência', started: 'iniciou a tarefa', resumed: 'retomou a tarefa',
  reopened: 'reabriu a tarefa', paused: 'pausou a tarefa', finished: 'finalizou a tarefa', manual_time: 'lançou horário manual',
  status_changed: 'alterou o status', updated: 'editou a tarefa', cancelled: 'cancelou a tarefa', deleted: 'excluiu a tarefa',
  rolled_over: 'transferiu para o próximo dia útil', marked_late: 'marcou como atrasada',
  note_added: 'registrou uma observação', time_removed: 'removeu um registro de tempo',
};
export const FIELD = {
  title: 'Nome', description: 'Descrição', assignee_id: 'Responsável', team_id: 'Equipe', category_id: 'Categoria', shared: 'Compartilhada',
  priority: 'Prioridade', status: 'Status', due_date: 'Data', scheduled_time: 'Horário', estimated_minutes: 'Tempo estimado', notes: 'Observações', kind: 'Tipo',
};
export const PALETTE = ['#0073ea', '#00c875', '#fdab3d', '#e2445c', '#a25ddc', '#579bfc', '#ff642e', '#037f4c', '#ffcb00', '#bb3354', '#784bd1', '#66ccff'];

// ---------- Datas e durações ----------
const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toISODate(d); };
export const weekStart = (s) => { const d = parseDate(s); const w = d.getDay(); d.setDate(d.getDate() + (w === 0 ? -6 : 1 - w)); return toISODate(d); };
export const monthStart = (s) => s.slice(0, 8) + '01';
export const monthEnd = (s) => { const d = parseDate(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return toISODate(d); };
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const fmtDate = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '—');
export const fmtDateFull = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');
export const fmtWeekday = (s) => WD[parseDate(s).getDay()];
export const fmtMonth = (s) => `${MONTHS[parseDate(s).getMonth()]} ${s.slice(0, 4)}`;
export const fmtDateLong = (s) => { const d = parseDate(s); return `${WD[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
export const fmtDateTime = (iso) => { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtTime = (t) => (t ? t.slice(0, 5) : '');
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m`;
  return sec ? `${sec}s` : '0m';
}
export const fmtMin = (min) => fmtDur((min || 0) * 60);
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}
export const liveSeconds = (t) => (t.tracked_seconds || 0) + (t.active_started_at ? Math.max(0, (Date.now() - new Date(t.active_started_at)) / 1000) : 0);
export const toLocalInput = (d) => `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
export const colorFor = (id) => PALETTE[(id || 0) % PALETTE.length];
export const pctColor = (p, target = 90) => (p >= target ? '#00c875' : p >= target * 0.7 ? '#fdab3d' : '#e2445c');
