import React, { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell } from 'recharts';
import { useData, fmtDur, fmtDate, fmtMin, STATUS, pctColor } from '../lib.js';
import { Card, Loading, Kpi, Icon, Empty, Progress, StatusPill } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { qs } from '../components/Tasks.jsx';
import { PeriodPicker, hoursTick, Breakdown } from './Dashboard.jsx';

const tip = { contentStyle: { borderRadius: 8, fontSize: 13 } };

export default function Reports() {
  const { isAdmin, activeUsers, categories, me, openTask, businesses, channels } = useApp();
  const [period, setPeriod] = useState('month');
  const [custom, setCustom] = useState({ from: me.today.slice(0, 8) + '01', to: me.today });
  const [f, setF] = useState({ user: '', category: '', status: '', business: '', channel: '' });
  const params = qs({ ...(period === 'custom' ? custom : { period }), ...f });
  const { data } = useData(`/reports?${params}`);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Relatórios e produtividade</h1><p className="muted">Filtre por colaborador, período, categoria e status</p></div>
        <a className="btn primary" href={`/api/reports/export.xlsx?${params}`}><Icon name="download" /> Exportar Excel</a>
      </div>
      <div className="toolbar">
        <PeriodPicker period={period} setPeriod={setPeriod} custom={custom} setCustom={setCustom} />
        <div className="filters">
          {isAdmin && <select value={f.user} onChange={set('user')}><option value="">Todos os colaboradores</option>{activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
          {businesses.length > 0 && <select value={f.business} onChange={set('business')}><option value="">Todas as empresas</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="none">Sem empresa</option></select>}
          {channels.length > 0 && <select value={f.channel} onChange={set('channel')}><option value="">Todos os canais</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="none">Sem canal</option></select>}
          <select value={f.category} onChange={set('category')}><option value="">Todas as categorias</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={f.status} onChange={set('status')}><option value="">Todos os status</option>{Object.entries(STATUS).filter(([k]) => k !== 'cancelled').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </div>
      </div>

      {!data ? <Loading /> : (
        <>
          <div className="kpis">
            <Kpi label="Tarefas no período" value={data.summary.tasks} icon="list" />
            <Kpi label="Tarefas realizadas" value={data.summary.done} color="#00c875" icon="check" />
            <Kpi label="Tempo apontado" value={fmtDur(data.summary.seconds)} color="#a25ddc" icon="clock" />
            <Kpi label="Estimado x realizado (concluídas)" value={fmtMin(data.estVsActual.actual_minutes)}
              color={data.estVsActual.actual_minutes > data.estVsActual.estimated_minutes ? '#e2445c' : '#00c875'} icon="target"
              sub={`de ${fmtMin(data.estVsActual.estimated_minutes)} estimados` + (data.estVsActual.estimated_minutes ? ` · ${Math.round((data.estVsActual.actual_minutes / data.estVsActual.estimated_minutes) * 100)}%` : '')} />
          </div>

          <div className="grid-dash">
            <Card title="Evolução da produtividade" className="span-2">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.evolution.map((d) => ({ ...d, label: fmtDate(d.date), hours: Math.round((d.seconds / 3600) * 10) / 10 }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" unit="h" tick={{ fontSize: 11 }} />
                  <Tooltip {...tip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="l" dataKey="completed" name="Concluídas" stroke="#00c875" strokeWidth={2} />
                  <Line yAxisId="l" dataKey="planned" name="Planejadas" stroke="#579bfc" strokeWidth={2} strokeDasharray="4 3" />
                  <Line yAxisId="r" dataKey="hours" name="Horas" stroke="#a25ddc" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Tempo gasto por colaborador" className="span-1">
              {data.byUser.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart layout="vertical" data={data.byUser}>
                    <XAxis type="number" tickFormatter={hoursTick} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="user" width={90} tick={{ fontSize: 12 }} />
                    <Tooltip {...tip} formatter={(v) => fmtDur(v)} />
                    <Bar dataKey="seconds" name="Tempo" fill="#0073ea" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty>Sem tempo registrado.</Empty>}
            </Card>
            <Card title="Tempo gasto por categoria" className="span-1">
              {data.byCategory.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.byCategory}>
                    <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={hoursTick} tick={{ fontSize: 11 }} />
                    <Tooltip {...tip} formatter={(v) => fmtDur(v)} />
                    <Bar dataKey="seconds" name="Tempo" radius={[4, 4, 0, 0]}>{data.byCategory.map((c, i) => <Cell key={i} fill={c.color} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty>Sem tempo registrado.</Empty>}
            </Card>
            <Card title="Comparativo estimado x realizado (concluídas)" className="span-2">
              {data.estVsActual.tasks.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.estVsActual.tasks.slice(0, 15)}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                    <XAxis dataKey="title" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis unit="m" tick={{ fontSize: 11 }} />
                    <Tooltip {...tip} formatter={(v) => fmtMin(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="estimated_minutes" name="Estimado" fill="#c5d0fc" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="actual_minutes" name="Realizado" fill="#0073ea" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty>Nenhuma tarefa concluída com tempo estimado.</Empty>}
            </Card>
          </div>

          <div className="grid-2 cards">
            <Breakdown title="Produtividade por empresa" rows={data.byBusiness} />
            <Breakdown title="Produtividade por canal" rows={data.byChannel} />
          </div>

          <div className="grid-2 cards">
            <Card title="Atividades que mais consomem tempo">
              <table className="simple">
                <thead><tr><th>Atividade</th><th>Empresa / Canal</th><th>Vezes</th><th>Tempo total</th><th>Média</th></tr></thead>
                <tbody>
                  {data.topActivities.map((a, i) => (
                    <tr key={i}><td>{a.activity}<br /><small className="muted">{a.category}</small></td><td className="small">{a.business} · {a.channel}</td><td>{a.occurrences}</td><td><b>{fmtDur(a.seconds)}</b></td><td>{fmtDur(a.seconds / a.occurrences)}</td></tr>
                  ))}
                  {!data.topActivities.length && <tr><td colSpan={5} className="muted">Sem dados</td></tr>}
                </tbody>
              </table>
            </Card>
            <Card title="Índice de atraso por categoria">
              <table className="simple">
                <thead><tr><th>Categoria</th><th>Tarefas</th><th>Com atraso</th><th>Índice</th></tr></thead>
                <tbody>
                  {data.lateByCategory.map((c, i) => (
                    <tr key={i}><td>{c.category}</td><td>{c.tasks}</td><td>{c.late}</td><td style={{ minWidth: 120 }}><Progress value={c.late_rate} color={pctColor(100 - c.late_rate, 90)} /></td></tr>
                  ))}
                  {!data.lateByCategory.length && <tr><td colSpan={4} className="muted">Sem dados</td></tr>}
                </tbody>
              </table>
            </Card>
          </div>

          <Card title="Tarefas com maior atraso">
            <div className="table-scroll">
              <table className="simple clickable">
                <thead><tr><th>Tarefa</th><th>Responsável</th><th>Planejada</th><th>Status</th><th>Transferências</th><th>Dias de atraso</th></tr></thead>
                <tbody>
                  {data.mostLate.filter((t) => t.days_late > 0 || t.rollover_count > 0).map((t) => (
                    <tr key={t.id} onClick={() => openTask(t.id)}><td>{t.title}</td><td>{t.assignee || '—'}</td><td>{fmtDate(t.planned_date)}</td>
                      <td><StatusPill status={t.status} /></td><td>{t.rollover_count}</td><td className="danger-text"><b>{t.days_late}</b></td></tr>
                  ))}
                  {!data.mostLate.some((t) => t.days_late > 0 || t.rollover_count > 0) && <tr><td colSpan={6} className="muted">Nenhuma tarefa atrasada no período 🎉</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Produtividade por colaborador">
            <div className="table-scroll">
              <table className="simple">
                <thead><tr><th>Colaborador</th><th>Planejadas</th><th>Concluídas</th><th>Atrasadas</th><th>Atingimento</th><th>Tempo</th><th>Média/tarefa</th></tr></thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}><td>{u.name}</td><td>{u.planned}</td><td>{u.done}</td><td>{u.late}</td>
                      <td style={{ minWidth: 130 }}><Progress value={u.percent} color={pctColor(u.percent)} /></td><td>{fmtDur(u.seconds)}</td><td>{fmtDur(u.avg_seconds)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`Tarefas do período (${data.tasks.length})`}>
            <div className="table-scroll" style={{ maxHeight: 480 }}>
              <table className="simple clickable">
                <thead><tr><th>Tarefa</th><th>Tipo</th><th>Responsável</th><th>Empresa</th><th>Canal</th><th>Categoria</th><th>Planejada</th><th>Status</th><th>Estimado</th><th>Realizado</th></tr></thead>
                <tbody>
                  {data.tasks.map((t) => (
                    <tr key={t.id} onClick={() => openTask(t.id)}>
                      <td>{t.title}</td><td>{t.kind === 'daily' ? 'Diária' : 'Semanal'}</td><td>{t.assignee || '—'}</td><td>{t.business || '—'}</td><td>{t.channel || '—'}</td><td>{t.category || '—'}</td>
                      <td>{fmtDate(t.planned_date)}</td><td><StatusPill status={t.status} /></td><td>{fmtMin(t.estimated_minutes)}</td><td>{fmtDur(t.tracked_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
