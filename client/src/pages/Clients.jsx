import React, { useState } from 'react';
import { api, toast, emitLocal, useData, fmtDate } from '../lib.js';
import { Icon, Avatar, Loading, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';

const pad2 = (n) => String(n).padStart(2, '0');
const when = (iso) => {
  const d = new Date(iso), now = new Date();
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `hoje ${hm}`;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${hm}`;
};
const ago = (iso) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `há ${Math.max(1, m)} min`;
  if (m < 1440) return `há ${Math.round(m / 60)} h`;
  return `há ${Math.round(m / 1440)} d`;
};

// Aba Clientes: mural de comentários. O quadro de acompanhamento fica na aba própria (Acompanhamento).
export default function Clients() { return <ClientWall tabs={null} />; }
export function Acompanhamento() { return <ClientBoard tabs={null} />; }

const PRIO = { alta: ['Prioridade alta', 'p-alta'], media: ['Prioridade média', 'p-media'], baixa: ['Prioridade baixa', 'p-baixa'] };
function EditCell({ value, onSave, placeholder, strong }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value || '');
  if (editing) {
    return (
      <textarea className="board-edit" autoFocus rows={3} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
        onBlur={async () => { setEditing(false); if ((v || '') !== (value || '')) await onSave(v); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setV(value || ''); setEditing(false); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.blur(); }} />
    );
  }
  return (
    <div className={'board-cell' + (value ? '' : ' blank') + (strong ? ' strong' : '')} onClick={() => { setV(value || ''); setEditing(true); }} title="Clique para editar">
      {value || <span className="muted">{placeholder}</span>}
    </div>
  );
}
function BoardList({ items, empty }) {
  if (!items?.length) return <span className="muted board-none">{empty}</span>;
  return <ul className="board-list">{items.map((t, k) => <li key={k}>{t}</li>)}</ul>;
}
function ClientBoard({ tabs }) {
  const { data } = useData('/client-board');
  const [hideEmpty, setHideEmpty] = useState(true);
  if (!data) return <div className="page"><Loading /></div>;
  const save = async (id, body) => { try { await api(`/client-board/${id}`, { method: 'PUT', body }); emitLocal(); } catch (e) { toast(e.message, 'error'); } };
  const saveFoco = async (foco) => { try { await api('/client-board-foco', { method: 'PUT', body: { foco } }); emitLocal(); } catch (e) { toast(e.message, 'error'); } };
  const rows = data.rows.filter((r) => !hideEmpty || !r.empty);
  const gen = new Date(data.generated_at);
  const printPdf = () => {
    const t = document.title; document.title = `Acompanhamento de Clientes ${gen.toLocaleDateString('pt-BR').replace(/\//g, '-')}`;
    document.body.classList.add('printing-board');
    setTimeout(() => { window.print(); document.title = t; document.body.classList.remove('printing-board'); }, 50);
  };
  return (
    <div className="page client-board-page">
      <div className="page-head no-print">
        <div>
          <h1>Acompanhamento de clientes</h1>
          <p className="muted">Montado automaticamente com os dados do sistema: tarefas, SKUs, curva ABC, mural de comentários e lembretes de cada cliente. Atualiza sozinho.</p>
        </div>
        <div className="row gap wrap">{tabs}</div>
      </div>
      <div className="board-sheet">
        <div className="row gap" style={{ alignItems: 'flex-end' }}>
          <div className="grow">
            <h2 className="board-title">Acompanhamento de Clientes – Resumo</h2>
            <p className="muted board-sub">Atualizado em {gen.toLocaleDateString('pt-BR')} às {gen.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              {data.last_activity && ` · última atividade ${new Date(data.last_activity).toLocaleDateString('pt-BR')}`}</p>
          </div>
          <label className="check small no-print"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> esconder clientes sem atividade</label>
          <button className="btn sm primary no-print" onClick={printPdf}><Icon name="download" size={14} /> Baixar PDF</button>
        </div>
        <table className="board-table">
          <thead><tr><th style={{ width: '16%' }}>Cliente</th><th style={{ width: '30%' }}>Situação atual</th><th style={{ width: '29%' }}>Principais pontos</th><th>Próximo passo</th></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={4} className="muted">Nenhum cliente com atividade ainda.</td></tr>}
            {rows.map((r) => (
              <tr key={r.business_id}>
                <td>
                  <b className="board-client"><i style={{ background: r.color }} />{r.name}</b>
                  <select className={'prio-select ' + (PRIO[r.prioridade]?.[1] || 'p-none')} value={r.prioridade || ''} onChange={(e) => save(r.business_id, { prioridade: e.target.value || null })}>
                    <option value="">+ prioridade</option><option value="alta">Prioridade alta</option><option value="media">Prioridade média</option><option value="baixa">Prioridade baixa</option>
                  </select>
                </td>
                <td><BoardList items={r.situacao} empty="Sem atividade registrada" /></td>
                <td><BoardList items={r.pontos} empty="Sem comentários ou pendências — registre no mural (aba Clientes)" /></td>
                <td><BoardList items={r.proximo} empty="Sem tarefas ou lembretes futuros cadastrados" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="board-foco">
          <b>Foco das próximas semanas:</b>
          <EditCell value={data.foco} placeholder="Escreva o foco das próximas semanas…" onSave={saveFoco} />
        </div>
        <p className="muted small no-print board-help">
          De onde vêm os dados: <b>Situação</b> = tarefas concluídas nos últimos 7 dias, tarefas em aberto e não realizadas, andamento da Gestão de SKU e faturamento da curva ABC ·
          <b> Principais pontos</b> = última reunião/comentário do cliente na aba Clientes (o fixado vem primeiro), pendências e o que foi feito ·
          <b> Próximo passo</b> = próximas tarefas com prazo (semanais, pontuais e enviadas) e lembretes do cliente.
        </p>
      </div>
    </div>
  );
}

// Mural de clientes: comentários gerais e pontos das reuniões de time, por empresa
function ClientWall({ tabs }) {
  const { businesses } = useApp();
  const [sel, setSel] = useState(() => { try { return localStorage.getItem('clientSel') || 'all'; } catch { return 'all'; } });
  const [onlyMeetings, setOnlyMeetings] = useState(false);
  const [search, setSearch] = useState('');
  const choose = (v) => { setSel(v); try { localStorage.setItem('clientSel', v); } catch { /* */ } };
  const summary = useData('/client-posts/summary');
  const { data } = useData(`/client-posts?business=${sel}${onlyMeetings ? '&kind=meeting' : ''}${search.trim() ? '&q=' + encodeURIComponent(search.trim()) : ''}`);
  const stat = (id) => (summary.data || []).find((s) => (s.business_id ?? null) === id) || {};
  const total = (summary.data || []).reduce((a, s) => a + s.posts, 0);
  const current = sel === 'all' ? null : sel === 'general' ? { name: 'Geral (todos os clientes)', color: '#676879' } : businesses.find((b) => String(b.id) === String(sel));
  const bizOf = (id) => businesses.find((b) => b.id === id);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="muted">Comentários gerais e pontos das reuniões de time, por cliente. Toda a equipe vê e participa.</p>
        </div>
        <div className="row gap wrap">{tabs}</div>
      </div>
      <div className="clients">
        <aside className="client-list">
          <button className={sel === 'all' ? 'on' : ''} onClick={() => choose('all')}>
            <i style={{ background: '#0073ea' }} /><span className="grow">Todos</span><b>{total || ''}</b>
          </button>
          <button className={sel === 'general' ? 'on' : ''} onClick={() => choose('general')}>
            <i style={{ background: '#676879' }} /><span className="grow">Geral<small>assuntos de todos os clientes</small></span><b>{stat(null).posts || ''}</b>
          </button>
          <div className="client-sep">Empresas</div>
          {businesses.map((b) => {
            const s = stat(b.id);
            return (
              <button key={b.id} className={String(sel) === String(b.id) ? 'on' : ''} onClick={() => choose(String(b.id))}>
                <i style={{ background: b.color }} />
                <span className="grow">{b.name}<small>{s.last_at ? `última ${ago(s.last_at)}` : 'sem comentários'}{s.meetings ? ` · ${s.meetings} reunião(ões)` : ''}</small></span>
                <b>{s.posts || ''}</b>
              </button>
            );
          })}
          {!businesses.length && <p className="muted small" style={{ padding: 8 }}>Cadastre as empresas em Equipe e cadastros.</p>}
        </aside>

        <section className="client-feed">
          <div className="row gap wrap" style={{ marginBottom: 12 }}>
            <h2 className="client-title">{current ? <><i style={{ background: current.color }} />{current.name}</> : 'Todos os clientes'}</h2>
            <span className="grow" />
            <input className="sm" placeholder="Buscar nos comentários…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            <label className="check small"><input type="checkbox" checked={onlyMeetings} onChange={(e) => setOnlyMeetings(e.target.checked)} /> só reuniões</label>
          </div>
          <PostComposer key={sel} business={sel} businesses={businesses} />
          {!data ? <Loading /> : !data.length ? <Empty>Nenhum comentário ainda{current ? ` para ${current.name}` : ''}. Escreva o primeiro acima.</Empty> : (
            <ul className="updates">
              {data.map((p) => <Post key={p.id} p={p} biz={sel === 'all' ? bizOf(p.business_id) || (p.business_id ? null : { name: 'Geral', color: '#676879' }) : null} businesses={businesses} />)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function PostComposer({ business, businesses }) {
  const { me } = useApp();
  const fixed = business !== 'all';
  const empty = { body: '', kind: 'comment', meeting_date: me.today, business_id: fixed && business !== 'general' ? business : '' };
  const [f, setF] = useState(empty);
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isMeeting = f.kind === 'meeting';
  const post = async () => {
    if (!f.body.trim()) return;
    setBusy(true);
    try {
      await api('/client-posts', { method: 'POST', body: { ...f, body: f.body.trim(), business_id: f.business_id || null } });
      emitLocal(); setF({ ...empty, kind: f.kind, business_id: f.business_id });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const open = focus || f.body || isMeeting;
  return (
    <div className={'composer' + (open ? ' open' : '') + (isMeeting ? ' meeting' : '')}>
      <div className="row gap-s">
        <div className="mini-seg">
          <button className={!isMeeting ? 'on' : ''} onClick={() => setF({ ...f, kind: 'comment' })}>Comentário</button>
          <button className={isMeeting ? 'on' : ''} onClick={() => setF({ ...f, kind: 'meeting' })}>Pontos de reunião</button>
        </div>
        {isMeeting && <label className="small row gap-s">Reunião de <input type="date" className="sm" value={f.meeting_date} onChange={set('meeting_date')} /></label>}
      </div>
      <textarea rows={open ? (isMeeting ? 6 : 3) : 1} value={f.body} onChange={set('body')} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        placeholder={isMeeting ? 'Pontos discutidos, decisões e próximos passos (um por linha)…' : 'Escreva um comentário sobre o cliente…'}
        onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && post()} />
      {open && (
        <div className="row gap-s wrap">
          {!fixed && (
            <select className="sm" value={f.business_id} onChange={set('business_id')}>
              <option value="">Geral (todos os clientes)</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <span className="grow" />
          <small className="muted hide-sm">Ctrl + Enter publica</small>
          <button className="btn primary sm" disabled={busy || !f.body.trim()} onMouseDown={(e) => e.preventDefault()} onClick={post}>Publicar</button>
        </div>
      )}
    </div>
  );
}

function Post({ p, biz, businesses, reply }) {
  const { me, isAdmin } = useApp();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ body: p.body, kind: p.kind, meeting_date: p.meeting_date || me.today, business_id: p.business_id || '' });
  const [answer, setAnswer] = useState('');
  const [replying, setReplying] = useState(false);
  const mine = p.author_id === me.id;
  const edited = new Date(p.updated_at) - new Date(p.created_at) > 60000;
  const call = async (method, body) => { try { await api(`/client-posts/${p.id}`, { method, body }); emitLocal(); return true; } catch (e) { toast(e.message, 'error'); return false; } };
  const save = async () => { if (!f.body.trim()) return toast('O comentário não pode ficar vazio', 'error'); if (await call('PATCH', reply ? { body: f.body } : { ...f, business_id: f.business_id || null })) setEditing(false); };
  const del = () => confirm(reply ? 'Excluir esta resposta?' : 'Excluir este comentário e as respostas?') && call('DELETE');
  const sendReply = async () => {
    if (!answer.trim()) return;
    try { await api('/client-posts', { method: 'POST', body: { parent_id: p.id, body: answer.trim() } }); setAnswer(''); setReplying(false); emitLocal(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <li className={'update' + (p.pinned ? ' pinned' : '') + (p.kind === 'meeting' ? ' is-meeting' : '') + (reply ? ' reply' : '')}>
      <Avatar name={p.author_name} id={p.author_id} size={reply ? 26 : 32} />
      <div className="grow">
        <div className="update-head">
          <b>{p.author_name || 'Usuário removido'}</b>
          <span className="muted">{when(p.created_at)}{edited && ' · editado'}</span>
          {p.kind === 'meeting' && <span className="tag meeting-tag"><Icon name="users" size={12} /> Reunião {fmtDate(p.meeting_date)}</span>}
          {p.pinned && <span className="tag warn">Fixado</span>}
          {biz && <span className="cat small"><i style={{ background: biz.color }} />{biz.name}</span>}
          <span className="grow" />
          {!editing && (
            <span className="update-actions">
              {!reply && <button className="icon-btn sm" title={p.pinned ? 'Desafixar' : 'Fixar no topo'} onClick={() => call('PATCH', { pinned: !p.pinned })}><Icon name="target" size={14} /></button>}
              {(mine || isAdmin) && <button className="icon-btn sm" title="Editar" onClick={() => setEditing(true)}><Icon name="edit" size={14} /></button>}
              {(mine || isAdmin) && <button className="icon-btn sm" title="Excluir" onClick={del}><Icon name="trash" size={14} /></button>}
            </span>
          )}
        </div>
        {editing ? (
          <div className="inline-form" style={{ marginTop: 6 }}>
            <textarea rows={p.kind === 'meeting' ? 6 : 3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} autoFocus />
            <div className="row gap-s wrap">
              {!reply && (<>
                <select className="sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="comment">Comentário</option><option value="meeting">Pontos de reunião</option></select>
                {f.kind === 'meeting' && <input type="date" className="sm" value={f.meeting_date} onChange={(e) => setF({ ...f, meeting_date: e.target.value })} />}
                <select className="sm" value={f.business_id} onChange={(e) => setF({ ...f, business_id: e.target.value })}>
                  <option value="">Geral</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </>)}
              <span className="grow" />
              <button className="btn sm" onClick={() => setEditing(false)}>Cancelar</button>
              <button className="btn primary sm" onClick={save}>Salvar</button>
            </div>
          </div>
        ) : <p className="update-body">{p.body}</p>}
        {!reply && (
          <>
            {p.replies?.length > 0 && <ul className="updates replies">{p.replies.map((r) => <Post key={r.id} p={r} reply businesses={businesses} />)}</ul>}
            {replying ? (
              <div className="reply-box">
                <textarea rows={2} autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Responder…"
                  onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && sendReply()} />
                <div className="row gap-s"><span className="grow" /><button className="btn sm" onClick={() => setReplying(false)}>Cancelar</button><button className="btn primary sm" disabled={!answer.trim()} onClick={sendReply}>Responder</button></div>
              </div>
            ) : <button className="link small" onClick={() => setReplying(true)}>Responder{p.replies?.length ? ` (${p.replies.length})` : ''}</button>}
          </>
        )}
      </div>
    </li>
  );
}
