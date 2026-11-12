import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData, addDays, weekStart, fmtDate, fmtDateLong, fmtMonth, monthStart, monthEnd, fmtDur, fmtMin } from '../lib.js';
import { Icon, Segmented, Loading, Progress } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { TaskTable, Kanban, CalendarView, TaskFilters, qs } from '../components/Tasks.jsx';
import TaskForm from '../components/TaskForm.jsx';
import { GroupsView } from './Groups.jsx';

const TYPES = [['all', 'Todas'], ['daily', 'Diárias'], ['weekly', 'Semanais'], ['oneoff', 'Pontuais'], ['group', 'Em grupo']];
// padrão: separado por empresa (cada cliente em um grupo)
const DEFAULT_GROUP = { all: 'business', daily: 'business', weekly: 'business', oneoff: 'business', group: 'business' };
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* */ } return null; };

// Aba única de tarefas: diárias do dia, semanais da semana e pontuais em aberto
export default function AllTasks() {
  const { me, isAdmin } = useApp();
  const [params, setParams] = useSearchParams();
  const type = TYPES.some(([k]) => k === params.get('tipo')) ? params.get('tipo') : 'all';
  const setType = (t) => { const p = new URLSearchParams(params); if (t === 'all') p.delete('tipo'); else p.set('tipo', t); setParams(p, { replace: true }); setGroup(null); };
  const [date, setDate] = useState(me.today);
  const [view, setView] = useState(() => ls('tasksView') || 'table');
  const [groupSel, setGroup] = useState(null);
  const group = groupSel || DEFAULT_GROUP[type];
  const [filters, setFilters] = useState({});
  const [creating, setCreating] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const isGroup = type === 'group';
  const groupsOpen = useData('/groups?status=open');
  const [showLate, setShowLate] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const changeView = (v) => { setView(v); ls('tasksView', v); };
  const ws = weekStart(date);
  const isCal = view === 'calendar';

  const daily = useData(`/tasks?${qs({ kind: 'daily', from: date, to: date, ...filters })}`);
  const weekly = useData(`/tasks?${qs({ kind: 'weekly', week: ws, ...filters })}`);
  const oneoff = useData(`/tasks?${qs({ kind: 'oneoff', ...filters })}`);
  const cal = useData(isCal ? `/tasks?${qs({ ...(type !== 'all' && { kind: type }), from: monthStart(date), to: monthEnd(date), ...filters })}` : null);
  const late = useData(`/tasks?${qs({ kind: 'daily', to: addDays(me.today, -1), ...filters, status: 'late' })}`);
  const lateList = (late.data || []).filter((t) => t.due_date < me.today);

  // pontuais: em aberto + concluídas no dia escolhido (ou nos últimos 30 dias, se o filtro for "Pontuais")
  const recent = (t) => t.completed_at && new Date(t.completed_at) > new Date(Date.now() - 30 * 864e5);
  const doneOn = (t) => t.completed_at && new Date(t.completed_at).toLocaleDateString('sv-SE') === date;
  const oneoffAll = (oneoff.data || []).filter((t) => t.status !== 'cancelled');
  const oneoffShown = oneoffAll.filter((t) => t.status !== 'done' || (type === 'oneoff' ? showAllDone || recent(t) : doneOn(t)));

  const lists = { daily: daily.data || [], weekly: weekly.data || [], oneoff: oneoffShown };
  const loaded = daily.data && weekly.data && oneoff.data;
  const tasks = type === 'all' ? [...lists.daily, ...lists.weekly, ...lists.oneoff] : lists[type] || [];
  const openCount = (l) => l.filter((t) => !['done', 'cancelled'].includes(t.status)).length;

  const valid = tasks.filter((t) => t.status !== 'cancelled');
  const done = valid.filter((t) => t.status === 'done').length;
  const est = valid.reduce((s, t) => s + t.estimated_minutes, 0);
  const spent = valid.reduce((s, t) => s + t.tracked_seconds, 0);
  const shiftDays = (n) => setDate(isCal ? addDays(n < 0 ? monthStart(date) : monthEnd(date), n < 0 ? -1 : 1) : addDays(date, n));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tarefas</h1>
          <p className="muted">
            {isCal ? fmtMonth(date) : <>{fmtDateLong(date)}{date === me.today && ' · hoje'} · semana de {fmtDate(ws)} a {fmtDate(addDays(ws, 6))}</>}
          </p>
        </div>
        <div className="row gap wrap">
          <div className="date-nav">
            <button className="icon-btn" onClick={() => shiftDays(-1)}><Icon name="left" /></button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className="icon-btn" onClick={() => shiftDays(1)}><Icon name="right" /></button>
            {date !== me.today && <button className="btn sm" onClick={() => setDate(me.today)}>Hoje</button>}
          </div>
          {isGroup
            ? <button className="btn primary" onClick={() => setCreatingGroup(true)}><Icon name="plus" /> Nova tarefa em grupo</button>
            : <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nova tarefa</button>}
        </div>
      </div>

      <div className="type-chips">
        {TYPES.map(([k, l]) => (
          <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>
            {l} {k === 'group' ? groupsOpen.data && <b title="em andamento">{groupsOpen.data.length}</b>
              : loaded && <b title="em aberto">{k === 'all' ? openCount(lists.daily) + openCount(lists.weekly) + openCount(lists.oneoff) : openCount(lists[k])}</b>}
          </button>
        ))}
      </div>

      {isGroup ? <GroupsView creating={creatingGroup} setCreating={setCreatingGroup} /> : (<>
      <div className="toolbar">
        <Segmented value={view} onChange={changeView} options={[['table', 'Tabela', 'list'], ['kanban', 'Kanban', 'kanban'], ['calendar', 'Calendário', 'calendar']]} />
        {view === 'table' && (
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="sm">
            <option value="business">Agrupar por empresa</option><option value="kind">Agrupar por tipo</option><option value="status">Agrupar por status</option><option value="deadline">Agrupar por prazo</option>
            {isAdmin && <option value="assignee">Agrupar por colaborador</option>}
            <option value="team">Agrupar por equipe</option><option value="channel">Agrupar por canal</option>
          </select>
        )}
        <TaskFilters filters={filters} setFilters={setFilters} extra={type === 'oneoff' && (
          <label className="check small"><input type="checkbox" checked={showAllDone} onChange={(e) => setShowAllDone(e.target.checked)} /> todas as concluídas</label>
        )} />
      </div>

      {!isCal && ['all', 'daily'].includes(type) && lateList.length > 0 && (
        <div className="late-banner">
          <Icon name="alert" size={18} />
          <span className="grow"><b>{lateList.length} tarefa(s) não realizada(s)</b> em dias anteriores</span>
          <button className="btn sm" onClick={() => setShowLate(!showLate)}>{showLate ? 'Ocultar' : 'Ver não realizadas'}</button>
        </div>
      )}
      {showLate && !isCal && lateList.length > 0 && <div className="late-list"><TaskTable tasks={lateList} groupBy="assignee" showDate /></div>}

      {!isCal && loaded && (
        <div className="summary-strip">
          <div><small>Concluídas</small><b>{done}/{valid.length}</b></div>
          <div className="grow"><Progress value={valid.length ? (done / valid.length) * 100 : 0} /></div>
          <div><small>Estimado</small><b>{fmtMin(est)}</b></div>
          <div><small>Realizado</small><b>{fmtDur(spent)}</b></div>
        </div>
      )}

      {isCal ? (!cal.data ? <Loading /> : <CalendarView tasks={cal.data} month={date} onPickDay={(d) => { setDate(d); changeView('table'); }} />)
        : !loaded ? <Loading />
        : view === 'table' ? <TaskTable tasks={tasks} groupBy={group} showDate={type !== 'daily'} />
        : <Kanban tasks={tasks} />}

      </>)}
      {creating && (
        <TaskForm
          initial={{ kind: type === 'all' ? 'daily' : type, due_date: type === 'weekly' ? addDays(ws, 4) : type === 'oneoff' ? addDays(date, 7) : date }}
          onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
