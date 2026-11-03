import React, { useState } from 'react';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, LineChart, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell, ReferenceLine } from 'recharts';
import { useData, fmtDur, fmtDate, fmtMin, pctColor, colorFor, fmtWeekday } from '../lib.js';
import { Kpi, Card, Loading, Progress, Avatar, Segmented, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { qs } from '../components/Tasks.jsx';

export const hoursTick = (s) => `${Math.round((s / 3600) * 10) / 10}h`;
const tip = { contentStyle: { borderRadius: 8, border: '1px solid #e6e9ef', fontSize: 13 } };

export function PeriodPicker({ period, setPeriod, custom, setCustom }) {
  return (
    <div className="row gap wrap">
      <Segmented value={period} onChange={setPeriod} options={[['today', 'Hoje'], ['week', 'Semana'], ['month', 'Mês'], ['custom', 'Período']]} />
      {period === 'custom' && (
        <span className="row gap-s">
          <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span className="muted">até</span>
          <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </span>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { isAdmin, activeUsers, me, openTask, businesses, channels } = useApp();
  const [business, setBusiness] = useState('');
  const [channel, setChannel] = useState('');
  const [period, setPeriod] = useState('week');
  const [custom, setCustom] = useState({ from: me.today, to: me.today });
  const [user, setUser] = useState('');
  const params = period === 'custom' ? { from: custom.from, to: custom.to } : { period };
  const { data } = useData(`/dashboard?${qs({ ...params, user, business, channel })}`);
  const target = data?.weeklyTarget ?? 90;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isAdmin ? 'Visão geral da operação' : `Olá, ${me.name.split(' ')[0]}`}</h1>
          <p className="muted">{data ? `${fmtDate(data.period.from)} a ${fmtDate(data.period.to)}` : ' '}{!isAdmin && ' · seu desempenho'}</p>
        </div>
        <div className="row gap wrap">
          {isAdmin && (
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Toda a equipe</option>
              {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {businesses.length > 0 && (
            <select value={business} onChange={(e) => setBusiness(e.target.value)}>
              <option value="">Todas as empresas</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {channels.length > 0 && (
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">Todos os canais</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <PeriodPicker period={period} setPeriod={setPeriod} custom={custom} setCustom={setCustom} />
        </div>
      </div>

      {!data ? <Loading /> : (
        <>
          <div className="kpis four">
            <Kpi label="Tarefas planejadas" value={data.counts.total} icon="list" />
            <Kpi label="Concluídas" value={data.counts.done} color="#00c875" icon="check" />
            <Kpi label="Em andamento" value={data.counts.in_progress} color="#fdab3d" icon="play" />
            <Kpi label="Pendentes" value={data.counts.pending} color="#579bfc" icon="clock" sub={data.counts.paused ? `${data.counts.paused} pausada(s)` : null} />
            <Kpi label="Atrasadas (agora)" value={data.counts.late} color="#e2445c" icon="alert" sub="Abertas com data vencida" />
            <Kpi label="Atingimento geral" value={`${data.attainment.percent}%`} color={pctColor(data.attainment.percent, target)} icon="target"
              sub={`${data.attainment.done} de ${data.attainment.planned} · meta ${target}%`} />
            <Kpi label="Tempo total utilizado" value={fmtDur(data.time.seconds)} color="#a25ddc" icon="clock" />
            <Kpi label="Tempo médio por tarefa" value={fmtDur(data.time.avg_seconds)} color="#037f4c" icon="clock" />
          </div>

          <div className="grid-dash">
            <Card title="Planejado x realizado" className="span-1">
              <div className="pvr">
                <div><small>Tarefas</small>
                  <Progress value={data.attainment.planned ? (data.attainment.done / data.attainment.planned) * 100 : 0} height={12}
                    label={`${data.attainment.done}/${data.attainment.planned}`} color={pctColor(data.attainment.percent, target)} /></div>
                <div><small>Horas (realizado ÷ estimado das tarefas do período)</small>
                  <Progress value={data.time.estimated_minutes ? (data.time.actual_minutes / data.time.estimated_minutes) * 100 : 0} height={12}
                    color={data.time.actual_minutes > data.time.estimated_minutes ? '#e2445c' : '#0073ea'}
                    label={`${fmtMin(data.time.actual_minutes)} / ${fmtMin(data.time.estimated_minutes)}`} /></div>
              </div>
              <h4 className="mt">Atingimento por colaborador</h4>
              <div className="user-bars">
                {data.users.filter((u) => u.planned || u.seconds).map((u) => (
                  <div key={u.id} className="user-bar">
                    <Avatar name={u.name} id={u.id} size={26} />
                    <div className="grow"><div className="row between"><b>{u.name}</b><small className="muted">{u.done}/{u.planned} · {fmtDur(u.seconds)}</small></div>
                      <Progress value={u.percent} color={pctColor(u.percent, target)} /></div>
                  </div>
                ))}
                {!data.users.some((u) => u.planned || u.seconds) && <Empty>Nenhuma tarefa planejada no período.</Empty>}
              </div>
            </Card>

            <Card title="Produtividade diária" className="span-2">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={data.daily.map((d) => ({ ...d, label: `${fmtWeekday(d.date)} ${fmtDate(d.date)}` }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip {...tip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="planned" name="Planejadas" fill="#c5d0fc" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="l" dataKey="completed" name="Concluídas no dia" fill="#00c875" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="r" dataKey="percent" name="Atingimento %" stroke="#0073ea" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Evolução do atingimento das metas (semanal)" className="span-2">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.weekly.map((w) => ({ ...w, label: fmtDate(w.week) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip {...tip} formatter={(v, n) => (n === 'Atingimento' ? `${v}%` : v)} />
                  <ReferenceLine y={target} stroke="#e2445c" strokeDasharray="5 4" label={{ value: `Meta ${target}%`, fontSize: 11, fill: '#e2445c', position: 'insideTopRight' }} />
                  <Line dataKey="percent" name="Atingimento" stroke="#00c875" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Produtividade semanal" className="span-1">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.weekly.map((w) => ({ ...w, label: fmtDate(w.week) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip {...tip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="planned" name="Planejadas" fill="#c5d0fc" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="done" name="Concluídas" fill="#0073ea" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {isAdmin && !user && (
              <Card title="Desempenho individual" className="span-2">
                <ResponsiveContainer width="100%" height={Math.max(180, data.users.length * 42)}>
                  <BarChart layout="vertical" data={data.users} margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e6e9ef" />
                    <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                    <Tooltip {...tip} formatter={(v) => `${v}%`} />
                    <ReferenceLine x={target} stroke="#e2445c" strokeDasharray="5 4" />
                    <Bar dataKey="percent" name="Atingimento" radius={[0, 4, 4, 0]}>
                      {data.users.map((u) => <Cell key={u.id} fill={pctColor(u.percent, target)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}

            {isAdmin && !user && (
              <Card title="Distribuição do tempo por pessoa" className="span-1">
                {data.users.some((u) => u.seconds) ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={data.users.filter((u) => u.seconds)} dataKey="seconds" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={data.users.filter((u) => u.seconds).length > 1 ? 2 : 0}>
                        {data.users.filter((u) => u.seconds).map((u) => <Cell key={u.id} fill={colorFor(u.id)} />)}
                      </Pie>
                      <Tooltip {...tip} formatter={(v) => fmtDur(v)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <Empty>Sem tempo registrado no período.</Empty>}
              </Card>
            )}

            <Card title="Tarefas concluídas por dia" className={isAdmin && !user ? 'span-2' : 'span-1'}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.daily.map((d) => ({ ...d, label: fmtDate(d.date), hours: d.seconds }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip {...tip} />
                  <Bar dataKey="completed" name="Concluídas" fill="#00c875" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Horas apontadas por dia" className={isAdmin && !user ? 'span-1' : 'span-2'}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.daily.map((d) => ({ ...d, label: fmtDate(d.date) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={hoursTick} tick={{ fontSize: 11 }} />
                  <Tooltip {...tip} formatter={(v) => fmtDur(v)} />
                  <Bar dataKey="seconds" name="Tempo" fill="#a25ddc" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <div className="grid-2 cards">
            <Breakdown title="Por empresa" rows={data.byBusiness} target={target} />
            <Breakdown title="Por canal de marketplace" rows={data.byChannel} target={target} />
          </div>

          <Card title="Atingimento individual detalhado">
            <div className="table-scroll">
              <table className="simple">
                <thead><tr><th>Colaborador</th><th>Atribuídas</th><th>Concluídas</th><th>Atrasadas</th><th>Atingimento</th><th>Tempo total</th><th>Tempo médio/tarefa</th></tr></thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td><span className="row gap-s"><Avatar name={u.name} id={u.id} size={24} />{u.name}</span></td>
                      <td>{u.planned}</td><td>{u.done}</td><td className={u.late ? 'danger-text' : ''}>{u.late}</td>
                      <td style={{ minWidth: 140 }}><Progress value={u.percent} color={pctColor(u.percent, target)} /></td>
                      <td>{fmtDur(u.seconds)}</td><td>{fmtDur(u.avg_seconds)}</td>
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

export function Breakdown({ title, rows, target = 90 }) {
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return (
    <Card title={title}>
      {!rows.length ? <Empty>Sem dados no período.</Empty> : (
        <table className="simple">
          <thead><tr><th>Nome</th><th>Tarefas</th><th>Atingimento</th><th>Tempo</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td><span className="cat"><i style={{ background: r.color }} />{r.name}</span></td>
                <td>{r.done}/{r.planned}</td>
                <td style={{ minWidth: 120 }}><Progress value={r.percent} color={pctColor(r.percent, target)} label={r.planned ? `${r.percent}%` : '—'} /></td>
                <td style={{ minWidth: 140 }}>
                  <div className="progress-row"><div className="progress" style={{ height: 8 }}><div style={{ width: (r.seconds / max) * 100 + '%', background: r.color }} /></div>
                    <span className="progress-label">{fmtDur(r.seconds)}</span></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
