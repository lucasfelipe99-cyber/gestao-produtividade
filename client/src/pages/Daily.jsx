import React, { useState } from 'react';
import { useData, addDays, fmtDateLong, fmtMonth, monthStart, monthEnd, fmtDur, fmtMin } from '../lib.js';
import { Icon, Segmented, Loading, Progress } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { TaskTable, Kanban, CalendarView, TaskFilters, qs } from '../components/Tasks.jsx';
import TaskForm from '../components/TaskForm.jsx';

export default function Daily() {
  const { me, isAdmin } = useApp();
  const [date, setDate] = useState(me.today);
  const [view, setView] = useState(() => localStorage.getItem('dailyView') || 'table');
  const [group, setGroup] = useState('status');
  const [filters, setFilters] = useState({});
  const [creating, setCreating] = useState(false);
  const [showLate, setShowLate] = useState(false);
  const changeView = (v) => { setView(v); try { localStorage.setItem('dailyView', v); } catch { /* */ } };
  const range = view === 'calendar' ? { from: monthStart(date), to: monthEnd(date) } : { from: date, to: date };
  const { data } = useData(`/tasks?${qs({ kind: view === 'calendar' ? '' : 'daily', ...range, ...filters })}`);
  // atividades diárias atrasadas de dias anteriores (rotinas não são transferidas para hoje)
  const late = useData(`/tasks?${qs({ kind: 'daily', status: 'overdue', to: addDays(me.today, -1), ...filters, status: 'overdue' })}`);
  const lateList = (late.data || []).filter((t) => t.due_date < me.today);
  const tasks = data || [];
  const valid = tasks.filter((t) => t.status !== 'cancelled');
  const done = valid.filter((t) => t.status === 'done').length;
  const est = valid.reduce((s, t) => s + t.estimated_minutes, 0);
  const spent = valid.reduce((s, t) => s + t.tracked_seconds, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tarefas diárias</h1>
          <p className="muted">{view === 'calendar' ? fmtMonth(date) : fmtDateLong(date)}{date === me.today && view !== 'calendar' && ' · hoje'}</p>
        </div>
        <div className="row gap wrap">
          <div className="date-nav">
            <button className="icon-btn" onClick={() => setDate(view === 'calendar' ? addDays(monthStart(date), -1) : addDays(date, -1))}><Icon name="left" /></button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className="icon-btn" onClick={() => setDate(view === 'calendar' ? addDays(monthEnd(date), 1) : addDays(date, 1))}><Icon name="right" /></button>
            {date !== me.today && <button className="btn sm" onClick={() => setDate(me.today)}>Hoje</button>}
          </div>
          {isAdmin && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nova tarefa</button>}
        </div>
      </div>

      <div className="toolbar">
        <Segmented value={view} onChange={changeView} options={[['table', 'Tabela', 'list'], ['kanban', 'Kanban', 'kanban'], ['calendar', 'Calendário', 'calendar']]} />
        {view === 'table' && (
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="sm">
            <option value="status">Agrupar por status</option><option value="assignee">Agrupar por colaborador</option><option value="team">Agrupar por equipe</option><option value="business">Agrupar por empresa</option><option value="channel">Agrupar por canal</option>
          </select>
        )}
        <TaskFilters filters={filters} setFilters={setFilters} />
      </div>

      {lateList.length > 0 && view !== 'calendar' && (
        <div className="late-banner">
          <Icon name="alert" size={18} />
          <span className="grow"><b>{lateList.length} atividade(s) atrasada(s)</b> de dias anteriores ainda não concluída(s)</span>
          <button className="btn sm" onClick={() => setShowLate(!showLate)}>{showLate ? 'Ocultar' : 'Ver atrasadas'}</button>
        </div>
      )}
      {showLate && lateList.length > 0 && view !== 'calendar' && (
        <div className="late-list"><TaskTable tasks={lateList} groupBy="assignee" showDate /></div>
      )}

      {view !== 'calendar' && data && (
        <div className="summary-strip">
          <div><small>Concluídas</small><b>{done}/{valid.length}</b></div>
          <div className="grow"><Progress value={valid.length ? (done / valid.length) * 100 : 0} /></div>
          <div><small>Estimado</small><b>{fmtMin(est)}</b></div>
          <div><small>Realizado</small><b>{fmtDur(spent)}</b></div>
        </div>
      )}

      {!data ? <Loading /> : view === 'table' ? <TaskTable tasks={tasks} groupBy={group} />
        : view === 'kanban' ? <Kanban tasks={tasks} />
        : <CalendarView tasks={tasks} month={date} onPickDay={(d) => { setDate(d); changeView('table'); }} />}

      {creating && <TaskForm initial={{ due_date: date, kind: 'daily' }} onClose={() => setCreating(false)} />}
    </div>
  );
}
