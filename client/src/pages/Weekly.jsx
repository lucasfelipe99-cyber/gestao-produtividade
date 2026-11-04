import React, { useState } from 'react';
import { useData, addDays, weekStart, fmtDate, fmtDur, fmtMin } from '../lib.js';
import { Icon, Segmented, Loading, Progress, Kpi } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { TaskTable, Kanban, TaskFilters, qs } from '../components/Tasks.jsx';
import TaskForm from '../components/TaskForm.jsx';

export default function Weekly() {
  const { me, isAdmin } = useApp();
  const [ws, setWs] = useState(weekStart(me.today));
  const [view, setView] = useState('table');
  const [group, setGroup] = useState('assignee');
  const [filters, setFilters] = useState({});
  const [creating, setCreating] = useState(false);
  const we = addDays(ws, 6);
  const { data } = useData(`/tasks?${qs({ kind: 'weekly', week: ws, ...filters })}`);
  const tasks = data || [];
  const current = tasks.filter((t) => !t.carried && t.status !== 'cancelled');
  const carried = tasks.filter((t) => t.carried);
  const done = current.filter((t) => t.status === 'done').length;
  const pct = current.length ? (done / current.length) * 100 : 0;
  const thisWeek = weekStart(me.today) === ws;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tarefas semanais</h1>
          <p className="muted">Semana de {fmtDate(ws)} a {fmtDate(we)}{thisWeek && ' · semana atual'}</p>
        </div>
        <div className="row gap wrap">
          <div className="date-nav">
            <button className="icon-btn" onClick={() => setWs(addDays(ws, -7))}><Icon name="left" /></button>
            <input type="date" value={ws} onChange={(e) => e.target.value && setWs(weekStart(e.target.value))} />
            <button className="icon-btn" onClick={() => setWs(addDays(ws, 7))}><Icon name="right" /></button>
            {!thisWeek && <button className="btn sm" onClick={() => setWs(weekStart(me.today))}>Semana atual</button>}
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> {isAdmin ? 'Nova tarefa semanal' : 'Adicionar à minha semana'}</button>
        </div>
      </div>

      <div className="kpis four">
        <Kpi label="Planejadas na semana" value={current.length} icon="week" />
        <Kpi label="Concluídas" value={done} color="#00c875" icon="check" />
        <Kpi label="Pendentes" value={current.length - done} color="#fdab3d" icon="clock" />
        <Kpi label="Pendências anteriores" value={carried.length} color="#e2445c" icon="alert" sub="Semanas passadas, ainda abertas" />
      </div>
      <div className="summary-strip">
        <div><small>Conclusão semanal</small><b>{Math.round(pct)}%</b></div>
        <div className="grow"><Progress value={pct} height={10} label={false} /></div>
        <div><small>Estimado</small><b>{fmtMin(current.reduce((s, t) => s + t.estimated_minutes, 0))}</b></div>
        <div><small>Realizado</small><b>{fmtDur(tasks.reduce((s, t) => s + t.tracked_seconds, 0))}</b></div>
      </div>

      <div className="toolbar">
        <Segmented value={view} onChange={setView} options={[['table', 'Tabela', 'list'], ['kanban', 'Kanban', 'kanban']]} />
        {view === 'table' && (
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="sm">
            <option value="assignee">Por colaborador</option><option value="team">Por equipe</option><option value="business">Por empresa</option><option value="channel">Por canal</option><option value="status">Por status</option>
          </select>
        )}
        <TaskFilters filters={filters} setFilters={setFilters} />
      </div>

      {!data ? <Loading /> : view === 'table' ? <TaskTable tasks={tasks} groupBy={group} showDate /> : <Kanban tasks={tasks} />}
      {creating && <TaskForm initial={{ due_date: addDays(ws, 4), kind: 'weekly' }} onClose={() => setCreating(false)} />}
    </div>
  );
}
