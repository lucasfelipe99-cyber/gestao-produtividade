import React, { useState } from 'react';
import { useData, addDays, weekStart } from '../lib.js';
import { Icon, Segmented, Loading, Kpi } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { TaskTable, Kanban, TaskFilters, qs } from '../components/Tasks.jsx';
import TaskForm from '../components/TaskForm.jsx';

// Tarefas pontuais: avulsas, com prazo de entrega, que não são diárias nem semanais
export default function Oneoff() {
  const { me, isAdmin } = useApp();
  const [view, setView] = useState('table');
  const [group, setGroup] = useState('deadline');
  const [filters, setFilters] = useState({});
  const [showDone, setShowDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data } = useData(`/tasks?${qs({ kind: 'oneoff', ...filters })}`);
  const today = me.today;
  const weekEnd = addDays(weekStart(today), 6);
  const all = (data || []).filter((t) => t.status !== 'cancelled');
  const open = all.filter((t) => t.status !== 'done');
  // concluídas: só as dos últimos 30 dias, a não ser que peça para ver todas
  const recentDone = all.filter((t) => t.status === 'done' && t.completed_at && new Date(t.completed_at) > new Date(Date.now() - 30 * 864e5));
  const shown = showDone ? all : [...open, ...recentDone];
  const late = open.filter((t) => t.due_date < today).length;
  const dueToday = open.filter((t) => t.due_date === today).length;
  const thisWeek = open.filter((t) => t.due_date > today && t.due_date <= weekEnd).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tarefas pontuais</h1>
          <p className="muted">Demandas avulsas com prazo de entrega, fora das rotinas diárias e semanais</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nova tarefa pontual</button>
      </div>

      <div className="kpis four">
        <Kpi label="Em aberto" value={open.length} icon="list" />
        <Kpi label="Atrasadas" value={late} color={late ? '#e2445c' : '#00c875'} icon="alert" sub="prazo já passou" />
        <Kpi label="Vencem hoje" value={dueToday} color="#fdab3d" icon="clock" />
        <Kpi label="Vencem nesta semana" value={thisWeek} color="#579bfc" icon="week" sub={`até ${weekEnd.slice(8)}/${weekEnd.slice(5, 7)}`} />
      </div>

      <div className="toolbar">
        <Segmented value={view} onChange={setView} options={[['table', 'Tabela', 'list'], ['kanban', 'Kanban', 'kanban']]} />
        {view === 'table' && (
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="sm">
            <option value="deadline">Agrupar por prazo</option><option value="status">Por status</option>
            {isAdmin && <option value="assignee">Por colaborador</option>}
            <option value="business">Por empresa</option><option value="channel">Por canal</option>
          </select>
        )}
        <TaskFilters filters={filters} setFilters={setFilters} extra={
          <label className="check small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> todas as concluídas</label>
        } />
      </div>

      {!data ? <Loading /> : view === 'table' ? <TaskTable tasks={shown} groupBy={group} showDate /> : <Kanban tasks={shown} />}
      {creating && <TaskForm initial={{ due_date: addDays(today, 7), kind: 'oneoff' }} onClose={() => setCreating(false)} />}
    </div>
  );
}
