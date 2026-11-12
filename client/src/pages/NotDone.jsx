import React, { useState } from 'react';
import { api, toast, emitLocal, useData, addDays, fmtDate } from '../lib.js';
import { Icon, Loading, Empty, Kpi } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { TaskTable, TaskFilters, qs } from '../components/Tasks.jsx';

const PERIODS = [['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['all', 'Todo o período']];

// Aba "Não realizadas": tarefas cujo dia/prazo passou sem conclusão (saem da aba Tarefas)
export default function NotDone() {
  const { me, isAdmin } = useApp();
  const [period, setPeriod] = useState('30');
  const [group, setGroup] = useState('business');
  const [filters, setFilters] = useState({});
  const from = period === 'all' ? null : addDays(me.today, -Number(period));
  const { data } = useData(`/tasks?${qs({ ...filters, status: 'late', to: addDays(me.today, -1), ...(from && { from }) })}`);
  const tasks = (data || []).filter((t) => t.due_date < me.today).sort((a, b) => (a.due_date < b.due_date ? 1 : a.due_date > b.due_date ? -1 : 0)); // mais recentes primeiro
  const people = new Set(tasks.map((t) => t.assignee_id)).size;
  const byKind = (k) => tasks.filter((t) => t.kind === k).length;

  const clearAll = async () => {
    if (!tasks.length) return;
    if (!confirm(`Excluir ${tasks.length} tarefa(s) não realizada(s) desta lista? Não dá para desfazer.`)) return;
    try {
      const r = await api('/admin/delete-not-done', { method: 'POST', body: { ids: tasks.map((t) => t.id) } });
      emitLocal(); toast(`${r.deleted} tarefa(s) excluída(s)`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Não realizadas</h1>
          <p className="muted">Tarefas cujo dia ou prazo passou sem conclusão. Ficam aqui para não misturar com as tarefas do dia; ainda dá para finalizar.</p>
        </div>
        {isAdmin && tasks.length > 0 && <button className="btn danger" onClick={clearAll}><Icon name="trash" size={15} /> Excluir as {tasks.length} da lista</button>}
      </div>
      <div className="kpis">
        <Kpi label="Não realizadas" value={tasks.length} color="#5f6377" icon="alert" sub={PERIODS.find((p) => p[0] === period)[1].toLowerCase()} />
        <Kpi label="Diárias" value={byKind('daily')} color="#0073ea" icon="today" />
        <Kpi label="Semanais" value={byKind('weekly')} color="#a25ddc" icon="week" />
        <Kpi label="Pontuais" value={byKind('oneoff')} color="#00a9b5" icon="target" />
        {isAdmin && <Kpi label="Colaboradores" value={people} icon="users" />}
      </div>
      <div className="toolbar">
        <select className="sm" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="sm" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="business">Agrupar por empresa</option><option value="kind">Agrupar por tipo</option>
          {isAdmin && <option value="assignee">Agrupar por colaborador</option>}<option value="channel">Agrupar por canal</option>
        </select>
        <TaskFilters filters={filters} setFilters={setFilters} hideStatus />
      </div>
      {!data ? <Loading /> : !tasks.length ? <Empty>Nenhuma tarefa não realizada {period === 'all' ? '' : 'neste período'}. 🎉</Empty>
        : <TaskTable tasks={tasks} groupBy={group} showDate />}
    </div>
  );
}
