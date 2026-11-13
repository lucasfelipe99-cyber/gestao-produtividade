import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, connectLive, disconnectLive, useData, onToast, toast, useTick, fmtClock, fmtDate, STATUS, emitLocal, canTab } from './lib.js';
import { Icon, Avatar, Modal, Field } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AllTasks from './pages/AllTasks.jsx';
import Clients, { Acompanhamento } from './pages/Clients.jsx';
import NotDone from './pages/NotDone.jsx';
import Goals from './pages/Goals.jsx';
import Reports from './pages/Reports.jsx';
import Team from './pages/Team.jsx';
import History from './pages/History.jsx';
import Timeline from './pages/Timeline.jsx';
import Summary from './pages/Summary.jsx';
import TaskDrawer from './components/TaskDrawer.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [me, setMe] = useState(undefined);
  const loadMe = useCallback(() => api('/me').then(setMe).catch(() => setMe(null)), []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (me) { connectLive(); return () => disconnectLive(); } }, [me?.id]); // eslint-disable-line

  if (me === undefined) return <div className="splash"><div className="spinner" /></div>;
  return (
    <>
      <Toasts />
      {me ? <Shell me={me} onLogout={() => setMe(null)} /> : <Login onLogin={loadMe} />}
    </>
  );
}

function Shell({ me, onLogout }) {
  const users = useData('/users');
  const categories = useData('/categories');
  const teams = useData('/teams');
  const businesses = useData('/businesses');
  const channels = useData('/channels');
  const [openTask, setOpenTask] = useState(null);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  const isAdmin = me.role === 'admin';
  const ctx = {
    me, isAdmin,
    users: users.data || [], activeUsers: (users.data || []).filter((u) => u.active),
    categories: categories.data || [], teams: teams.data || [],
    businesses: businesses.data || [], channels: channels.data || [],
    openTask: (id) => setOpenTask(id),
  };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); onLogout(); };
  const ALL = [
    ['/', 'dashboard', isAdmin ? 'Dashboard' : 'Meu painel', 'dashboard', <Dashboard />],
    ['/resumo', 'note', 'Resumo', null, <Summary />],
    ['/tarefas', 'today', 'Tarefas', 'tarefas', <AllTasks />],
    ['/nao-realizadas', 'alert', 'Não realizadas', 'tarefas', <NotDone />],
    ['/acompanhamento', 'target', 'Acompanhamento', 'acompanhamento', <Acompanhamento />],
    ['/clientes', 'chat', 'Clientes', 'clientes', <Clients />],
    ['/linha-do-tempo', 'timeline', 'Linha do tempo', 'linha-do-tempo', <Timeline />],
    ['/metas', 'target', 'Metas e atingimento', 'metas', <Goals />],
    ['/relatorios', 'chart', 'Relatórios', 'relatorios', <Reports />],
    ['/historico', 'history', 'Histórico', 'historico', <History />],
    ...(isAdmin ? [['/equipe', 'users', 'Equipe e cadastros', null, <Team />]] : []),
  ];
  const nav = ALL.filter(([, , , tab]) => !tab || canTab(me, tab));
  const home = nav[0]?.[0] || '/';
  return (
    <Ctx.Provider value={ctx}>
      <div className={'shell' + (menu ? ' menu-open' : '')}>
        <aside className="sidebar">
          <div className="brand">
            <div className="logo"><Icon name="check" /></div>
            <div><b>Gestão de Demandas</b><small>{me.company_name}</small></div>
          </div>
          <nav>
            {nav.map(([to, icon, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon name={icon} /> <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">
            <UserMenu me={me} onLogout={logout} />
          </div>
        </aside>
        <div className="backdrop" onClick={() => setMenu(false)} />
        <main>
          <header className="topbar">
            <button className="icon-btn burger" onClick={() => setMenu(true)} aria-label="Menu"><Icon name="menu" /></button>
            <ActiveTimer />
            <div className="grow" />
            <Alerts />
          </header>
          <div className="content">
            <ErrorBoundary key={loc.pathname + loc.search}>
            <Routes>
              {nav.map(([to, , , , el]) => <Route key={to} path={to} element={el} />)}
              <Route path="/grupo" element={<Navigate to="/tarefas?tipo=group" replace />} />
              <Route path="/diarias" element={<Navigate to="/tarefas?tipo=daily" replace />} />
              <Route path="/semanais" element={<Navigate to="/tarefas?tipo=weekly" replace />} />
              <Route path="/pontuais" element={<Navigate to="/tarefas?tipo=oneoff" replace />} />
              <Route path="*" element={<Navigate to={home} />} />
            </Routes>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {openTask && <TaskDrawer id={openTask} onClose={() => setOpenTask(null)} />}
    </Ctx.Provider>
  );
}

function UserMenu({ me, onLogout }) {
  const [pw, setPw] = useState(false);
  const [form, setForm] = useState({ current: '', next: '' });
  const save = async () => {
    try { await api('/me/password', { method: 'POST', body: form }); toast('Senha alterada', 'success'); setPw(false); setForm({ current: '', next: '' }); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <div className="me">
        <Avatar name={me.name} id={me.id} />
        <div className="me-info"><b>{me.name}</b><small>{me.role === 'admin' ? 'Administrador' : 'Colaborador'}</small></div>
        <button className="icon-btn" title="Alterar senha" onClick={() => setPw(true)}><Icon name="key" /></button>
        <button className="icon-btn" title="Sair" onClick={onLogout}><Icon name="logout" /></button>
      </div>
      {pw && (
        <Modal title="Alterar senha" onClose={() => setPw(false)} footer={<button className="btn primary" onClick={save}>Salvar</button>}>
          <Field label="Senha atual"><input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></Field>
          <Field label="Nova senha (mín. 6 caracteres)"><input type="password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}

function ActiveTimer() {
  const { openTask } = useApp();
  const { data } = useData('/timer/active');
  useTick(1000, !!data);
  if (!data) return null; // cronômetro desativado: só aparece se ainda houver algum rodando de antes
  const secs = data.tracked_seconds + (Date.now() - new Date(data.started_at)) / 1000;
  const act = async (a) => { try { await api(`/tasks/${data.task_id}/${a}`, { method: 'POST' }); emitLocal(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="timer-chip running">
      <span className="pulse" />
      <button className="link" onClick={() => openTask(data.task_id)} title={data.title}>{data.title}{data.subtask_title ? ` › ${data.subtask_title}` : ''}</button>
      <b className="mono">{fmtClock(secs)}</b>
      <button className="icon-btn sm" title="Pausar" onClick={() => act('pause')}><Icon name="pause" /></button>
      <button className="icon-btn sm ok" title="Finalizar" onClick={() => act('finish')}><Icon name="check" /></button>
    </div>
  );
}

function Alerts() {
  const { openTask, me } = useApp();
  const { data } = useData('/alerts');
  const [open, setOpen] = useState(false);
  const list = data || [];
  const overdue = list.filter((a) => a.level === 'overdue').length;
  const LABEL = { overdue: 'Não realizada', today: 'Vence hoje', tomorrow: 'Vence amanhã', reminder: 'Lembrete' };
  const navigate = useNavigate();
  // avisos do time (ex.: fotos e vídeos prontos de um SKU): toast + notificação uma vez; contam no sino até abrir
  const readSeen = () => { try { return JSON.parse(localStorage.getItem('notices-seen') || '[]'); } catch { return []; } };
  const [seenTick, setSeenTick] = useState(0);
  const seen = readSeen();
  const notices = list.filter((a) => a.level === 'notice');
  const unseen = notices.filter((n) => !seen.includes(n.notice_id) && n.created_by !== me?.id);
  const markSeen = () => { try { localStorage.setItem('notices-seen', JSON.stringify([...new Set([...readSeen(), ...notices.map((n) => n.notice_id)])].slice(-200))); } catch { /* */ } setSeenTick(seenTick + 1); };
  const countBadge = list.length - notices.length + unseen.length;
  // aviso na hora do lembrete (toast + notificação do navegador, uma vez por lembrete)
  useTick(30000);
  useEffect(() => {
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const r of list.filter((a) => a.level === 'reminder')) {
      const due = r.remind_date < me.today || (r.remind_date === me.today && (!r.remind_time || r.remind_time <= hm));
      const key = `rem-notified-${r.note_id}-${r.remind_date}`;
      let seen = false;
      try { seen = !!localStorage.getItem(key); } catch { /* sem armazenamento */ }
      if (!due || seen) continue;
      try { localStorage.setItem(key, '1'); } catch { /* */ }
      toast(`🔔 Lembrete: ${r.title}`, 'info');
      try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Lembrete', { body: r.title }); } catch { /* */ }
    }
    for (const n of unseen) {
      const key = `notice-toast-${n.notice_id}`;
      let shown = false;
      try { shown = !!localStorage.getItem(key); } catch { /* */ }
      if (shown) continue;
      try { localStorage.setItem(key, '1'); } catch { /* */ }
      toast(`${n.title}${n.body ? ' — ' + n.body : ''}`, 'success');
      try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(n.title, { body: n.body || '' }); } catch { /* */ }
    }
  });
  return (
    <div className="alerts">
      <button className="icon-btn" onClick={() => { if (!open) markSeen(); setOpen(!open); }} aria-label="Alertas">
        <Icon name="bell" />{countBadge > 0 && <span className={'badge' + (overdue ? ' red' : unseen.length ? ' green' : '')}>{countBadge}</span>}
      </button>
      {open && (
        <>
          <div className="click-away" onClick={() => setOpen(false)} />
          <div className="dropdown alerts-list">
            {notices.length > 0 && (<>
              <h4>Avisos do time</h4>
              {notices.map((n) => (
                <button key={'n' + n.notice_id} className="alert-item" onClick={() => { navigate('/tarefas?tipo=group'); setOpen(false); }}>
                  <span className="dot notice" />
                  <span className="grow"><b>{n.title}</b><small>{n.body}</small>
                    <small>{new Date(n.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></span>
                </button>
              ))}
            </>)}
            <h4>Alertas de prazo</h4>
            {list.length === notices.length && <p className="muted pad">Nenhuma tarefa vencida ou próxima do vencimento.</p>}
            {list.filter((a) => a.level !== 'notice').map((a) => (
              <button key={(a.level === 'reminder' ? 'r' : 't') + (a.note_id || a.id)} className="alert-item" onClick={() => { if (a.id) openTask(a.id); setOpen(false); }}>
                <span className={'dot ' + a.level} />
                <span className="grow">
                  <b>{a.title}</b>
                  <small>{a.level === 'reminder'
                    ? `Lembrete · ${a.remind_date === me.today ? 'hoje' : fmtDate(a.remind_date)}${a.remind_time ? ' às ' + a.remind_time : ''}`
                    : <>{LABEL[a.level]} · {a.kind === 'daily' ? 'planejada ' + fmtDate(a.planned_date) : (a.kind === 'oneoff' ? 'pontual · prazo ' : 'prazo ') + fmtDate(a.due_date)}{a.assignee_name ? ' · ' + a.assignee_name : ''}</>}</small>
                </span>
                <span className="pill xs" style={{ background: STATUS[a.status].color }}>{STATUS[a.status].label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => onToast((t) => {
    setItems((x) => [...x, t]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 4500);
  }), []);
  return <div className="toasts">{items.map((t) => <div key={t.id} className={'toast ' + t.type}>{t.message}</div>)}</div>;
}

// se algo quebrar numa tela, mostra um aviso em vez de deixar tudo em branco
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { console.error(err); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="page"><div className="warn-box" style={{ padding: 16 }}>
        <b>Ops, algo deu errado nesta tela.</b>
        <p className="small muted" style={{ margin: '6px 0 10px' }}>{String(this.state.err?.message || this.state.err)}</p>
        <button className="btn sm" onClick={() => this.setState({ err: null })}>Tentar de novo</button>{' '}
        <button className="btn sm" onClick={() => window.location.reload()}>Recarregar a página</button>
      </div></div>
    );
  }
}
