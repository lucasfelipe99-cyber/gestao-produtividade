import React, { useState } from 'react';
import { api, toast, emitLocal, useData, useTick, addDays, fmtDateLong, fmtDate, fmtWeekday, fmtMin, STATUS } from '../lib.js';
import { Icon, Avatar, Card, Kpi, Loading, Empty, Modal, Field } from '../ui.jsx';
import { useApp } from '../App.jsx';

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (min) => (min == null ? '—' : `${pad(Math.floor(min / 60) % 24)}:${pad(Math.floor(min % 60))}`);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };

export default function Timeline() {
  const { me, isAdmin, activeUsers, openTask } = useApp();
  const [date, setDate] = useState(me.today);
  const [user, setUser] = useState('');
  const [cfg, setCfg] = useState(false);
  const { data } = useData(`/timeline?date=${date}${user ? '&user=' + user : ''}`);
  const isToday = date === me.today;
  const anyRunning = data?.people.some((p) => p.entries.some((e) => e.running));
  useTick(30000, isToday && anyRunning);

  if (!data) return <div className="page"><Loading /></div>;
  const { ws, we } = data;
  // eixo: jornada, estendido se houver trabalho antes/depois (hora extra)
  const live = (e) => (e.running && isToday ? Math.max(e.end_min, nowMin()) : e.end_min);
  const all = data.people.flatMap((p) => p.entries);
  const minStart = Math.min(ws, ...all.map((e) => e.start_min), ...data.people.flatMap((p) => p.planned.map((x) => x.min)));
  const maxEnd = Math.max(we, ...all.map(live), isToday && anyRunning ? nowMin() : 0);
  const axisStart = Math.floor(minStart / 60) * 60;
  const axisEnd = Math.ceil(maxEnd / 60) * 60;
  const span = axisEnd - axisStart;
  const x = (m) => `${((m - axisStart) / span) * 100}%`;
  const w = (a, b) => `${(Math.max(0, b - a) / span) * 100}%`;
  const hours = [];
  for (let m = axisStart; m <= axisEnd; m += 60) hours.push(m);
  const s = data.summary;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Linha do tempo da jornada</h1>
          <p className="muted">{fmtDateLong(date)}{isToday && ' · hoje'} · jornada {data.work_start} às {data.work_end}
            {isAdmin && <> · <button className="link" onClick={() => setCfg(true)}>alterar horário</button></>}</p>
        </div>
        <div className="row gap wrap">
          {isAdmin && (
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Toda a equipe</option>
              {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <div className="date-nav">
            <button className="icon-btn" onClick={() => setDate(addDays(date, -1))}><Icon name="left" /></button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className="icon-btn" onClick={() => setDate(addDays(date, 1))}><Icon name="right" /></button>
            {!isToday && <button className="btn sm" onClick={() => setDate(me.today)}>Hoje</button>}
          </div>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Com apontamento no dia" value={`${s.people_with_time}/${data.people.length}`} icon="users" />
        <Kpi label="Atrasos na 1ª atividade" value={s.late_count} color={s.late_count ? '#e2445c' : '#00c875'} icon="alert" sub={`após ${data.work_start}`} />
        <Kpi label="Atraso médio" value={fmtMin(s.avg_delay_min)} color="#fdab3d" icon="clock" />
        <Kpi label="Horas trabalhadas" value={fmtMin(s.total_worked_min)} color="#0073ea" icon="clock" />
        <Kpi label="Hora extra" value={fmtMin(s.total_overtime_min)} color="#a25ddc" icon="clock" sub={`fora de ${data.work_start}–${data.work_end}`} />
      </div>

      <Card>
        <div className="tl-legend">
          <span><i className="lg-delay" /> Atraso até a 1ª atividade</span>
          <span><i className="lg-extra" /> Fora da jornada (hora extra)</span>
          <span><i className="lg-plan" /> Horário previsto de tarefa</span>
          <span><i className="lg-run" /> Em andamento</span>
        </div>
        <div className="tl-scroll">
          <div className="tl">
            <div className="tl-row tl-axis">
              <div className="tl-name" />
              <div className="tl-track">
                {hours.map((m) => <span key={m} className="tl-hour" style={{ left: x(m) }}>{hhmm(m)}</span>)}
              </div>
            </div>
            {data.people.map((p) => {
              const m = p.metrics;
              return (
                <div className="tl-row" key={p.id}>
                  <div className="tl-name">
                    <div className="row gap-s"><Avatar name={p.name} id={p.id} size={26} /><b>{p.name}</b></div>
                    {p.entries.length ? (
                      <small>
                        Início <b>{hhmm(m.first_start)}</b>{' '}
                        {m.delay_min > 0 ? <span className="tag danger">+{fmtMin(m.delay_min)} atraso</span> : <span className="tag ok">no horário</span>}
                        <br />Trabalhado <b>{fmtMin(m.worked_min)}</b>{m.overtime_min > 0 && <> · extra <b className="purple">{fmtMin(m.overtime_min)}</b></>}
                      </small>
                    ) : <small className="muted">Sem apontamento</small>}
                  </div>
                  <div className="tl-track">
                    {hours.map((h) => <span key={h} className="tl-grid" style={{ left: x(h) }} />)}
                    {axisStart < ws && <span className="tl-off" style={{ left: x(axisStart), width: w(axisStart, ws) }} />}
                    {axisEnd > we && <span className="tl-off" style={{ left: x(we), width: w(we, axisEnd) }} />}
                    <span className="tl-work-line" style={{ left: x(ws) }} />
                    <span className="tl-work-line end" style={{ left: x(we) }} />
                    {m.delay_min > 0 && <span className="tl-delay" style={{ left: x(ws), width: w(ws, m.first_start) }} title={`Atraso de ${fmtMin(m.delay_min)} até a primeira atividade`} />}
                    {p.entries.map((e) => {
                      const end = live(e);
                      return (
                        <button key={e.id} className={'tl-block' + (e.running ? ' running' : '') + (e.source === 'manual' ? ' manual' : '')}
                          style={{ left: x(e.start_min), width: `max(3px, ${w(e.start_min, end)})`, background: e.color }}
                          title={`${e.task_title}${e.subtask_title ? ' › ' + e.subtask_title : ''}\n${hhmm(e.start_min)}–${e.running ? 'agora' : hhmm(end)} (${fmtMin(end - e.start_min)})${e.source === 'manual' ? ' · lançamento manual' : ''}`}
                          onClick={() => openTask(e.task_id)}>
                          <span>{e.subtask_title || e.task_title}</span>
                        </button>
                      );
                    })}
                    {p.planned.map((t) => (
                      <button key={t.id} className="tl-plan" style={{ left: x(t.min), borderColor: STATUS[t.status].color }}
                        title={`Previsto ${t.scheduled_time}: ${t.title} (${STATUS[t.status].label})`} onClick={() => openTask(t.id)} />
                    ))}
                    {isToday && <span className="tl-now" style={{ left: x(nowMin()) }} />}
                  </div>
                </div>
              );
            })}
            {!data.people.length && <Empty>Nenhum colaborador ativo.</Empty>}
          </div>
        </div>
      </Card>

      <Card title="Últimos 7 dias · início da 1ª atividade e hora extra">
        <div className="table-scroll">
          <table className="simple tl-week">
            <thead>
              <tr>
                <th>Colaborador</th>
                {data.days.map((d) => <th key={d} className={d === date ? 'sel' : ''}>{fmtWeekday(d)} {fmtDate(d)}</th>)}
                <th>Dias com atraso</th><th>Atraso total</th><th>Hora extra</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => {
                const worked = p.week.filter((d) => d.first_start != null);
                const lateDays = worked.filter((d) => d.delay_min > 0);
                return (
                  <tr key={p.id}>
                    <td><span className="row gap-s"><Avatar name={p.name} id={p.id} size={22} />{p.name}</span></td>
                    {p.week.map((d) => (
                      <td key={d.date} className={d.date === date ? 'sel' : ''} onClick={() => setDate(d.date)} style={{ cursor: 'pointer' }}>
                        {d.first_start == null ? <span className="muted">—</span> : (
                          <>
                            <b className={d.delay_min > 0 ? 'danger-text' : 'ok-text'}>{hhmm(d.first_start)}</b>
                            {d.delay_min > 0 && <small className="danger-text"> +{fmtMin(d.delay_min)}</small>}
                            <br /><small className="muted">{fmtMin(d.worked_min)}{d.overtime_min > 0 && <span className="purple"> · +{fmtMin(d.overtime_min)} extra</span>}</small>
                          </>
                        )}
                      </td>
                    ))}
                    <td>{lateDays.length}/{worked.length}</td>
                    <td className={lateDays.length ? 'danger-text' : ''}>{fmtMin(lateDays.reduce((a, d) => a + d.delay_min, 0))}</td>
                    <td className="purple">{fmtMin(p.week.reduce((a, d) => a + d.overtime_min, 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {cfg && <WorkHours start={data.work_start} end={data.work_end} onClose={() => setCfg(false)} />}
    </div>
  );
}

export function WorkHours({ start, end, onClose }) {
  const [f, setF] = useState({ work_start: start, work_end: end });
  const save = async () => {
    try { await api('/company', { method: 'PATCH', body: f }); emitLocal(); toast('Horário da jornada atualizado', 'success'); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Horário da jornada" onClose={onClose} footer={<button className="btn primary" onClick={save}>Salvar</button>}>
      <p className="muted small" style={{ margin: 0 }}>Usado para calcular o atraso da primeira atividade e a hora extra (tempo trabalhado antes do início ou depois do fim).</p>
      <div className="grid-2">
        <Field label="Início da jornada"><input type="time" value={f.work_start} onChange={(e) => setF({ ...f, work_start: e.target.value })} /></Field>
        <Field label="Fim da jornada"><input type="time" value={f.work_end} onChange={(e) => setF({ ...f, work_end: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
