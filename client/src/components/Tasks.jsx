import React, { useState } from 'react';
import { api, toast, emitLocal, useTick, STATUS, STATUS_ORDER, PRIORITY, fmtDate, fmtTime, fmtDur, fmtClock, fmtMin, liveSeconds,
  parseDate, toISODate, addDays, monthStart, fmtWeekday } from '../lib.js';
import { Icon, Avatar, StatusPill, PriorityPill, Pill, Empty, Progress } from '../ui.jsx';
import { useApp } from '../App.jsx';

export async function taskAction(id, action) {
  try {
    await api(`/tasks/${id}/${action}`, { method: 'POST' });
    emitLocal();
    if (action === 'finish') toast('Tarefa concluída', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function setStatus(task, status) {
  try {
    if (status === 'in_progress') return taskAction(task.id, 'start');
    if (status === 'done') return taskAction(task.id, 'finish');
    if (status === 'paused' && task.active_started_at) return taskAction(task.id, 'pause');
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status } });
    emitLocal();
  } catch (e) { toast(e.message, 'error'); }
}

export function TimerCell({ task }) {
  const running = !!task.active_started_at;
  useTick(1000, running);
  const secs = liveSeconds(task);
  const over = task.estimated_minutes > 0 && secs > task.estimated_minutes * 60;
  return (
    <span className={'timer-cell' + (running ? ' running' : '') + (over ? ' over' : '')} title={task.estimated_minutes ? `Estimado: ${fmtMin(task.estimated_minutes)}` : ''}>
      {running ? <><span className="pulse" />{fmtClock(secs)}</> : fmtDur(secs)}
    </span>
  );
}

export function TaskButtons({ task, compact }) {
  const { me } = useApp();
  if (task.status === 'cancelled') return null;
  const running = !!task.active_started_at;
  const mineRunning = running && task.active_user_id === me.id;
  const stop = (e) => e.stopPropagation();
  return (
    <span className="task-btns" onClick={stop}>
      {task.status !== 'done' && !running && (
        <button className="btn xs start" onClick={() => taskAction(task.id, 'start')} title="Iniciar tarefa"><Icon name="play" size={13} />{!compact && (task.status === 'paused' ? 'Retomar' : 'Iniciar')}</button>
      )}
      {running && (mineRunning || me.role === 'admin') && (
        <button className="btn xs pause" onClick={() => taskAction(task.id, 'pause')} title="Pausar"><Icon name="pause" size={13} />{!compact && 'Pausar'}</button>
      )}
      {task.status !== 'done' && (
        <button className="btn xs finish" onClick={() => taskAction(task.id, 'finish')} title="Finalizar tarefa"><Icon name="check" size={13} />{!compact && 'Finalizar'}</button>
      )}
      {task.status === 'done' && <span className="done-mark"><Icon name="check" size={14} /> Concluída</span>}
    </span>
  );
}

function Badges({ task }) {
  return (
    <span className="badges">
      {task.carried && <span className="tag warn" title="Pendência de semana anterior">Pendência anterior</span>}
      {task.rollover_count > 0 && <span className="tag warn" title={`Planejada para ${fmtDate(task.planned_date)}`}>Transferida {task.rollover_count}x</span>}
      {task.overdue && !task.carried && !task.rollover_count && <span className="tag danger">Vencida</span>}
      {task.recurrence_id && <span className="tag" title="Tarefa recorrente"><Icon name="repeat" size={12} /></span>}
      {task.shared && <span className="tag" title="Compartilhada com a equipe"><Icon name="share" size={12} /></span>}
    </span>
  );
}

// Tabela agrupada por status (estilo Monday)
export function TaskTable({ tasks, groupBy = 'status', showDate = false }) {
  const { openTask, isAdmin, me } = useApp();
  const [collapsed, setCollapsed] = useState({});
  if (!tasks.length) return <Empty>Nenhuma tarefa encontrada para os filtros selecionados.</Empty>;
  let groups;
  if (groupBy === 'status') {
    groups = STATUS_ORDER.map((s) => ({ key: s, label: STATUS[s].label, color: STATUS[s].color, items: tasks.filter((t) => t.status === s) })).filter((g) => g.items.length);
  } else {
    const map = new Map();
    for (const t of tasks) {
      const k = groupBy === 'assignee' ? (t.assignee_id || 0) : (t.team_id || 0);
      const label = groupBy === 'assignee' ? (t.assignee_name || 'Sem responsável') : (t.team_name || 'Sem equipe');
      if (!map.has(k)) map.set(k, { key: k, label, items: [] });
      map.get(k).items.push(t);
    }
    groups = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    groups.forEach((g, i) => (g.color = ['#0073ea', '#a25ddc', '#00c875', '#fdab3d', '#e2445c', '#579bfc'][i % 6]));
  }
  return (
    <div className="board">
      {groups.map((g) => {
        const valid = g.items.filter((t) => t.status !== 'cancelled');
        const done = valid.filter((t) => t.status === 'done').length;
        const pct = valid.length ? (done / valid.length) * 100 : 0;
        const est = g.items.reduce((s, t) => s + t.estimated_minutes, 0);
        const spent = g.items.reduce((s, t) => s + t.tracked_seconds, 0);
        return (
          <div className="group" key={g.key} style={{ '--g': g.color }}>
            <div className="group-title" onClick={() => setCollapsed({ ...collapsed, [g.key]: !collapsed[g.key] })}>
              <Icon name={collapsed[g.key] ? 'right' : 'down'} size={14} />
              <b>{g.label}</b><span className="muted">{g.items.length} tarefa(s)</span>
              {groupBy !== 'status' && <span className="group-progress"><Progress value={pct} height={6} label={`${done}/${valid.length} · ${Math.round(pct)}%`} /></span>}
            </div>
            {!collapsed[g.key] && (
              <div className="table-scroll">
                <table className="tasks desktop-only">
                  <colgroup><col /><col style={{ width: 110 }} /><col style={{ width: 128 }} /><col style={{ width: 100 }} /><col style={{ width: showDate ? 95 : 72 }} />
                    <col style={{ width: 120 }} /><col style={{ width: 80 }} /><col style={{ width: 95 }} /><col style={{ width: 188 }} /></colgroup>
                  <thead>
                    <tr>
                      <th className="c-title">Tarefa</th><th>Responsável</th><th>Status</th><th>Prioridade</th>
                      <th>{showDate ? 'Prazo' : 'Horário'}</th><th>Categoria</th><th>Estimado</th><th>Tempo</th><th className="c-actions">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((t) => {
                      const canStatus = isAdmin || t.assignee_id === me.id || t.shared || !t.assignee_id;
                      return (
                        <tr key={t.id} onClick={() => openTask(t.id)} className={t.status === 'done' ? 'is-done' : ''}>
                          <td className="c-title"><span className="title-text">{t.title}</span><Badges task={t} /></td>
                          <td><span className="row gap-s"><Avatar name={t.assignee_name} id={t.assignee_id} size={24} /><span className="hide-sm">{t.assignee_name?.split(' ')[0]}</span></span></td>
                          <td className="c-pill"><StatusPill status={t.status} onChange={canStatus ? (s) => setStatus(t, s) : null}
                            options={isAdmin ? undefined : ['not_started', 'in_progress', 'paused', 'done']} /></td>
                          <td className="c-pill"><PriorityPill priority={t.priority} /></td>
                          <td className="nowrap">{showDate ? <>{fmtWeekday(t.due_date)} {fmtDate(t.due_date)}</> : (fmtTime(t.scheduled_time) || <span className="muted">—</span>)}</td>
                          <td>{t.category_name ? <span className="cat"><i style={{ background: t.category_color }} />{t.category_name}</span> : <span className="muted">—</span>}</td>
                          <td className="nowrap">{t.estimated_minutes ? fmtMin(t.estimated_minutes) : <span className="muted">—</span>}</td>
                          <td className="nowrap"><TimerCell task={t} /></td>
                          <td className="c-actions"><TaskButtons task={t} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!collapsed[g.key] && (
              <div className="mobile-only mcards">
                {g.items.map((t) => (
                  <div key={t.id} className="mcard" onClick={() => openTask(t.id)}>
                    <div className="row between gap-s"><b className={t.status === 'done' ? 'title-text done' : 'title-text'}>{t.title}</b><TimerCell task={t} /></div>
                    <Badges task={t} />
                    <div className="row gap-s wrap">
                      <Pill color={STATUS[t.status].color} className="xs">{STATUS[t.status].label}</Pill>
                      <Pill color={PRIORITY[t.priority].color} className="xs">{PRIORITY[t.priority].label}</Pill>
                      {t.category_name && <span className="cat small"><i style={{ background: t.category_color }} />{t.category_name}</span>}
                    </div>
                    <div className="row between">
                      <span className="row gap-s"><Avatar name={t.assignee_name} id={t.assignee_id} size={22} />
                        <small className="muted">{showDate ? fmtDate(t.due_date) : fmtTime(t.scheduled_time)}{t.estimated_minutes ? ' · est. ' + fmtMin(t.estimated_minutes) : ''}</small></span>
                      <TaskButtons task={t} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="group-foot">
              <span>Estimado: <b>{fmtMin(est)}</b></span><span>Realizado: <b>{fmtDur(spent)}</b></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Kanban por status com arrastar e soltar
export function Kanban({ tasks }) {
  const { openTask, isAdmin } = useApp();
  const [over, setOver] = useState(null);
  const cols = isAdmin ? ['not_started', 'in_progress', 'paused', 'late', 'done', 'cancelled'] : ['not_started', 'in_progress', 'paused', 'late', 'done'];
  const drop = (e, status) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const t = tasks.find((x) => x.id === id);
    if (t && t.status !== status) setStatus(t, status);
  };
  return (
    <div className="kanban">
      {cols.map((s) => {
        const items = tasks.filter((t) => t.status === s);
        return (
          <div key={s} className={'kcol' + (over === s ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, s)}>
            <div className="kcol-head" style={{ background: STATUS[s].color }}>{STATUS[s].label}<span>{items.length}</span></div>
            <div className="kcol-body">
              {items.map((t) => (
                <div key={t.id} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} onClick={() => openTask(t.id)}>
                  <div className="row between"><Pill color={PRIORITY[t.priority].color} className="xs">{PRIORITY[t.priority].label}</Pill><TimerCell task={t} /></div>
                  <b className="kcard-title">{t.title}</b>
                  <Badges task={t} />
                  <div className="row between">
                    <span className="row gap-s"><Avatar name={t.assignee_name} id={t.assignee_id} size={22} />
                      <small className="muted">{fmtDate(t.due_date)}{t.scheduled_time ? ' · ' + fmtTime(t.scheduled_time) : ''}</small></span>
                    <TaskButtons task={t} compact />
                  </div>
                </div>
              ))}
              {!items.length && <div className="kempty">Arraste tarefas para cá</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Calendário mensal
export function CalendarView({ tasks, month, onPickDay }) {
  const { openTask } = useApp();
  const first = monthStart(month);
  const d0 = parseDate(first);
  const offset = (d0.getDay() + 6) % 7; // segunda = 0
  const start = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = toISODate(new Date());
  const byDay = {};
  tasks.forEach((t) => { (byDay[t.due_date] ||= []).push(t); });
  return (
    <div className="calendar">
      {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((w) => <div key={w} className="cal-wd">{w}</div>)}
      {days.map((d) => {
        const items = byDay[d] || [];
        const inMonth = d.slice(0, 7) === first.slice(0, 7);
        return (
          <div key={d} className={'cal-day' + (inMonth ? '' : ' out') + (d === today ? ' today' : '')}>
            <button className="cal-num" onClick={() => onPickDay?.(d)}>{Number(d.slice(8))}</button>
            {items.slice(0, 4).map((t) => (
              <button key={t.id} className="cal-task" style={{ borderLeftColor: STATUS[t.status].color }} onClick={() => openTask(t.id)} title={t.title}>
                {t.scheduled_time && <small>{fmtTime(t.scheduled_time)} </small>}{t.title}
              </button>
            ))}
            {items.length > 4 && <button className="cal-more" onClick={() => onPickDay?.(d)}>+{items.length - 4} tarefas</button>}
          </div>
        );
      })}
    </div>
  );
}

export function TaskFilters({ filters, setFilters, extra }) {
  const { isAdmin, activeUsers, categories, teams } = useApp();
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  return (
    <div className="filters">
      <Icon name="filter" size={16} />
      {isAdmin && (
        <select value={filters.assignee || ''} onChange={set('assignee')}>
          <option value="">Todos os colaboradores</option>
          <option value="none">Sem responsável</option>
          {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )}
      {!isAdmin && (
        <select value={filters.mine || ''} onChange={set('mine')}>
          <option value="">Minhas + compartilhadas</option>
          <option value="1">Somente minhas</option>
        </select>
      )}
      <select value={filters.status || ''} onChange={set('status')}>
        <option value="">Todos os status</option>
        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        <option value="overdue">Vencidas (atrasadas)</option>
      </select>
      <select value={filters.category || ''} onChange={set('category')}>
        <option value="">Todas as categorias</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {teams.length > 0 && (
        <select value={filters.team || ''} onChange={set('team')}>
          <option value="">Todas as equipes</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {extra}
    </div>
  );
}

export const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
