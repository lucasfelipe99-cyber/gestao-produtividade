import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toast, emitLocal, useData, STATUS, PRIORITY, fmtDate, fmtDateLong, fmtDur, fmtMin, fmtDateTime, addDays, parseDate } from '../lib.js';
import { Icon, Kpi, Card, Loading, Empty, Modal, Field, Pill, Avatar } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { TimerCell, TaskButtons, BizChannel, qs } from '../components/Tasks.jsx';
import { hhmm } from './Timeline.jsx';

const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function whenLabel(date, time, today) {
  const d = date === today ? 'Hoje' : date === addDays(today, 1) ? 'Amanhã' : `${WD[parseDate(date).getDay()]}, ${fmtDate(date)}`;
  return time ? `${d} às ${time}` : d;
}

export default function Summary() {
  const { me, isAdmin, activeUsers, openTask } = useApp();
  const [user, setUser] = useState('');
  const viewingOther = isAdmin && user && Number(user) !== me.id;
  const uq = viewingOther ? `user=${user}` : '';
  const { data: sum } = useData(`/summary?${uq}`);
  const today = me.today;
  const tasks = useData(`/tasks?${qs({ kind: 'daily', from: today, to: today, assignee: viewingOther ? user : undefined, mine: viewingOther ? undefined : '1' })}`);
  const reminders = useData(`/notes?kind=reminder&${uq}`);
  const notes = useData(`/notes?kind=note&${uq}`);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null);

  const todayTasks = useMemo(() => {
    const order = { in_progress: 0, late: 1, paused: 2, not_started: 3, done: 4, cancelled: 5 };
    return [...(tasks.data || [])].filter((t) => t.status !== 'cancelled').sort((a, b) => order[a.status] - order[b.status]);
  }, [tasks.data]);
  const remList = (reminders.data || []).filter((r) => showDone || !['done', 'cancelled'].includes(r.task_status));
  const c = sum?.counts;
  const name = viewingOther ? activeUsers.find((u) => u.id === Number(user))?.name : me.name.split(' ')[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{viewingOther ? `Resumo de ${name}` : `Resumo de ${name}`}</h1>
          <p className="muted">{fmtDateLong(today)}{viewingOther && ' · somente leitura'}</p>
        </div>
        <div className="row gap wrap">
          {isAdmin && (
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Meu resumo</option>
              {activeUsers.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {!viewingOther && <NotifyButton />}
        </div>
      </div>

      {!sum ? <Loading /> : (
        <div className="kpis">
          <Kpi label="Tarefas de hoje" value={`${c.done}/${c.total}`} color="#00c875" icon="check" sub={c.in_progress ? `${c.in_progress} em andamento` : null} />
          <Kpi label="Atrasadas" value={c.overdue} color={c.overdue ? '#e2445c' : '#00c875'} icon="alert" sub="de dias anteriores" />
          <Kpi label="Semanais da semana" value={`${c.week_done}/${c.week_total}`} color="#579bfc" icon="week" />
          <Kpi label="Tempo apontado hoje" value={fmtDur(sum.seconds)} color="#a25ddc" icon="clock" />
          <Kpi label="Início do dia" value={sum.day?.first_start != null ? hhmm(sum.day.first_start) : '—'} icon="timeline"
            color={sum.day?.delay_min > 0 ? '#e2445c' : '#0073ea'}
            sub={sum.day?.first_start == null ? 'sem atividade ainda' : sum.day.delay_min > 0 ? `${fmtMin(sum.day.delay_min)} após ${sum.work_start}` : 'no horário'} />
          <Kpi label="Próximo lembrete" value={sum.reminders[0] ? (sum.reminders[0].remind_time || 'Dia todo') : '—'} color="#fdab3d" icon="bell"
            sub={sum.reminders[0] ? `${whenLabel(sum.reminders[0].remind_date, null, today)} · ${sum.reminders[0].title}` : 'nenhum agendado'} />
        </div>
      )}

      <div className="grid-2 cards summary-grid">
        <Card title="Tarefas de hoje" actions={<Link className="btn sm" to="/diarias">Ver quadro</Link>}>
          {!tasks.data ? <Loading /> : !todayTasks.length ? <Empty>Nenhuma tarefa diária para hoje.</Empty> : (
            <ul className="mini-tasks">
              {todayTasks.map((t) => (
                <li key={t.id} className={t.status === 'done' ? 'done' : ''} onClick={() => openTask(t.id)}>
                  <Pill color={STATUS[t.status].color} className="xs">{STATUS[t.status].label}</Pill>
                  <span className="grow mt-title">
                    <b>{t.scheduled_time ? `${t.scheduled_time.slice(0, 5)} · ` : ''}{t.title}</b>
                    {(t.business_name || t.channel_name) && <BizChannel task={t} inline />}
                  </span>
                  <TimerCell task={t} />
                  {!viewingOther && <TaskButtons task={t} compact />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Lembretes" actions={<label className="check small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> mostrar concluídos</label>}>
          {!viewingOther && <ReminderForm today={today} />}
          {!reminders.data ? <Loading /> : !remList.length ? <Empty>Nenhum lembrete {showDone ? '' : 'pendente'}.</Empty> : (
            <ul className="reminders">
              {remList.map((r) => {
                const late = r.remind_date < today && !['done', 'cancelled'].includes(r.task_status);
                const done = r.task_status === 'done';
                return (
                  <li key={r.id} className={(late ? 'late ' : '') + (done ? 'done' : '')}>
                    <span className="rem-icon"><Icon name="bell" size={16} /></span>
                    <div className="grow">
                      <div className="row gap-s wrap">
                        <b className="rem-title">{r.title}</b>
                        {r.task_status && <Pill color={STATUS[r.task_status].color} className="xs">{STATUS[r.task_status].label}</Pill>}
                        {late && <span className="tag danger">vencido</span>}
                      </div>
                      <small className="muted">{whenLabel(r.remind_date, r.remind_time, today)}
                        {r.business_name ? ` · ${r.business_name}` : ''}{r.channel_name ? ` · ${r.channel_name}` : ''}</small>
                      {r.body && <p className="rem-body">{r.body}</p>}
                    </div>
                    <div className="row gap-s">
                      {r.task_id && <button className="icon-btn sm" title="Abrir a tarefa" onClick={() => openTask(r.task_id)}><Icon name="right" size={14} /></button>}
                      {!viewingOther && !done && <button className="icon-btn sm" title="Editar" onClick={() => setEditing(r)}><Icon name="edit" size={14} /></button>}
                      {!viewingOther && <DeleteNote note={r} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Apontamentos">
        {!viewingOther && <NoteForm />}
        {!notes.data ? <Loading /> : !notes.data.length ? <Empty>Nenhum apontamento ainda.</Empty> : <NotesList notes={notes.data} readOnly={viewingOther} onEdit={setEditing} />}
      </Card>

      {editing && <EditNote note={editing} today={today} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BizChannelSelects({ f, set }) {
  const { businesses, channels } = useApp();
  return (
    <>
      {businesses.length > 0 && (
        <select value={f.business_id || ''} onChange={set('business_id')}>
          <option value="">Empresa (opcional)</option>
          {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      {channels.length > 0 && (
        <select value={f.channel_id || ''} onChange={set('channel_id')}>
          <option value="">Canal (opcional)</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </>
  );
}

function ReminderForm({ today }) {
  const empty = { title: '', body: '', remind_date: today, remind_time: '', business_id: '', channel_id: '', priority: 'medium' };
  const [f, setF] = useState(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.title.trim()) return toast('Informe o assunto do lembrete', 'error');
    setBusy(true);
    try {
      await api('/notes', { method: 'POST', body: { kind: 'reminder', ...f, business_id: f.business_id || null, channel_id: f.channel_id || null, remind_time: f.remind_time || null } });
      emitLocal();
      toast(`Lembrete agendado e tarefa criada para ${f.remind_date === today ? 'hoje' : fmtDate(f.remind_date)}`, 'success');
      setF(empty); setOpen(false);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (!open) return <button className="btn primary sm mb" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Novo lembrete</button>;
  return (
    <div className="inline-form">
      <input autoFocus value={f.title} onChange={set('title')} placeholder="Assunto (vira o nome da tarefa)" onKeyDown={(e) => e.key === 'Enter' && save()} />
      <div className="row gap-s wrap">
        <input type="date" value={f.remind_date} min={today} onChange={set('remind_date')} />
        <input type="time" value={f.remind_time} onChange={set('remind_time')} title="Horário (opcional)" />
        <select value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <BizChannelSelects f={f} set={set} />
      </div>
      <textarea rows={2} value={f.body} onChange={set('body')} placeholder="Detalhes (opcional)" />
      <div className="row gap-s">
        <button className="btn primary sm" disabled={busy} onClick={save}>Agendar lembrete</button>
        <button className="btn sm" onClick={() => { setOpen(false); setF(empty); }}>Cancelar</button>
        <small className="muted">Uma tarefa é criada para você na data do lembrete.</small>
      </div>
    </div>
  );
}

function NoteForm() {
  const empty = { title: '', body: '', business_id: '', channel_id: '' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.body.trim() && !f.title.trim()) return;
    setBusy(true);
    try {
      await api('/notes', { method: 'POST', body: { kind: 'note', ...f, business_id: f.business_id || null, channel_id: f.channel_id || null } });
      emitLocal(); setF(empty);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="inline-form">
      <textarea rows={3} value={f.body} onChange={set('body')} placeholder="Escreva um apontamento: o que fez, o que ficou pendente, uma informação importante…"
        onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && save()} />
      <div className="row gap-s wrap">
        <input className="grow" value={f.title} onChange={set('title')} placeholder="Título (opcional)" />
        <BizChannelSelects f={f} set={set} />
        <button className="btn primary sm" disabled={busy} onClick={save}><Icon name="plus" size={14} /> Registrar</button>
      </div>
    </div>
  );
}

function NotesList({ notes, readOnly, onEdit }) {
  const [q, setQ] = useState('');
  const filtered = notes.filter((n) => !q || `${n.title} ${n.body} ${n.business_name || ''} ${n.channel_name || ''}`.toLowerCase().includes(q.toLowerCase()));
  const pinned = filtered.filter((n) => n.pinned);
  const groups = new Map();
  for (const n of filtered.filter((x) => !x.pinned)) {
    const d = new Date(n.created_at); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  const togglePin = async (n) => { try { await api(`/notes/${n.id}`, { method: 'PATCH', body: { pinned: !n.pinned } }); emitLocal(); } catch (e) { toast(e.message, 'error'); } };
  const item = (n) => (
    <li key={n.id} className={n.pinned ? 'pinned' : ''}>
      <div className="grow">
        {n.title && <b>{n.title}</b>}
        {n.body && <p className="pre">{n.body}</p>}
        <small className="muted">{fmtDateTime(n.created_at)}{n.business_name ? ` · ${n.business_name}` : ''}{n.channel_name ? ` · ${n.channel_name}` : ''}</small>
      </div>
      {!readOnly && (
        <div className="row gap-s note-actions">
          <button className={'icon-btn sm' + (n.pinned ? ' on' : '')} title={n.pinned ? 'Desafixar' : 'Fixar no topo'} onClick={() => togglePin(n)}><Icon name="target" size={14} /></button>
          <button className="icon-btn sm" title="Editar" onClick={() => onEdit(n)}><Icon name="edit" size={14} /></button>
          <DeleteNote note={n} />
        </div>
      )}
    </li>
  );
  return (
    <>
      {notes.length > 5 && <input className="note-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nos apontamentos" />}
      {pinned.length > 0 && <><h4 className="note-day">Fixados</h4><ul className="notes-list">{pinned.map(item)}</ul></>}
      {[...groups.entries()].map(([day, list]) => (
        <div key={day}>
          <h4 className="note-day">{fmtDateLong(day)}</h4>
          <ul className="notes-list">{list.map(item)}</ul>
        </div>
      ))}
      {!filtered.length && <Empty>Nada encontrado.</Empty>}
    </>
  );
}

function DeleteNote({ note }) {
  const del = async () => {
    const msg = note.kind === 'reminder'
      ? 'Excluir este lembrete? A tarefa criada por ele também é removida se ainda não foi iniciada.'
      : 'Excluir este apontamento?';
    if (!confirm(msg)) return;
    try {
      const r = await api(`/notes/${note.id}`, { method: 'DELETE' });
      emitLocal();
      if (note.kind === 'reminder') toast(r.task_removed ? 'Lembrete e tarefa removidos' : 'Lembrete removido; a tarefa já tinha andamento e foi mantida');
    } catch (e) { toast(e.message, 'error'); }
  };
  return <button className="icon-btn sm" title="Excluir" onClick={del}><Icon name="trash" size={14} /></button>;
}

function EditNote({ note, today, onClose }) {
  const isRem = note.kind === 'reminder';
  const [f, setF] = useState({
    title: note.title || '', body: note.body || '', remind_date: note.remind_date || today, remind_time: note.remind_time || '',
    business_id: note.business_id || '', channel_id: note.channel_id || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { title: f.title, body: f.body, business_id: f.business_id || null, channel_id: f.channel_id || null };
    if (isRem) Object.assign(body, { remind_date: f.remind_date, remind_time: f.remind_time || null });
    try { await api(`/notes/${note.id}`, { method: 'PATCH', body }); emitLocal(); toast(isRem ? 'Lembrete e tarefa atualizados' : 'Apontamento atualizado', 'success'); onClose(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={isRem ? 'Editar lembrete' : 'Editar apontamento'} onClose={onClose} footer={<button className="btn primary" onClick={save}>Salvar</button>}>
      <Field label={isRem ? 'Assunto' : 'Título (opcional)'}><input value={f.title} onChange={set('title')} /></Field>
      {isRem && (
        <div className="grid-2">
          <Field label="Data"><input type="date" value={f.remind_date} min={today} onChange={set('remind_date')} /></Field>
          <Field label="Horário (opcional)"><input type="time" value={f.remind_time} onChange={set('remind_time')} /></Field>
        </div>
      )}
      <Field label={isRem ? 'Detalhes' : 'Apontamento'}><textarea rows={4} value={f.body} onChange={set('body')} /></Field>
      <div className="row gap-s wrap"><BizChannelSelects f={f} set={set} /></div>
      {isRem && <small className="muted">A tarefa do lembrete é ajustada junto (nome, data, horário, empresa e canal) enquanto não estiver concluída.</small>}
    </Modal>
  );
}

function NotifyButton() {
  const supported = typeof Notification !== 'undefined';
  const [perm, setPerm] = useState(supported ? Notification.permission : 'unsupported');
  if (!supported || perm === 'granted') return null;
  if (perm === 'denied') return <small className="muted">Avisos do navegador bloqueados</small>;
  return (
    <button className="btn sm" onClick={async () => setPerm(await Notification.requestPermission())}>
      <Icon name="bell" size={14} /> Ativar avisos dos lembretes
    </button>
  );
}
