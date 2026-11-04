import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, toast, emitLocal, onLive, useData, STATUS, PRIORITY, fmtDate, fmtDateLong, fmtDateTime, addDays, parseDate } from '../lib.js';
import { Icon, Card, Loading, Empty, Modal, Field, Pill } from '../ui.jsx';
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
          <p className="muted">Bloco de notas de {fmtDateLong(day)}{day === me.today && ' · hoje'}{viewingOther && ' · somente leitura'}</p>
        </div>
        <div className="row gap wrap">
          {isAdmin && (
            <select value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Meu bloco de notas</option>
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
        onReminder={(text) => setRemPrefill({ title: text, at: Date.now() })} />

      <Reminders viewingOther={viewingOther} user={user} prefill={remPrefill} />
    </div>
  );
}

// ---------- bloco de notas + resumo por IA ----------
function Notebook({ day, user, onDay, onReminder }) {
  const [state, setState] = useState(null);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('idle'); // idle | dirty | saving | saved | error
  const [savedAt, setSavedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const ta = useRef(null);
  const timer = useRef(null);
  const latest = useRef('');
  const uq = user ? `&user=${user}` : '';

  const load = useCallback(async (keepText) => {
    try {
      const d = await api(`/notepad?date=${day}${uq}`);
      setState(d);
      if (!keepText) { setContent(d.pad.content); latest.current = d.pad.content; }
    } catch (e) { toast(e.message, 'error'); }
  }, [day, uq]);
  useEffect(() => { load(false); }, [load]);
  // atualizações de outras telas (ex.: resumo automático) sem apagar o que está sendo digitado
  useEffect(() => onLive(() => load(!user)), [load, user]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const text = latest.current;
    setStatus('saving');
    try {
      const r = await api(`/notepad/${day}`, { method: 'PUT', body: { content: text } });
      setSavedAt(r.updated_at);
      setStatus(latest.current === text ? 'saved' : 'dirty');
    } catch (e) { setStatus('error'); toast(e.message, 'error'); }
  }, [day]);

  const onChange = (v) => {
    setContent(v); latest.current = v; setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 1200);
  };
  // salva ao sair da tela ou trocar de dia
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); api(`/notepad/${day}`, { method: 'PUT', body: { content: latest.current } }).catch(() => {}); } }, [day]);
  useEffect(() => {
    const warn = (e) => { if (status === 'dirty' || status === 'saving') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  const insertAtCursor = (text) => {
    const el = ta.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const before = content.slice(0, s);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const v = before + prefix + text + content.slice(e);
    onChange(v);
    requestAnimationFrame(() => { el.focus(); const pos = s + prefix.length + text.length; el.setSelectionRange(pos, pos); });
  };
  const stamp = () => { const d = new Date(); insertAtCursor(`${pad2(d.getHours())}:${pad2(d.getMinutes())} `); };
  const selectionToReminder = () => {
    const el = ta.current; if (!el) return;
    const sel = content.slice(el.selectionStart, el.selectionEnd).trim();
    if (!sel) return toast('Selecione no bloco de notas o trecho que vira lembrete', 'error');
    onReminder(sel.replace(/\s+/g, ' ').slice(0, 300));
  };

  const summarize = async () => {
    if (status === 'dirty') await save();
    setBusy(true);
    try { await api(`/notepad/${day}/summarize${user ? `?user=${user}` : ''}`, { method: 'POST' }); await load(true); toast('Resumo organizado', 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (!state) return <Loading />;
  const ro = state.readonly;
  const pad = state.pad;
  const outdated = pad.summary && pad.updated_at && pad.summary_at && new Date(pad.updated_at) > new Date(pad.summary_at);
  const saveLabel = { idle: '', dirty: 'Alterações não salvas…', saving: 'Salvando…', saved: savedAt ? `Salvo às ${fmtDateTime(savedAt).slice(6)}` : 'Salvo', error: 'Erro ao salvar' }[status];

  return (
    <div className="nb-grid">
      <Card className="nb-card" title="Bloco de notas" actions={!ro && <>
        <button className="btn sm" onClick={stamp} title="Inserir o horário atual"><Icon name="clock" size={14} /> Horário</button>
        <button className="btn sm" onClick={selectionToReminder} title="Transforma o trecho selecionado em lembrete (cria uma tarefa na data)"><Icon name="bell" size={14} /> Seleção → lembrete</button>
      </>}>
        <textarea ref={ta} className="notebook" value={content} readOnly={ro} onChange={(e) => onChange(e.target.value)} onBlur={() => status === 'dirty' && save()}
          placeholder={ro ? 'Sem anotações neste dia.' : 'Anote tudo aqui ao longo do dia, do jeito que vier: o que fez, números, combinados, problemas, ideias…\nNo fim do dia a IA organiza tudo num resumo.'} />
        <div className="nb-foot">
          <small className={status === 'error' ? 'danger-text' : 'muted'}>{ro ? 'Somente leitura' : saveLabel}</small>
          <small className="muted">{content.length.toLocaleString('pt-BR')} caracteres</small>
        </div>
      </Card>

      <div className="nb-side">
        <Card title="Resumo organizado pela IA" actions={!ro || state.ai ? (
          <button className="btn sm primary" disabled={busy || !state.ai || !content.trim()} onClick={summarize}>
            <Icon name="repeat" size={14} /> {busy ? 'Organizando…' : pad.summary ? 'Atualizar' : 'Organizar agora'}
          </button>) : null}>
          {!state.ai && <div className="warn-box">A IA ainda não está configurada no servidor. Peça ao administrador para adicionar a chave <b>ANTHROPIC_API_KEY</b> no Render.</div>}
          {pad.summary ? <AiSummary s={pad.summary} /> : (
            <Empty>{content.trim() ? 'Ainda sem resumo. Ele é gerado automaticamente no fim da jornada, ou clique em “Organizar agora”.' : 'Sem anotações para resumir neste dia.'}</Empty>
          )}
          {pad.summary_at && <small className="muted block-mt">Gerado em {fmtDateTime(pad.summary_at)}{outdated && ' · as anotações mudaram depois disso'}</small>}
          {pad.summary_error && !pad.summary && <small className="danger-text block-mt">{pad.summary_error}</small>}
        </Card>

        {state.days.length > 0 && (
          <Card title="Dias com anotações">
            <div className="day-chips">
              {state.days.map((d) => (
                <button key={d.day} className={'day-chip' + (d.day === day ? ' on' : '')} onClick={() => onDay(d.day)} title={`${d.chars} caracteres`}>
                  {fmtDate(d.day)}{d.has_summary && <Icon name="check" size={12} />}
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
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
    <Card title="Lembretes" actions={<>
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
