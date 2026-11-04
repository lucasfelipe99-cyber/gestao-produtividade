import React, { useState } from 'react';
import { api, toast, emitLocal, useData, STATUS, PRIORITY, fmtDate, fmtDateLong, fmtDateTime, addDays, parseDate } from '../lib.js';
import { Icon, Card, Loading, Empty, Modal, Field, Pill, Avatar } from '../ui.jsx';
import { useApp } from '../App.jsx';

const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const pad2 = (n) => String(n).padStart(2, '0');
function whenLabel(date, time, today) {
  const d = date === today ? 'Hoje' : date === addDays(today, 1) ? 'Amanhã' : `${WD[parseDate(date).getDay()]}, ${fmtDate(date)}`;
  return time ? `${d} às ${time}` : d;
}

export default function Summary() {
  const { me, isAdmin, activeUsers } = useApp();
  const [user, setUser] = useState('');
  const [day, setDay] = useState(me.today);
  const [remPrefill, setRemPrefill] = useState(null);
  const viewingOther = isAdmin && user && Number(user) !== me.id;
  const name = viewingOther ? activeUsers.find((u) => u.id === Number(user))?.name : me.name.split(' ')[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Resumo · {name}</h1>
          <p className="muted">Lançamentos de {fmtDateLong(day)}{day === me.today && ' · hoje'}{viewingOther && ' · somente leitura'}</p>
        </div>
        <div className="row gap wrap">
          {isAdmin && (
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Meus lançamentos</option>
              {activeUsers.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <div className="date-nav">
            <button className="icon-btn" onClick={() => setDay(addDays(day, -1))}><Icon name="left" /></button>
            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            <button className="icon-btn" onClick={() => setDay(addDays(day, 1))}><Icon name="right" /></button>
            {day !== me.today && <button className="btn sm" onClick={() => setDay(me.today)}>Hoje</button>}
          </div>
        </div>
      </div>

      <Notebook key={`${user}-${day}`} day={day} user={viewingOther ? user : ''} onDay={setDay}
        onReminder={(text) => { setRemPrefill({ title: text, at: Date.now() }); setTimeout(() => document.querySelector('.reminders-card')?.scrollIntoView({ behavior: 'smooth' }), 50); }} />

      <Reminders viewingOther={viewingOther} user={user} prefill={remPrefill} />
    </div>
  );
}

// ---------- lançamentos do dia (estilo atualizações do Monday) + resumo por IA ----------
function hm(iso) { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function Notebook({ day, user, onDay, onReminder }) {
  const { me, users } = useApp();
  const uq = user ? `&user=${user}` : '';
  const { data: state, reload } = useData(`/notepad?date=${day}${uq}`, [day, user]);
  const [busy, setBusy] = useState(false);
  if (!state) return <Loading />;
  const ro = state.readonly;
  const pad = state.pad;
  const owner = user ? users.find((u) => u.id === Number(user)) : me;
  const outdated = pad.summary && pad.updated_at && pad.summary_at && new Date(pad.updated_at) > new Date(pad.summary_at);
  const isToday = day === state.today;

  const summarize = async () => {
    setBusy(true);
    try { await api(`/notepad/${day}/summarize${user ? `?user=${user}` : ''}`, { method: 'POST' }); await reload(); toast('Resumo organizado', 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="nb-grid">
      <Card className="nb-card" title={`Lançamentos ${isToday ? 'de hoje' : 'do dia'}`} actions={<small className="muted">{state.entries.length} lançamento(s)</small>}>
        {!ro && (isToday ? <Composer /> : <div className="warn-box mb">Novos lançamentos entram sempre no dia de hoje. <button className="link" onClick={() => onDay(state.today)}>Ir para hoje</button></div>)}
        {!state.entries.length ? <Empty>{ro ? 'Nenhum lançamento neste dia.' : isToday ? 'Nenhum lançamento ainda. Escreva o primeiro acima.' : 'Nenhum lançamento neste dia.'}</Empty> : (
          <ul className="updates">
            {state.entries.map((e) => <Entry key={e.id} e={e} owner={owner} readonly={ro} onReminder={onReminder} />)}
          </ul>
        )}
      </Card>

      <div className="nb-side">
        <Card title="Resumo do dia pela IA" actions={(
          <button className="btn sm primary" disabled={busy || !state.ai || !state.entries.length} onClick={summarize}>
            <Icon name="repeat" size={14} /> {busy ? 'Organizando…' : pad.summary ? 'Atualizar' : 'Organizar agora'}
          </button>)}>
          {!state.ai && <div className="warn-box">A IA ainda não está configurada no servidor. É preciso adicionar a chave <b>ANTHROPIC_API_KEY</b> no Render.</div>}
          {pad.summary ? <AiSummary s={pad.summary} /> : (
            <Empty>{state.entries.length ? 'Ainda sem resumo. Ele é gerado automaticamente no fim da jornada, ou clique em “Organizar agora”.' : 'Sem lançamentos para resumir neste dia.'}</Empty>
          )}
          {pad.summary_at && <small className="muted block-mt">Gerado em {fmtDateTime(pad.summary_at)}{outdated && ' · houve lançamentos depois disso'}</small>}
          {pad.summary_error && !pad.summary && <small className="danger-text block-mt">{pad.summary_error}</small>}
        </Card>

        {state.days.length > 0 && (
          <Card title="Dias com lançamentos">
            <div className="day-chips">
              {state.days.map((d) => (
                <button key={d.day} className={'day-chip' + (d.day === day ? ' on' : '')} onClick={() => onDay(d.day)} title={`${d.entries} lançamento(s)`}>
                  {fmtDate(d.day)} <span className="chip-count">{d.entries}</span>{d.has_summary && <Icon name="check" size={12} />}
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Composer() {
  const empty = { body: '', business_id: '', channel_id: '' };
  const [f, setF] = useState(empty);
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const post = async () => {
    if (!f.body.trim()) return;
    setBusy(true);
    try {
      await api('/notes', { method: 'POST', body: { kind: 'note', body: f.body.trim(), business_id: f.business_id || null, channel_id: f.channel_id || null } });
      emitLocal(); setF({ ...empty, business_id: f.business_id, channel_id: f.channel_id });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const open = focus || f.body;
  return (
    <div className={'composer' + (open ? ' open' : '')}>
      <textarea rows={open ? 3 : 1} value={f.body} onChange={set('body')} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        placeholder="Escreva uma atualização…" onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && post()} />
      {open && (
        <div className="row gap-s wrap">
          <BizChannelSelects f={f} set={set} />
          <span className="grow" />
          <small className="muted hide-sm">Ctrl + Enter publica</small>
          <button className="btn primary sm" disabled={busy || !f.body.trim()} onMouseDown={(e) => e.preventDefault()} onClick={post}>Publicar</button>
        </div>
      )}
    </div>
  );
}

function Entry({ e, owner, readonly, onReminder }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ body: e.body, business_id: e.business_id || '', channel_id: e.channel_id || '' });
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  const edited = new Date(e.updated_at) - new Date(e.created_at) > 60000;
  const save = async () => {
    if (!f.body.trim()) return toast('O lançamento não pode ficar vazio', 'error');
    try { await api(`/notes/${e.id}`, { method: 'PATCH', body: { body: f.body.trim(), business_id: f.business_id || null, channel_id: f.channel_id || null } }); emitLocal(); setEditing(false); }
    catch (err) { toast(err.message, 'error'); }
  };
  const del = async () => {
    if (!confirm('Excluir este lançamento?')) return;
    try { await api(`/notes/${e.id}`, { method: 'DELETE' }); emitLocal(); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <li className="update">
      <Avatar name={owner?.name} id={owner?.id} size={32} />
      <div className="grow">
        <div className="update-head">
          <b>{owner?.name}</b>
          <span className="muted">{hm(e.created_at)}{edited && ' · editado'}</span>
          {e.business_name && <span className="cat small"><i style={{ background: e.business_color }} />{e.business_name}</span>}
          {e.channel_name && <span className="chan" style={{ background: e.channel_color }}>{e.channel_name}</span>}
          <span className="grow" />
          {!readonly && !editing && (
            <span className="update-actions">
              <button className="icon-btn sm" title="Virar lembrete para revisar" onClick={() => onReminder(e.body.replace(/\s+/g, ' ').slice(0, 300))}><Icon name="bell" size={14} /></button>
              <button className="icon-btn sm" title="Editar" onClick={() => setEditing(true)}><Icon name="edit" size={14} /></button>
              <button className="icon-btn sm" title="Excluir" onClick={del}><Icon name="trash" size={14} /></button>
            </span>
          )}
        </div>
        {editing ? (
          <div className="inline-form" style={{ marginTop: 6 }}>
            <textarea rows={3} value={f.body} onChange={set('body')} autoFocus />
            <div className="row gap-s wrap">
              <BizChannelSelects f={f} set={set} />
              <span className="grow" />
              <button className="btn sm" onClick={() => setEditing(false)}>Cancelar</button>
              <button className="btn primary sm" onClick={save}>Salvar</button>
            </div>
          </div>
        ) : <p className="update-body">{e.body}</p>}
      </div>
    </li>
  );
}

function AiSummary({ s }) {
  const list = (title, items, cls = '') => items?.length > 0 && (
    <div className={'ai-sec ' + cls}><h4>{title}</h4><ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
  );
  return (
    <div className="ai-summary">
      {s.resumo && <p className="ai-lead">{s.resumo}</p>}
      {s.por_empresa?.length > 0 && (
        <div className="ai-sec">
          <h4>Por empresa e canal</h4>
          {s.por_empresa.map((g, i) => (
            <div key={i} className="ai-group">
              <b>{g.empresa}{g.canal ? ` · ${g.canal}` : ''}</b>
              <ul>{g.itens.map((t, j) => <li key={j}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {list('Feito', s.feito, 'ok')}
      {list('Pendências e próximos passos', s.pendencias, 'warn')}
      {list('Problemas e bloqueios', s.problemas, 'bad')}
      {list('Números citados', s.dados)}
      {list('Outros', s.outros)}
    </div>
  );
}

// ---------- lembretes (cada um cria uma tarefa para revisar na data) ----------
function Reminders({ viewingOther, user, prefill }) {
  const { me } = useApp();
  const today = me.today;
  const reminders = useData(`/notes?kind=reminder${viewingOther ? `&user=${user}` : ''}`);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null);
  const { openTask } = useApp();
  const remList = (reminders.data || []).filter((r) => showDone || !['done', 'cancelled'].includes(r.task_status));
  return (
    <Card className="reminders-card" title="Lembretes" actions={<>
      {!viewingOther && <NotifyButton />}
      <label className="check small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> mostrar concluídos</label>
    </>}>
      {!viewingOther && <ReminderForm key={prefill?.at || 'novo'} today={today} prefill={prefill} />}
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
                  {!viewingOther && <DeleteReminder note={r} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <EditReminder note={editing} today={today} onClose={() => setEditing(null)} />}
    </Card>
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

function ReminderForm({ today, prefill }) {
  const empty = { title: '', body: '', remind_date: addDays(today, 1), remind_time: '', business_id: '', channel_id: '', priority: 'medium' };
  const [f, setF] = useState(prefill ? { ...empty, title: prefill.title } : empty);
  const [open, setOpen] = useState(!!prefill);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.title.trim()) return toast('Informe o que precisa revisar', 'error');
    setBusy(true);
    try {
      await api('/notes', { method: 'POST', body: { kind: 'reminder', ...f, business_id: f.business_id || null, channel_id: f.channel_id || null, remind_time: f.remind_time || null } });
      emitLocal();
      toast(`Lembrete agendado e tarefa criada para ${f.remind_date === today ? 'hoje' : fmtDate(f.remind_date)}`, 'success');
      setF(empty); setOpen(false);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (!open) return <button className="btn primary sm mb" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> Novo lembrete para revisar</button>;
  return (
    <div className="inline-form">
      <input autoFocus value={f.title} onChange={set('title')} placeholder="O que precisa revisar (vira o nome da tarefa)" onKeyDown={(e) => e.key === 'Enter' && save()} />
      <div className="row gap-s wrap">
        <input type="date" value={f.remind_date} min={today} onChange={set('remind_date')} />
        <input type="time" value={f.remind_time} onChange={set('remind_time')} title="Horário (opcional)" />
        <select value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <BizChannelSelects f={f} set={set} />
      </div>
      <textarea rows={2} value={f.body} onChange={set('body')} placeholder="Detalhes (opcional)" />
      <div className="row gap-s wrap">
        <button className="btn primary sm" disabled={busy} onClick={save}>Agendar lembrete</button>
        <button className="btn sm" onClick={() => { setOpen(false); setF(empty); }}>Cancelar</button>
        <small className="muted">Na data escolhida aparece uma tarefa para você revisar.</small>
      </div>
    </div>
  );
}

function DeleteReminder({ note }) {
  const del = async () => {
    if (!confirm('Excluir este lembrete? A tarefa criada por ele também é removida se ainda não foi iniciada.')) return;
    try {
      const r = await api(`/notes/${note.id}`, { method: 'DELETE' });
      emitLocal();
      toast(r.task_removed ? 'Lembrete e tarefa removidos' : 'Lembrete removido; a tarefa já tinha andamento e foi mantida');
    } catch (e) { toast(e.message, 'error'); }
  };
  return <button className="icon-btn sm" title="Excluir" onClick={del}><Icon name="trash" size={14} /></button>;
}

function EditReminder({ note, today, onClose }) {
  const [f, setF] = useState({
    title: note.title || '', body: note.body || '', remind_date: note.remind_date || today, remind_time: note.remind_time || '',
    business_id: note.business_id || '', channel_id: note.channel_id || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      await api(`/notes/${note.id}`, { method: 'PATCH', body: { ...f, business_id: f.business_id || null, channel_id: f.channel_id || null, remind_time: f.remind_time || null } });
      emitLocal(); toast('Lembrete e tarefa atualizados', 'success'); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Editar lembrete" onClose={onClose} footer={<button className="btn primary" onClick={save}>Salvar</button>}>
      <Field label="O que precisa revisar"><input value={f.title} onChange={set('title')} /></Field>
      <div className="grid-2">
        <Field label="Data"><input type="date" value={f.remind_date} min={today} onChange={set('remind_date')} /></Field>
        <Field label="Horário (opcional)"><input type="time" value={f.remind_time} onChange={set('remind_time')} /></Field>
      </div>
      <Field label="Detalhes"><textarea rows={3} value={f.body} onChange={set('body')} /></Field>
      <div className="row gap-s wrap"><BizChannelSelects f={f} set={set} /></div>
      <small className="muted">A tarefa do lembrete é ajustada junto enquanto não estiver concluída.</small>
    </Modal>
  );
}

function NotifyButton() {
  const supported = typeof Notification !== 'undefined';
  const [perm, setPerm] = useState(supported ? Notification.permission : 'unsupported');
  if (!supported || perm === 'granted' || perm === 'denied') return null;
  return (
    <button className="btn sm" onClick={async () => setPerm(await Notification.requestPermission())}>
      <Icon name="bell" size={14} /> Ativar avisos
    </button>
  );
}
