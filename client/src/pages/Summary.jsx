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
  const [tab, setTab] = useState('done');
  const [user, setUser] = useState('');
  const [day, setDay] = useState(me.today);
  const [by, setBy] = useState(() => { try { return localStorage.getItem('summaryBy') || 'client'; } catch { return 'client'; } });
  const [remPrefill, setRemPrefill] = useState(null);
  const chooseBy = (v) => { setBy(v); try { localStorage.setItem('summaryBy', v); } catch { /* */ } };
  const viewingOther = isAdmin && user && Number(user) !== me.id;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Resumo</h1>
          <p className="muted">{tab === 'done' ? <>O que foi realizado em {fmtDateLong(day)}{day === me.today && ' · hoje'}, por cliente e colaborador</> : 'Lembretes para revisar: viram tarefa na data do lembrete'}</p>
        </div>
        <div className="row gap wrap">
          <div className="mini-seg big">
            <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Realizado</button>
            <button className={tab === 'rem' ? 'on' : ''} onClick={() => setTab('rem')}>Lembretes</button>
          </div>
          {isAdmin && (
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">{tab === 'done' ? 'Toda a equipe' : 'Meus lembretes'}</option>
              {activeUsers.filter((u) => tab === 'done' || u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {tab === 'done' && (
            <div className="date-nav">
              <button className="icon-btn" onClick={() => setDay(addDays(day, -1))}><Icon name="left" /></button>
              <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
              <button className="icon-btn" onClick={() => setDay(addDays(day, 1))}><Icon name="right" /></button>
              {day !== me.today && <button className="btn sm" onClick={() => setDay(me.today)}>Hoje</button>}
            </div>
          )}
        </div>
      </div>

      {tab === 'done' ? (
        <DayDone day={day} user={user} by={by} setBy={chooseBy}
          onReminder={(text) => { setRemPrefill({ title: text, at: Date.now() }); setTab('rem'); }} />
      ) : (
        <Reminders viewingOther={viewingOther} user={user} prefill={remPrefill} />
      )}
    </div>
  );
}

// ---------- realizado no dia: tarefas concluídas, checklist de SKU e apontamentos, por cliente e colaborador ----------
function hm(iso) { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
const CHECK_LABEL = { fotos: 'Fotos', videos: 'Vídeos', anuncio: 'Anúncio', ads: 'ADS', afiliados: 'Afiliados' };
const KIND_LABEL = { daily: 'Diária', weekly: 'Semanal', oneoff: 'Pontual' };
const fmtSecs = (s) => { const m = Math.round((s || 0) / 60); return m ? (m >= 60 ? `${Math.floor(m / 60)}h${pad2(m % 60)}` : `${m} min`) : ''; };

function DayDone({ day, user, by, setBy, onReminder }) {
  const { me, businesses, openTask } = useApp();
  const { data } = useData(`/day-done?date=${day}${user ? `&user=${user}` : ''}`);
  if (!data) return <Loading />;
  const isToday = day === data.today;
  const canWrite = isToday && (!user || Number(user) === me.id);

  // junta tudo numa lista de linhas com cliente e colaborador
  const rows = [
    ...data.tasks.map((t) => ({ type: 'task', key: 't' + t.id, at: t.completed_at, biz: t.business_id, uid: t.user_id, uname: t.user_name, t })),
    ...data.checks.map((c) => ({ type: 'check', key: `c${c.item_id}-${c.listing_id}-${c.user_id}`, at: c.at, biz: c.business_id, uid: c.user_id, uname: c.user_name, c })),
    ...data.notes.map((n) => ({ type: 'note', key: 'n' + n.id, at: n.created_at, biz: n.business_id, uid: n.user_id, uname: n.user_name, n })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  const bizOf = (id) => businesses.find((b) => b.id === id) || { id: 0, name: 'Sem cliente', color: '#c4c4c4' };
  const outer = by === 'client'
    ? (r) => { const b = bizOf(r.biz); return [b.id, b.name, b.color]; }
    : (r) => [r.uid || 0, r.uname || 'Sem responsável', null];
  // por cliente: o que foi feito nas tarefas em grupo fica direto no cliente, sem separar por colaborador
  const inner = by === 'client'
    ? (r) => (r.type === 'check' ? ['group', 'Tarefas em grupo', 'group'] : [r.uid || 0, r.uname || 'Sem responsável'])
    : (r) => { const b = bizOf(r.biz); return [b.id, b.name, b.color]; };
  const groups = [];
  for (const r of rows) {
    const [k, name, color] = outer(r);
    let g = groups.find((x) => x.k === k);
    if (!g) groups.push((g = { k, name, color, subs: [] }));
    const [ik, iname, icolor] = inner(r);
    let sub = g.subs.find((x) => x.k === ik);
    if (!sub) g.subs.push((sub = { k: ik, name: iname, color: icolor, rows: [] }));
    sub.rows.push(r);
  }
  for (const g of groups) g.subs.sort((a, b) => (b.k === 'group') - (a.k === 'group'));
  // clientes na ordem do cadastro, "Sem cliente" no fim; colaboradores em ordem alfabética
  if (by === 'client') groups.sort((a, b) => (a.k === 0) - (b.k === 0) || businesses.findIndex((x) => x.id === a.k) - businesses.findIndex((x) => x.id === b.k));
  else groups.sort((a, b) => a.name.localeCompare(b.name));
  const count = (type) => rows.filter((r) => r.type === type).length;

  return (
    <div>
      {canWrite && <Composer />}
      <div className="row gap wrap" style={{ margin: '4px 0 12px' }}>
        <div className="mini-seg">
          <button className={by === 'client' ? 'on' : ''} onClick={() => setBy('client')}>Por cliente</button>
          <button className={by === 'user' ? 'on' : ''} onClick={() => setBy('user')}>Por colaborador</button>
        </div>
        <span className="muted small"><b>{count('task')}</b> tarefa(s) concluída(s) · <b>{count('check')}</b> anúncio(s) com checklist · <b>{count('note')}</b> apontamento(s)</span>
      </div>
      {!rows.length ? <Empty>Nada realizado {isToday ? 'ainda hoje' : 'neste dia'}{user ? ' por este colaborador' : ''}.</Empty> : (
        <div className="done-groups">
          {groups.map((g) => (
            <div key={g.k} className="done-group" style={{ '--c': g.color || '#0073ea' }}>
              <h3>{g.color ? <i /> : <Avatar name={g.name} id={g.k} size={24} />}{g.name}<small>{g.subs.reduce((a, s) => a + s.rows.length, 0)} registro(s)</small></h3>
              {g.subs.map((sub) => (
                <div key={sub.k} className="done-sub">
                  <div className="done-sub-head">
                    {sub.color === 'group' ? <b className="grp-sub">▦ {sub.name}</b>
                      : sub.color ? <span className="cat small"><i style={{ background: sub.color }} />{sub.name}</span> : <><Avatar name={sub.name} id={sub.k} size={22} /><b>{sub.name}</b></>}
                    <small className="muted">{sub.rows.length}</small>
                  </div>
                  <ul className="done-list">
                    {sub.rows.map((r) => <DoneRow key={r.key} r={r} me={me} openTask={openTask} onReminder={onReminder} />)}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DoneRow({ r, me, openTask, onReminder }) {
  if (r.type === 'task') {
    const t = r.t;
    return (
      <li className="done-row" onClick={() => openTask(t.id)} title="Abrir tarefa">
        <span className="done-ico ok">✓</span>
        <span className="grow"><b>{t.title}</b> <span className="tag kind">{KIND_LABEL[t.kind] || ''}</span>
          {t.channel_name && <span className="chan" style={{ background: t.channel_color }}>{t.channel_name}</span>}</span>
        {fmtSecs(t.tracked_seconds) && <small className="muted">{fmtSecs(t.tracked_seconds)}</small>}
      </li>
    );
  }
  if (r.type === 'check') {
    const c = r.c;
    return (
      <li className="done-row">
        <span className="done-ico sku">▦</span>
        <span className="grow"><b className="sku">{c.sku || c.description || 'Item'}</b>
          {c.channel_name && <span className="chan" style={{ background: c.channel_color, marginLeft: 6 }}>{c.channel_name}</span>}
          {(c.code || c.link) && <span className="muted"> {c.link ? <a href={c.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{c.code || 'anúncio'}</a> : c.code}</span>}
          {' '}— {c.keys.map((k) => CHECK_LABEL[k] || k).join(', ')}{c.item_done && <span className="tag ok" style={{ marginLeft: 6 }}>SKU completo</span>}
          <small className="muted"> · {c.group_title}</small></span>
      </li>
    );
  }
  const n = r.n;
  return <NoteRow n={n} mine={n.user_id === me.id} onReminder={onReminder} />;
}

function NoteRow({ n, mine, onReminder }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(n.body);
  const save = async () => {
    if (!body.trim()) return toast('O apontamento não pode ficar vazio', 'error');
    try { await api(`/notes/${n.id}`, { method: 'PATCH', body: { body: body.trim() } }); emitLocal(); setEditing(false); } catch (e) { toast(e.message, 'error'); }
  };
  const del = async () => { if (confirm('Excluir este apontamento?')) { try { await api(`/notes/${n.id}`, { method: 'DELETE' }); emitLocal(); } catch (e) { toast(e.message, 'error'); } } };
  return (
    <li className="done-row note">
      <span className="done-ico note">✎</span>
      <span className="grow">
        {editing ? (
          <span className="inline-form"><textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
            <span className="row gap-s"><span className="grow" /><button className="btn sm" onClick={() => setEditing(false)}>Cancelar</button><button className="btn primary sm" onClick={save}>Salvar</button></span></span>
        ) : <span className="update-body">{n.body}</span>}
        {n.channel_name && !editing && <span className="chan" style={{ background: n.channel_color, marginLeft: 6 }}>{n.channel_name}</span>}
      </span>
      {mine && !editing && (
        <span className="update-actions">
          <button className="icon-btn sm" title="Virar lembrete para revisar" onClick={() => onReminder(n.body.replace(/\s+/g, ' ').slice(0, 300))}><Icon name="bell" size={14} /></button>
          <button className="icon-btn sm" title="Editar" onClick={() => setEditing(true)}><Icon name="edit" size={14} /></button>
          <button className="icon-btn sm" title="Excluir" onClick={del}><Icon name="trash" size={14} /></button>
        </span>
      )}
    </li>
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
        placeholder="Registre o que você fez (escolha o cliente para aparecer no resumo dele)…" onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && post()} />
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
