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
  const [dayCfg, setDayCfg] = useState(false);
  const { data } = useData(`/timeline?date=${date}${user ? '&user=' + user : ''}`);
  const isToday = date === me.today;
  const anyRunning = data?.people.some((p) => p.entries.some((e) => e.running));
  useTick(30000, isToday && anyRunning);

  const backfill = async () => {
    try {
      const r = await api('/timeline/backfill', { method: 'POST', body: { day: date } });
      emitLocal();
      toast(r.filled ? `${r.filled} tarefa(s) concluída(s) sem cronômetro receberam tempo pela conclusão (${fmtMin(Math.round(r.seconds / 60))})`
        : r.candidates ? `${r.candidates} tarefa(s) sem tempo, mas o intervalo já está ocupado` : 'Nenhuma tarefa concluída sem tempo neste dia', r.filled ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
  };
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
          <p className="muted">{fmtDateLong(date)}{isToday && ' · hoje'} · jornada {data.work_start} às {data.work_end} · almoço {data.lunch_start}–{data.lunch_end}
            {isAdmin && <> · <button className="link" onClick={() => setCfg(true)}>alterar horário</button></>}
            {data.day_start && <><br /><span className="tag warn">Início considerado neste dia: {data.day_start.start_time}{data.day_start.reason ? ` · ${data.day_start.reason}` : ''}</span></>}
            {isAdmin && <> {data.day_start ? '' : <br />}<button className="link" onClick={() => setDayCfg(true)}>{data.day_start ? 'alterar' : 'ajustar início só deste dia'}</button></>}
            {isAdmin && date < me.today && <> · <button className="link" onClick={backfill}>recalcular tempo pela conclusão</button></>}</p>
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
        <Kpi label="Tarefas concluídas" value={data.people.reduce((a, p) => a + p.done.length, 0)} color="#00c875" icon="check" sub="no dia, por toda a equipe" />
        <Kpi label="Horas trabalhadas" value={fmtMin(s.total_worked_min)} color="#0073ea" icon="clock" sub={`jornada esperada ${fmtMin(data.expected_min)} por pessoa`} />
        <Kpi label="Inatividade" value={fmtMin(s.total_idle_min)} color="#676879" icon="clock" sub="lacunas sem atividade na jornada" />
        <Kpi label="Hora extra" value={fmtMin(s.total_overtime_min)} color="#a25ddc" icon="clock" sub={`fora de ${data.work_start}–${data.work_end} ou no almoço`} />
      </div>

      <Card>
        <div className="tl-legend">
          <span><i className="lg-idle" /> Inatividade (lacuna sem atividade)</span>
          <span><i className="lg-inferred" /> Tempo pela conclusão (da conclusão anterior até esta)</span>
          <span><i className="lg-extra" /> Fora da jornada (hora extra)</span>
          <span><i className="lg-lunch" /> Almoço de 1h (adiado se houver atividade em andamento às {data.lunch_start}; trabalho nele conta como extra)</span>
          <span><i className="lg-plan" /> Horário previsto de tarefa</span>
          <span><i className="lg-done">✓</i> Hora da conclusão</span>
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
                        Trabalhado <b>{fmtMin(m.worked_min)}</b>{m.overtime_min > 0 && <> · extra <b className="purple">{fmtMin(m.overtime_min)}</b></>}
                        <br />Almoço <b>{hhmm(m.lunch_from)}–{hhmm(m.lunch_to)}</b>{m.lunch_delayed_min > 0 && <span className="muted"> (adiado)</span>}
                        {m.lunch_min > 0 && <span className="purple"> · {fmtMin(m.lunch_min)} trabalhando</span>}
                        {m.idle_min > 0 && <><br />Inativo <b className="idle-text">{fmtMin(m.idle_min)}</b></>}
                      </small>
                    ) : <small className="muted">Sem apontamento</small>}
                    {p.done.length > 0 && <small className="block muted">{p.done.length} concluída(s) · última às <b>{hhmm(p.done[p.done.length - 1].min)}</b></small>}
                  </div>
                  <div className="tl-track">
                    {hours.map((h) => <span key={h} className="tl-grid" style={{ left: x(h) }} />)}
                    {axisStart < ws && <span className="tl-off" style={{ left: x(axisStart), width: w(axisStart, ws) }} />}
                    {axisEnd > we && <span className="tl-off" style={{ left: x(we), width: w(we, axisEnd) }} />}
                    {m.lunch_from != null && <span className="tl-lunch" style={{ left: x(m.lunch_from), width: w(m.lunch_from, m.lunch_to) }}
                      title={`Almoço ${hhmm(m.lunch_from)}–${hhmm(m.lunch_to)}${m.lunch_delayed_min > 0 ? ` (adiado ${fmtMin(m.lunch_delayed_min)} pela atividade em andamento às ${data.lunch_start})` : ''}`}><em>Almoço</em></span>}
                    <span className="tl-work-line" style={{ left: x(ws) }} />
                    <span className="tl-work-line end" style={{ left: x(we) }} />
                    {data.day_start && m.start_min > ws && <span className="tl-skip" style={{ left: x(ws), width: w(ws, m.start_min) }} title={`Não considerado: início deste dia ajustado para ${data.day_start.start_time}`} />}
                    {(m.idle_gaps || []).map((g) => (
                      <span key={g.from} className="tl-idle" style={{ left: x(g.from), width: w(g.from, g.to) }}
                        title={`Inativo ${hhmm(g.from)}–${hhmm(g.to)} (${fmtMin(g.to - g.from)})`}>{g.to - g.from >= 25 && <em>Inativo</em>}</span>
                    ))}
                    {p.entries.map((e) => {
                      const end = live(e);
                      return (
                        <button key={e.id} className={'tl-block' + (e.running ? ' running' : '') + (e.source === 'manual' ? ' manual' : '') + (e.source === 'inferred' ? ' inferred' : '')}
                          style={{ left: x(e.start_min), width: `max(3px, ${w(e.start_min, end)})`, background: e.color }}
                          title={`${e.task_title}${e.subtask_title ? ' › ' + e.subtask_title : ''}\n${hhmm(e.start_min)}–${e.running ? 'agora' : hhmm(end)} (${fmtMin(end - e.start_min)})${e.source === 'manual' ? ' · lançamento manual' : e.source === 'inferred' ? ' · calculado pela conclusão' : ''}`}
                          onClick={() => openTask(e.task_id)}>
                          <span>{e.subtask_title || e.task_title}</span>
                        </button>
                      );
                    })}
                    {p.planned.map((t) => (
                      <button key={t.id} className="tl-plan" style={{ left: x(t.min), borderColor: STATUS[t.status].color }}
                        title={`Previsto ${t.scheduled_time}: ${t.title} (${STATUS[t.status].label})`} onClick={() => openTask(t.id)} />
                    ))}
                    {p.done.map((d) => (
                      <button key={'d' + d.id} className={'tl-done' + (d.timed ? '' : ' untimed')} style={{ left: x(d.min) }}
                        title={`Concluída às ${hhmm(d.min)}: ${d.title}${d.timed ? '' : ' (sem cronômetro)'}`} onClick={() => openTask(d.id)}>✓</button>
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

      <Card title="Últimos 7 dias · tempo trabalhado e hora extra">
        <div className="table-scroll">
          <table className="simple tl-week">
            <thead>
              <tr>
                <th>Colaborador</th>
                {data.days.map((d) => <th key={d} className={d === date ? 'sel' : ''}>{fmtWeekday(d)} {fmtDate(d)}</th>)}
                <th>Total trabalhado</th><th>Hora extra</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => {
                const worked = p.week.filter((d) => d.first_start != null);
                return (
                  <tr key={p.id}>
                    <td><span className="row gap-s"><Avatar name={p.name} id={p.id} size={22} />{p.name}</span></td>
                    {p.week.map((d) => (
                      <td key={d.date} className={d.date === date ? 'sel' : ''} onClick={() => setDate(d.date)} style={{ cursor: 'pointer' }}>
                        {d.first_start == null ? <span className="muted">—</span> : (
                          <>
                            <b>{fmtMin(d.worked_min)}</b>
                            {d.overtime_min > 0 && <><br /><small className="purple">+{fmtMin(d.overtime_min)} extra</small></>}
                          </>
                        )}
                      </td>
                    ))}
                    <td><b>{fmtMin(worked.reduce((a, d) => a + d.worked_min, 0))}</b></td>
                    <td className="purple">{fmtMin(p.week.reduce((a, d) => a + d.overtime_min, 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {dayCfg && <DayStart date={date} current={data.day_start} onClose={() => setDayCfg(false)} />}
      {cfg && <WorkHours start={data.work_start} end={data.work_end} lunchStart={data.lunch_start} lunchEnd={data.lunch_end} onClose={() => setCfg(false)} />}
    </div>
  );
}

export function WorkHours({ start, end, lunchStart, lunchEnd, onClose }) {
  const [f, setF] = useState({ work_start: start, work_end: end, lunch_start: lunchStart, lunch_end: lunchEnd });
  const save = async () => {
    try { await api('/company', { method: 'PATCH', body: f }); emitLocal(); toast('Horário da jornada atualizado', 'success'); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Horário da jornada" onClose={onClose} footer={<button className="btn primary" onClick={save}>Salvar</button>}>
      <p className="muted small" style={{ margin: 0 }}>Usado para calcular o atraso da primeira atividade e a hora extra (tempo trabalhado antes do início, depois do fim ou durante o almoço). Se uma atividade estiver em andamento no início do almoço, o almoço começa quando ela terminar, mantendo a mesma duração.</p>
      <div className="grid-2">
        <Field label="Início da jornada"><input type="time" value={f.work_start} onChange={(e) => setF({ ...f, work_start: e.target.value })} /></Field>
        <Field label="Fim da jornada"><input type="time" value={f.work_end} onChange={(e) => setF({ ...f, work_end: e.target.value })} /></Field>
        <Field label="Início do almoço"><input type="time" value={f.lunch_start} onChange={(e) => setF({ ...f, lunch_start: e.target.value })} /></Field>
        <Field label="Fim do almoço"><input type="time" value={f.lunch_end} onChange={(e) => setF({ ...f, lunch_end: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function DayStart({ date, current, onClose }) {
  const [t, setT] = useState(current?.start_time || '');
  const [reason, setReason] = useState(current?.reason || '');
  const save = async (clear) => {
    try {
      await api('/day-start', { method: 'PUT', body: { day: date, start_time: clear ? null : t, reason } });
      emitLocal(); toast(clear ? 'Ajuste removido' : 'Início do dia ajustado', 'success'); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Início considerado em ${fmtDate(date)}`} onClose={onClose}
      footer={<>{current && <button className="btn" onClick={() => save(true)}>Remover ajuste</button>}<button className="btn primary" disabled={!t} onClick={() => save(false)}>Salvar</button></>}>
      <p className="muted small" style={{ margin: 0 }}>Vale só para este dia e para toda a equipe. Antes desse horário não conta atraso nem inatividade (ex.: dia em que começaram a usar o sistema, reunião geral, treinamento).</p>
      <div className="grid-2">
        <Field label="Começar a contar às"><input type="time" value={t} onChange={(e) => setT(e.target.value)} /></Field>
        <Field label="Motivo (opcional)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: treinamento" /></Field>
      </div>
    </Modal>
  );
}
