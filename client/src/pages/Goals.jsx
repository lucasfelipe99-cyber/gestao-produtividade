import React, { useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { api, toast, emitLocal, useData, fmtDate, fmtDur, pctColor } from '../lib.js';
import { Card, Loading, Progress, Avatar, Modal, Field, Icon, Kpi } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function Goals() {
  const { isAdmin, activeUsers } = useApp();
  const { data } = useData('/goals');
  const [editing, setEditing] = useState(null);
  if (!data) return <div className="page"><Loading /></div>;

  const goalFor = (userId, period) =>
    data.goals.find((g) => g.user_id === userId && g.period === period) || data.goals.find((g) => g.user_id == null && g.period === period);
  const teamDayGoal = goalFor(null, 'daily')?.target_percent ?? 90;
  const teamWeekGoal = goalFor(null, 'weekly')?.target_percent ?? 90;
  const weeks = data.weeks.map((w, i, arr) => ({ ...w, label: fmtDate(w.week), delta: i ? Math.round((w.percent - arr[i - 1].percent) * 10) / 10 : null }));
  const last = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Metas e atingimento</h1><p className="muted">Atingimento = tarefas concluídas no período ÷ tarefas planejadas para o período × 100 (canceladas não entram no cálculo)</p></div>
        {isAdmin && <button className="btn primary" onClick={() => setEditing({ user_id: '', period: 'weekly', target_percent: 90 })}><Icon name="plus" /> Definir meta individual</button>}
      </div>

      <h2 className="section">Atingimento geral da equipe</h2>
      <div className="kpis">
        <GoalKpi label={`Hoje (${fmtDate(data.today)})`} a={data.team.day} target={teamDayGoal} onEdit={isAdmin && (() => setEditing({ ...goalFor(null, 'daily'), user_id: null }))} />
        <GoalKpi label={`Semana (${fmtDate(data.week.from)} a ${fmtDate(data.week.to)})`} a={data.team.week} target={teamWeekGoal} onEdit={isAdmin && (() => setEditing({ ...goalFor(null, 'weekly'), user_id: null }))} />
        <Kpi label="Planejadas na semana" value={data.team.week.planned} icon="list" />
        <Kpi label="Concluídas na semana" value={data.team.week.done} color="#00c875" icon="check" />
        <Kpi label="Pendentes na semana" value={data.team.week.pending} color="#fdab3d" icon="clock" />
        <Kpi label="Vs. semana anterior" value={prev ? `${last.percent - prev.percent >= 0 ? '+' : ''}${Math.round((last.percent - prev.percent) * 10) / 10} p.p.` : '—'}
          color={prev && last.percent >= prev.percent ? '#00c875' : '#e2445c'} icon="chart" sub={prev ? `${prev.percent}% → ${last.percent}%` : null} />
      </div>

      <Card title="Comparativo entre semanas">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={weeks}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 13 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="l" dataKey="planned" name="Planejadas" fill="#c5d0fc" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="l" dataKey="done" name="Concluídas" fill="#0073ea" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="l" dataKey="pending" name="Pendentes" fill="#fdab3d" radius={[4, 4, 0, 0]} />
            <ReferenceLine yAxisId="r" y={teamWeekGoal} stroke="#e2445c" strokeDasharray="5 4" />
            <Line yAxisId="r" dataKey="percent" name="Atingimento %" stroke="#00c875" strokeWidth={3} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <h2 className="section">Atingimento individual</h2>
      <Card>
        <div className="table-scroll">
          <table className="simple">
            <thead>
              <tr><th>Colaborador</th><th>Atribuídas (sem.)</th><th>Concluídas (sem.)</th><th>Atrasadas</th><th>Hoje</th><th>Semana</th><th>Meta semanal</th><th>Tempo trabalhado (sem.)</th><th>Tempo médio/tarefa</th>{isAdmin && <th />}</tr>
            </thead>
            <tbody>
              {data.usersWeek.map((u) => {
                const d = data.usersDay.find((x) => x.id === u.id) || {};
                const gw = goalFor(u.id, 'weekly');
                const gd = goalFor(u.id, 'daily');
                const tw = gw?.target_percent ?? 90;
                return (
                  <tr key={u.id}>
                    <td><span className="row gap-s"><Avatar name={u.name} id={u.id} size={24} />{u.name}</span></td>
                    <td>{u.planned}</td><td>{u.done}</td><td className={u.late ? 'danger-text' : ''}>{u.late}</td>
                    <td style={{ minWidth: 120 }}><Progress value={d.percent} color={pctColor(d.percent || 0, gd?.target_percent ?? 90)} label={d.planned ? `${d.percent}%` : '—'} /></td>
                    <td style={{ minWidth: 120 }}><Progress value={u.percent} color={pctColor(u.percent, tw)} label={u.planned ? `${u.percent}%` : '—'} /></td>
                    <td>{tw}%{gw?.user_id ? '' : <small className="muted"> (equipe)</small>}{gw?.target_tasks ? <small className="muted"> · mín. {gw.target_tasks} tarefas</small> : null}</td>
                    <td>{fmtDur(u.seconds)}{gw?.target_minutes ? <small className="muted"> / {Math.round(gw.target_minutes / 60)}h</small> : null}</td>
                    <td>{fmtDur(u.avg_seconds)}</td>
                    {isAdmin && <td><button className="icon-btn sm" title="Definir meta" onClick={() => setEditing({ ...(gw?.user_id ? gw : { period: 'weekly', target_percent: tw }), user_id: u.id })}><Icon name="edit" size={14} /></button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {isAdmin && data.goals.some((g) => g.user_id) && (
        <Card title="Metas individuais cadastradas">
          <table className="simple">
            <thead><tr><th>Colaborador</th><th>Período</th><th>Atingimento</th><th>Mín. tarefas</th><th>Horas</th><th /></tr></thead>
            <tbody>
              {data.goals.filter((g) => g.user_id).map((g) => (
                <tr key={g.id}>
                  <td>{g.user_name}</td><td>{g.period === 'daily' ? 'Diária' : 'Semanal'}</td><td>{g.target_percent}%</td><td>{g.target_tasks || '—'}</td>
                  <td>{g.target_minutes ? Math.round(g.target_minutes / 60) + 'h' : '—'}</td>
                  <td className="row gap-s">
                    <button className="icon-btn sm" onClick={() => setEditing(g)}><Icon name="edit" size={14} /></button>
                    <button className="icon-btn sm" onClick={async () => { await api(`/goals/${g.id}`, { method: 'DELETE' }); emitLocal(); }}><Icon name="trash" size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && <GoalForm goal={editing} users={activeUsers} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GoalKpi({ label, a, target, onEdit }) {
  return (
    <div className="kpi" style={{ '--kpi': pctColor(a.percent, target) }}>
      <div className="kpi-top"><span>{label}</span>{onEdit && <button className="icon-btn sm" onClick={onEdit} title="Editar meta"><Icon name="edit" size={14} /></button>}</div>
      <div className="kpi-value">{a.percent}%</div>
      <Progress value={(a.percent / target) * 100} color={pctColor(a.percent, target)} label={`meta ${target}%`} height={6} />
      <div className="kpi-sub">{a.done} de {a.planned} concluídas</div>
    </div>
  );
}

function GoalForm({ goal, users, onClose }) {
  const [f, setF] = useState({ user_id: goal.user_id ?? '', period: goal.period || 'weekly', target_percent: goal.target_percent ?? 90,
    target_tasks: goal.target_tasks ?? '', target_hours: goal.target_minutes ? goal.target_minutes / 60 : '' });
  const save = async () => {
    try {
      await api('/goals', { method: 'PUT', body: { user_id: f.user_id || null, period: f.period, target_percent: f.target_percent,
        target_tasks: f.target_tasks || null, target_minutes: f.target_hours ? Math.round(f.target_hours * 60) : null } });
      emitLocal(); toast('Meta salva', 'success'); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Definir meta" onClose={onClose} footer={<button className="btn primary" onClick={save}>Salvar meta</button>}>
      <Field label="Aplica-se a">
        <select value={f.user_id ?? ''} onChange={(e) => setF({ ...f, user_id: e.target.value })} disabled={goal.user_id === null}>
          <option value="">Equipe inteira (meta geral)</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
      <Field label="Período">
        <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="daily">Diária</option><option value="weekly">Semanal</option></select>
      </Field>
      <Field label="Meta de atingimento (%)"><input type="number" min="1" max="100" value={f.target_percent} onChange={(e) => setF({ ...f, target_percent: e.target.value })} /></Field>
      <div className="grid-2">
        <Field label="Mínimo de tarefas concluídas (opcional)"><input type="number" min="0" value={f.target_tasks} onChange={(e) => setF({ ...f, target_tasks: e.target.value })} /></Field>
        <Field label="Horas a apontar (opcional)"><input type="number" min="0" step="0.5" value={f.target_hours} onChange={(e) => setF({ ...f, target_hours: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
