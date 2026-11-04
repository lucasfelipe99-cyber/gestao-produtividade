import React, { useState } from 'react';
import { api, toast, emitLocal, useData, useTick, KIND, STATUS, PRIORITY, ACTIONS, FIELD, fmtDateFull, fmtDateTime, fmtDur, fmtClock, fmtMin, fmtTime,
  liveSeconds, toLocalInput } from '../lib.js';
import { Icon, Avatar, StatusPill, PriorityPill, Loading, Progress, Field } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { taskAction, setStatus, TaskButtons } from './Tasks.jsx';
import TaskForm from './TaskForm.jsx';

const NOTE_KIND = { note: ['Observação', '#579bfc'], difficulty: ['Dificuldade', '#e2445c'], progress: ['Andamento', '#00c875'] };

export default function TaskDrawer({ id, onClose }) {
  const { isAdmin, me, users, categories, businesses, channels, openTask } = useApp();
  const { data, error } = useData(`/tasks/${id}`, [id]);
  const [tab, setTab] = useState('details');
  const [edit, setEdit] = useState(false);
  const task = data?.task;
  useTick(1000, !!task?.active_started_at);

  if (error) return <Shell onClose={onClose}><p className="pad">{error}</p></Shell>;
  if (!data) return <Shell onClose={onClose}><Loading /></Shell>;

  const secs = liveSeconds(task);
  const estSecs = task.estimated_minutes * 60;
  const canStatus = isAdmin || task.assignee_id === me.id;
  const mine = task.assignee_id === me.id;
  const ownCreated = mine && task.created_by === me.id;
  const removeFromDay = async () => {
    let reason = '';
    if (!ownCreated) {
      reason = prompt('Por que esta tarefa vai sair do seu dia? (fica registrado no histórico)') || '';
      if (!reason.trim()) return;
    } else if (!confirm('Tirar esta tarefa do seu dia?')) return;
    try {
      const r = await api(`/tasks/${id}/remove-from-day`, { method: 'POST', body: { reason } });
      emitLocal(); toast(r.result === 'deleted' ? 'Tarefa removida do seu dia' : 'Tarefa tirada do seu dia (registrada no histórico)'); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  const userName = (uid) => users.find((u) => u.id === Number(uid))?.name || '—';
  const catName = (cid) => categories.find((c) => c.id === Number(cid))?.name || '—';
  const refName = (list) => (id) => list.find((c) => c.id === Number(id))?.name || '—';

  const del = async () => {
    if (!confirm('Excluir esta tarefa? O histórico de auditoria será mantido.')) return;
    try { await api(`/tasks/${id}`, { method: 'DELETE' }); emitLocal(); toast('Tarefa excluída'); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  const stopRec = async () => {
    if (!confirm('Encerrar a recorrência? As próximas ocorrências ainda não iniciadas serão removidas; as já realizadas ficam no histórico.')) return;
    try { const r = await api(`/recurrences/${data.recurrence.id}/stop`, { method: 'POST' }); emitLocal(); toast(`Recorrência encerrada · ${r.removed} ocorrência(s) futura(s) removida(s)`); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <Shell onClose={onClose}>
      <div className="drawer-head">
        <div className="row gap-s wrap">
          <StatusPill status={task.status} onChange={canStatus ? (s) => setStatus(task, s) : null}
            options={isAdmin ? undefined : ['not_started', 'in_progress', 'paused', 'done']} />
          <PriorityPill priority={task.priority} />
          <span className={'tag' + (task.kind === 'oneoff' ? ' oneoff' : '')}>{KIND[task.kind]}</span>
          {task.overdue && <span className="tag danger">Vencida</span>}
        </div>
        <h2>{task.title}</h2>
        <div className="timer-box">
          <div>
            <small>Tempo utilizado</small>
            <div className={'big-timer mono' + (task.active_started_at ? ' running' : '')}>{fmtClock(secs)}</div>
            {estSecs > 0 && <Progress value={(secs / estSecs) * 100} color={secs > estSecs ? '#e2445c' : '#0073ea'} label={`${fmtMin(task.estimated_minutes)} estimado`} />}
            {task.active_started_at && <small className="muted">Cronômetro ativo com {task.active_user_name} desde {fmtDateTime(task.active_started_at)}
              {task.active_subtask_title ? <> · subtarefa <b>{task.active_subtask_title}</b></> : ''}</small>}
          </div>
          {canStatus && <TaskButtons task={task} />}
        </div>
        {task.parent_task_id && (
          <button className="group-banner" onClick={() => openTask(task.parent_task_id)}>
            <Icon name="share" size={15} /> Entrega para a tarefa <b>“{task.parent_title}”</b>{task.parent_assignee_name ? ` de ${task.parent_assignee_name}` : ''}
            {task.parent_status && <span className="muted"> · {STATUS[task.parent_status]?.label}</span>}
          </button>
        )}
      </div>

      <div className="tabs">
        {[['details', 'Detalhes'], ['time', `Tempo (${data.entries.length})`], ['notes', `Observações (${data.notes.length})`], ['history', 'Histórico']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className="drawer-body">
        {tab === 'details' && (
          <>
            <Partners task={task} />
            <Subtasks task={task} subtasks={data.subtasks} />
            <dl className="details">
              <dt>Responsável</dt><dd className="row gap-s"><Avatar name={task.assignee_name} id={task.assignee_id} size={22} />{task.assignee_name || 'Sem responsável'}</dd>
              <dt>{task.kind === 'daily' ? 'Data de execução' : 'Prazo de entrega'}</dt><dd>{fmtDateFull(task.due_date)} {task.scheduled_time && `às ${fmtTime(task.scheduled_time)}`}</dd>
              <dt>Data planejada original</dt><dd>{fmtDateFull(task.planned_date)}{task.rollover_count > 0 && <span className="tag warn"> transferida {task.rollover_count}x</span>}</dd>
              <dt>Empresa</dt><dd>{task.business_name ? <span className="cat"><i style={{ background: task.business_color }} />{task.business_name}</span> : '—'}</dd>
              <dt>Canal</dt><dd>{task.channel_name ? <span className="chan" style={{ background: task.channel_color }}>{task.channel_name}</span> : '—'}</dd>
              <dt>Categoria</dt><dd>{task.category_name ? <span className="cat"><i style={{ background: task.category_color }} />{task.category_name}</span> : '—'}</dd>
              <dt>Equipe</dt><dd>{task.team_name || '—'}</dd>
              <dt>Tempo estimado</dt><dd>{task.estimated_minutes ? fmtMin(task.estimated_minutes) : '—'}</dd>
              <dt>Início</dt><dd>{fmtDateTime(task.started_at)}</dd>
              <dt>Conclusão</dt><dd>{fmtDateTime(task.completed_at)}</dd>
              <dt>Criada por</dt><dd>{task.created_by_name || 'Automação'} em {fmtDateTime(task.created_at)}</dd>
              {data.recurrence && <><dt>Recorrência</dt><dd>{{ daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' }[data.recurrence.frequency]}
                {data.recurrence.active ? <> · {data.recurrence.upcoming} ocorrência(s) programada(s) até {fmtDateFull(data.recurrence.last_date)} {isAdmin && <button className="link danger" onClick={stopRec}>encerrar recorrência</button>}</> : ' · encerrada'}</dd></>}
            </dl>
            <h4>Descrição</h4>
            <p className="pre">{task.description || <span className="muted">Sem descrição.</span>}</p>
            <NotesField task={task} />
            {!isAdmin && mine && task.status !== 'cancelled' && (
              <div className="row gap wrap mt">
                {ownCreated && <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={15} /> Editar</button>}
                {task.status !== 'done' && <button className="btn danger" onClick={removeFromDay}><Icon name="trash" size={15} /> Tirar do meu dia</button>}
              </div>
            )}
            {isAdmin && (
              <div className="row gap wrap mt">
                <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={15} /> Editar</button>
                {task.status !== 'cancelled' && <button className="btn" onClick={() => setStatus(task, 'cancelled')}><Icon name="stop" size={15} /> Cancelar tarefa</button>}
                <button className="btn danger" onClick={del}><Icon name="trash" size={15} /> Excluir</button>
              </div>
            )}
          </>
        )}

        {tab === 'time' && <TimeTab task={task} entries={data.entries} subtasks={data.subtasks} />}

        {tab === 'notes' && <NotesTab task={task} notes={data.notes} />}

        {tab === 'history' && (
          <ul className="timeline">
            {data.events.map((e) => (
              <li key={e.id}>
                <span className="tl-dot" />
                <div>
                  <b>{e.user_name || 'Automação'}</b> {ACTIONS[e.action] ? ACTIONS[e.action].charAt(0).toLowerCase() + ACTIONS[e.action].slice(1) : e.action}
                  <small className="muted"> · {fmtDateTime(e.created_at)}</small>
                  <EventDetails e={e} userName={userName} catName={catName} bizName={refName(businesses)} chanName={refName(channels)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {edit && <TaskForm initial={task} onClose={() => setEdit(false)} />}
    </Shell>
  );
}

function Shell({ children, onClose }) {
  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <button className="icon-btn drawer-close" onClick={onClose}><Icon name="x" /></button>
        {children}
      </aside>
    </div>
  );
}

function NotesField({ task }) {
  const [v, setV] = useState(task.notes);
  const [dirty, setDirty] = useState(false);
  const save = async () => {
    try { await api(`/tasks/${task.id}`, { method: 'PATCH', body: { notes: v } }); setDirty(false); emitLocal(); toast('Observações salvas', 'success'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <h4>Observações gerais</h4>
      <textarea rows={3} value={v} onChange={(e) => { setV(e.target.value); setDirty(true); }} placeholder="Anotações sobre a tarefa" />
      {dirty && <button className="btn sm primary mt-s" onClick={save}>Salvar observações</button>}
    </>
  );
}

function TimeTab({ task, entries, subtasks }) {
  const { isAdmin, activeUsers, me } = useApp();
  const now = new Date();
  const [f, setF] = useState({ start: toLocalInput(new Date(now - 3600e3)), end: toLocalInput(now), finish: false, user_id: '', subtask_id: '' });
  const secs = f.start && f.end ? (new Date(f.end) - new Date(f.start)) / 1000 : 0;
  const submit = async () => {
    try {
      await api(`/tasks/${task.id}/manual-time`, { method: 'POST', body: {
        started_at: new Date(f.start).toISOString(), ended_at: new Date(f.end).toISOString(), finish: f.finish, user_id: f.user_id || undefined, subtask_id: f.subtask_id || undefined } });
      emitLocal(); toast('Horário lançado', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (eid) => {
    if (!confirm('Remover este registro de tempo?')) return;
    try { await api(`/time-entries/${eid}`, { method: 'DELETE' }); emitLocal(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      {task.status !== 'cancelled' && (
        <div className="manual-box">
          <h4>Lançamento manual de horário</h4>
          <p className="muted small">Use quando não tiver usado os botões Iniciar/Finalizar. O tempo é calculado automaticamente.</p>
          <div className="grid-2">
            <Field label="Data e horário de início"><input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field label="Data e horário de finalização"><input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          </div>
          {subtasks.length > 0 && (
            <Field label="Subtarefa (opcional)">
              <select value={f.subtask_id} onChange={(e) => setF({ ...f, subtask_id: e.target.value })}>
                <option value="">Tarefa principal (geral)</option>
                {subtasks.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </Field>
          )}
          {isAdmin && (
            <Field label="Colaborador">
              <select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}>
                <option value="">{me.name} (eu)</option>
                {activeUsers.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          )}
          <div className="row between wrap gap">
            <label className="check"><input type="checkbox" checked={f.finish} onChange={(e) => setF({ ...f, finish: e.target.checked })} disabled={task.status === 'done'} /> Marcar tarefa como concluída</label>
            <span>Tempo calculado: <b>{secs > 0 ? fmtDur(secs) : '—'}</b></span>
          </div>
          <button className="btn primary mt-s" disabled={secs <= 0} onClick={submit}>Lançar horário</button>
        </div>
      )}
      <h4>Períodos registrados</h4>
      {!entries.length && <p className="muted">Nenhum registro de tempo ainda.</p>}
      <table className="simple">
        <thead><tr><th>Colaborador</th><th>Subtarefa</th><th>Início</th><th>Fim</th><th>Duração</th><th>Origem</th>{isAdmin && <th />}</tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.user_name}</td><td>{e.subtask_title || <span className="muted">—</span>}</td><td>{fmtDateTime(e.started_at)}</td><td>{e.ended_at ? fmtDateTime(e.ended_at) : <span className="tag ok">em andamento</span>}</td>
              <td>{e.ended_at ? fmtDur(e.seconds) : '—'}</td><td>{e.source === 'manual' ? 'Manual' : 'Cronômetro'}</td>
              {isAdmin && <td>{e.ended_at && <button className="icon-btn sm" onClick={() => remove(e.id)} title="Remover"><Icon name="trash" size={14} /></button>}</td>}
            </tr>
          ))}
        </tbody>
        {entries.length > 0 && <tfoot><tr><td colSpan={4}><b>Total</b></td><td><b>{fmtDur(task.tracked_seconds)}</b></td><td colSpan={2} /></tr></tfoot>}
      </table>
    </>
  );
}

function NotesTab({ task, notes }) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('progress');
  const send = async () => {
    if (!body.trim()) return;
    try { await api(`/tasks/${task.id}/notes`, { method: 'POST', body: { body, kind } }); setBody(''); emitLocal(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <div className="note-form">
        <div className="segmented sm">
          {Object.entries(NOTE_KIND).map(([k, [l]]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder={kind === 'difficulty' ? 'Descreva a dificuldade ou impedimento encontrado' : kind === 'progress' ? 'Atualize o andamento da atividade' : 'Escreva uma observação'} />
        <button className="btn primary sm" onClick={send}>Registrar</button>
      </div>
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id} style={{ borderLeftColor: NOTE_KIND[n.kind][1] }}>
            <div className="row between"><b>{n.user_name}</b><small className="muted">{NOTE_KIND[n.kind][0]} · {fmtDateTime(n.created_at)}</small></div>
            <p className="pre">{n.body}</p>
          </li>
        ))}
        {!notes.length && <p className="muted">Nenhum registro ainda.</p>}
      </ul>
    </>
  );
}

function EventDetails({ e, userName, catName, bizName, chanName }) {
  const d = e.details || {};
  const fmtVal = (k, v) => {
    if (v == null || v === '') return '—';
    if (k === 'status') return STATUS[v]?.label || v;
    if (k === 'priority') return PRIORITY[v]?.label || v;
    if (k === 'assignee_id') return userName(v);
    if (k === 'category_id') return catName(v);
    if (k === 'business_id') return bizName(v);
    if (k === 'channel_id') return chanName(v);
    if (k === 'due_date') return fmtDateFull(v);
    if (k === 'estimated_minutes') return fmtMin(v);
    if (k === 'shared') return v === true || v === 'true' ? 'sim' : 'não';
    if (k === 'description' || k === 'notes') return String(v).slice(0, 60) + (String(v).length > 60 ? '…' : '');
    return String(v);
  };
  if (['updated', 'status_changed', 'cancelled'].includes(e.action)) {
    return <ul className="diff">{Object.entries(d).map(([k, v]) => <li key={k}>{FIELD[k] || k}: <s>{fmtVal(k, v.from)}</s> → <b>{fmtVal(k, v.to)}</b></li>)}</ul>;
  }
  if (e.action === 'rolled_over') return <div className="small muted">De {fmtDateFull(d.from)} para {fmtDateFull(d.to)}</div>;
  if (e.action === 'manual_time') return <div className="small muted">{fmtDateTime(d.started_at)} → {fmtDateTime(d.ended_at)} ({fmtDur(d.seconds)}){d.for_user && d.for_user !== e.user_id ? ` para ${userName(d.for_user)}` : ''}{d.finished ? ' · concluída' : ''}</div>;
  if (e.action === 'paused') return <div className="small muted">Período: {fmtDur(d.seconds)}</div>;
  if (e.action === 'finished') return <div className="small muted">Tempo total: {fmtDur(d.total_seconds)}</div>;
  if (e.action === 'time_removed') return <div className="small muted">{fmtDur(d.seconds)} removidos</div>;
  if (e.action === 'note_added') return <div className="small muted">{NOTE_KIND[d.kind]?.[0]}</div>;
  if (e.action.startsWith('subtask_')) return <div className="small muted">“{d.subtask}”{d.seconds ? ` · ${fmtDur(d.seconds)}` : ''}</div>;
  if (['partner_added', 'partner_delivered', 'partner_removed'].includes(e.action)) return <div className="small muted">{d.partner ? `${d.partner}: ` : ''}“{d.partner_task}”{d.due_date ? ` · prazo ${fmtDateFull(d.due_date)}` : ''}{d.reason ? ` · motivo: ${d.reason}` : ''}</div>;
  if (e.action === 'removed_from_day') return <div className="small muted">Motivo: {d.reason || '—'}</div>;
  if (e.action === 'series_updated') return <div className="small muted">{d.tasks} ocorrência(s) atualizada(s)</div>;
  return null;
}

function Subtasks({ task, subtasks }) {
  const { me, isAdmin } = useApp();
  const [title, setTitle] = useState('');
  const running = subtasks.some((s) => s.active_started_at);
  useTick(1000, running || !!task.active_started_at);
  const canAct = isAdmin || task.assignee_id === me.id;
  const myTimerHere = task.active_started_at && task.active_user_id === me.id;
  const call = async (path, body) => { try { const r = await api(path, { method: 'POST', body }); emitLocal(); return r; } catch (e) { toast(e.message, 'error'); } };
  const add = async () => {
    if (!title.trim()) return;
    const r = await call(`/tasks/${task.id}/subtasks`, { title });
    if (r) { setTitle(''); if (r.started) toast('Subtarefa criada e cronômetro iniciado nela', 'success'); }
  };
  const rename = async (s) => {
    const t = prompt('Nome da subtarefa', s.title); if (!t) return;
    try { await api(`/subtasks/${s.id}`, { method: 'PATCH', body: { title: t } }); emitLocal(); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (s) => {
    if (!confirm(`Remover a subtarefa "${s.title}"? O tempo dela continua somado na tarefa principal.`)) return;
    try { await api(`/subtasks/${s.id}`, { method: 'DELETE' }); emitLocal(); } catch (e) { toast(e.message, 'error'); }
  };
  const live = (s) => s.tracked_seconds + (s.active_started_at ? (Date.now() - new Date(s.active_started_at)) / 1000 : 0);
  const total = liveSeconds(task);
  const sumSubs = subtasks.reduce((a, s) => a + live(s), 0);
  const done = subtasks.filter((s) => s.done).length;
  return (
    <div className="subtasks">
      <div className="row between">
        <h4>Subtarefas {subtasks.length > 0 && <span className="muted">· {done}/{subtasks.length} concluídas</span>}</h4>
        {subtasks.length > 0 && <small className="muted">Subtarefas {fmtDur(sumSubs)} · geral {fmtDur(Math.max(0, total - sumSubs))}</small>}
      </div>
      {subtasks.length > 0 && <Progress value={subtasks.length ? (done / subtasks.length) * 100 : 0} height={6} label={false} />}
      <ul>
        {subtasks.map((s) => {
          const on = !!s.active_started_at;
          return (
            <li key={s.id} className={(on ? 'on ' : '') + (s.done ? 'done' : '')}>
              <input type="checkbox" checked={s.done} disabled={!canAct}
                onChange={() => call(`/subtasks/${s.id}/${s.done ? 'reopen' : 'finish'}`)} title={s.done ? 'Reabrir' : 'Concluir'} />
              <span className="grow st-title" onDoubleClick={() => canAct && rename(s)}>{s.title}</span>
              <span className={'timer-cell' + (on ? ' running' : '')}>{on && <span className="pulse" />}{on ? fmtClock(live(s)) : fmtDur(live(s))}</span>
              {canAct && task.status !== 'cancelled' && (
                on ? <button className="btn xs finish" onClick={() => call(`/subtasks/${s.id}/finish`)} title="Concluir subtarefa (o cronômetro segue na tarefa)"><Icon name="check" size={13} /></button>
                  : !s.done && <button className="btn xs start" onClick={() => call(`/subtasks/${s.id}/start`)} title={myTimerHere ? 'Mudar o cronômetro para esta subtarefa' : 'Iniciar subtarefa'}><Icon name="play" size={13} /></button>
              )}
              {canAct && <button className="icon-btn sm" onClick={() => remove(s)} title="Remover"><Icon name="trash" size={13} /></button>}
            </li>
          );
        })}
      </ul>
      {canAct && task.status !== 'cancelled' && (
        <div className="row gap-s">
          <input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={myTimerHere ? 'Nova subtarefa (começa a contar o tempo na hora)' : 'Adicionar subtarefa'} />
          <button className="btn primary sm" onClick={add}><Icon name="plus" size={14} /></button>
        </div>
      )}
    </div>
  );
}

// Tarefa em grupo: parceiros com a entrega e o prazo de cada um
function Partners({ task }) {
  const { isAdmin, me, activeUsers, users, openTask } = useApp();
  const canAdd = (isAdmin || task.assignee_id === me.id) && !['done', 'cancelled'].includes(task.status) && !task.parent_task_id;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ user_id: '', title: '', due_date: task.due_date, scheduled_time: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const list = task.partners || [];
  const directory = useData(open && !isAdmin ? '/users/directory' : null);
  const people = (isAdmin ? activeUsers : directory.data || []).filter((u) => u.id !== task.assignee_id);
  const add = async () => {
    if (!f.user_id || !f.title.trim()) return toast('Escolha o parceiro e descreva a entrega', 'error');
    try { await api(`/tasks/${task.id}/partners`, { method: 'POST', body: f }); emitLocal(); setOpen(false); setF({ user_id: '', title: '', due_date: task.due_date, scheduled_time: '' }); toast('Parceiro adicionado: a entrega já aparece no dia dele', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const pending = list.filter((p) => p.status !== 'done').length;
  if (!list.length && !canAdd) return null;
  return (
    <div className="partners">
      <div className="row between">
        <h4>Tarefa em grupo {list.length > 0 && <span className="muted">· {pending ? `aguardando ${pending} entrega(s)` : 'todas as entregas concluídas'}</span>}</h4>
        {canAdd && !open && <button className="btn sm" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Adicionar parceiro</button>}
      </div>
      {list.length > 0 && (
        <ul>
          {list.map((p) => (
            <li key={p.id} className={p.status === 'done' ? 'done' : p.late ? 'late' : ''} onClick={() => openTask(p.id)}>
              <Avatar name={p.assignee_name} id={p.assignee_id} size={24} />
              <div className="grow">
                <b>{p.title}</b>
                <small className="muted">{p.assignee_name} · prazo {fmtDateFull(p.due_date)}{p.scheduled_time ? ` às ${p.scheduled_time}` : ''}</small>
              </div>
              <span className={'tag ' + (p.status === 'done' ? 'ok' : p.late ? 'danger' : 'warn')}>
                {p.status === 'done' ? 'Entregue' : p.late ? 'Atrasada' : STATUS[p.status]?.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="inline-form">
          <div className="row gap-s wrap">
            <select value={f.user_id} onChange={set('user_id')}>
              <option value="">Colaborador parceiro</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="date" value={f.due_date} onChange={set('due_date')} title="Prazo de entrega do parceiro" />
            <input type="time" value={f.scheduled_time} onChange={set('scheduled_time')} title="Horário (opcional)" />
          </div>
          <input value={f.title} onChange={set('title')} placeholder="O que o parceiro precisa entregar" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <div className="row gap-s">
            <button className="btn primary sm" onClick={add}>Adicionar</button>
            <button className="btn sm" onClick={() => setOpen(false)}>Cancelar</button>
            <small className="muted">A entrega vira uma tarefa no dia do parceiro, ligada a esta.</small>
          </div>
        </div>
      )}
    </div>
  );
}
