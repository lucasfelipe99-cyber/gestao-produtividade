import React, { useState } from 'react';
import { api, toast, emitLocal, useData, fmtDate } from '../lib.js';
import { Icon, Avatar, Loading, Empty, Modal, Field, Progress } from '../ui.jsx';
import { useApp } from '../App.jsx';

const pad2 = (n) => String(n).padStart(2, '0');
const hm = (iso) => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const since = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${pad2(m % 60)}`;
};
const shortLink = (url) => { try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '').slice(0, 60); } catch { return url.slice(0, 60); } };
const ITEM_STATUS = { todo: ['Livre', '#c4c4c4'], doing: ['Fazendo', '#fdab3d'], done: ['Feito', '#00c875'] };

// Tarefas em grupo: a mesma atividade feita por várias pessoas ao mesmo tempo, todos vendo quem está fazendo o quê
export default function Groups() {
  const { me } = useApp();
  const [status, setStatus] = useState('open');
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = useData(`/groups?status=${status}`);
  const groups = list.data || [];
  const current = sel && groups.some((g) => g.id === sel) ? sel : groups[0]?.id;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tarefas em grupo</h1>
          <p className="muted">A mesma atividade feita por várias pessoas ao mesmo tempo. Clique em <b>Fazendo isso</b> e todos veem quem está em cada item.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" /> Nova tarefa em grupo</button>
      </div>
      <div className="clients">
        <aside className="client-list group-list">
          <div className="mini-seg" style={{ margin: '2px 2px 8px' }}>
            <button className={status === 'open' ? 'on' : ''} onClick={() => setStatus('open')}>Em andamento</button>
            <button className={status === 'done' ? 'on' : ''} onClick={() => setStatus('done')}>Concluídas</button>
          </div>
          {!list.data ? <Loading /> : !groups.length ? <p className="muted small" style={{ padding: 8 }}>{status === 'open' ? 'Nenhuma tarefa em grupo em andamento.' : 'Nenhuma concluída ainda.'}</p>
            : groups.map((g) => {
              const doing = g.members.filter((m) => m.doing_since);
              const pct = g.items_total ? (g.items_done / g.items_total) * 100 : 0;
              return (
                <button key={g.id} className={g.id === current ? 'on' : ''} onClick={() => setSel(g.id)}>
                  <i style={{ background: g.business_color || '#0073ea' }} />
                  <span className="grow">
                    {g.title}
                    <small>{g.business_name || 'Sem empresa'}{g.due_date && ` · até ${fmtDate(g.due_date)}`}</small>
                    {g.items_total > 0 && <span className="mini-progress"><span style={{ width: `${pct}%` }} /></span>}
                    {doing.length > 0 && (
                      <span className="doing-now">
                        <span className="live-dot" />{doing.map((m) => m.name.split(' ')[0]).join(', ')} fazendo
                      </span>
                    )}
                  </span>
                  {g.items_total > 0 && <b>{g.items_done}/{g.items_total}</b>}
                </button>
              );
            })}
        </aside>
        <section className="client-feed">
          {current ? <GroupBoard key={current} id={current} me={me} onDeleted={() => setSel(null)} />
            : <Empty>Crie uma tarefa em grupo para a equipe trabalhar junto, por exemplo "Revisar anúncios pausados da Popper", com um item para cada link.</Empty>}
        </section>
      </div>
      {creating && <GroupForm onClose={() => setCreating(false)} onSaved={(g) => { setStatus('open'); setSel(g.id); }} />}
    </div>
  );
}

function GroupBoard({ id, me, onDeleted }) {
  const { isAdmin } = useApp();
  const { data: g } = useData(`/groups/${id}`);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(false);
  if (!g) return <Loading />;
  const canManage = isAdmin || g.created_by === me.id;
  const mine = g.members.find((m) => m.id === me.id);
  const iAmDoing = !!mine?.doing_since;
  const doing = g.members.filter((m) => m.doing_since);
  const items = g.items.filter((i) => filter === 'all' || i.status === filter || (filter === 'mine' && i.user_id === me.id));
  const count = (s) => g.items.filter((i) => i.status === s).length;
  const done = g.status === 'done';
  const call = async (path, method, body) => { try { await api(path, { method, body }); emitLocal(); return true; } catch (e) { toast(e.message, 'error'); return false; } };

  return (
    <div className="group-board">
      <div className="row gap wrap" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h2 className="client-title">{g.business_color && <i style={{ background: g.business_color }} />}{g.title}{done && <span className="tag ok">Concluída</span>}</h2>
          <div className="row gap-s wrap small muted" style={{ marginTop: 4 }}>
            {g.business_name && <span className="cat small"><i style={{ background: g.business_color }} />{g.business_name}</span>}
            {g.channel_name && <span className="chan" style={{ background: g.channel_color }}>{g.channel_name}</span>}
            {g.due_date && <span>Prazo <b>{fmtDate(g.due_date)}</b></span>}
            <span>criada por {g.created_by_name || '—'}</span>
          </div>
        </div>
        {canManage && (
          <div className="row gap-s">
            <button className="btn sm" onClick={() => setEditing(true)}><Icon name="edit" size={14} /> Editar</button>
            <button className="btn sm" onClick={() => call(`/groups/${g.id}`, 'PATCH', { status: done ? 'open' : 'done' })}>
              <Icon name="check" size={14} /> {done ? 'Reabrir' : 'Concluir atividade'}
            </button>
            <button className="icon-btn" title="Excluir" onClick={async () => confirm('Excluir esta tarefa em grupo e todos os itens?') && (await call(`/groups/${g.id}`, 'DELETE')) && onDeleted()}><Icon name="trash" size={16} /></button>
          </div>
        )}
      </div>

      {(g.link || g.description) && (
        <div className="group-info">
          {g.link && <a className="btn sm" href={g.link} target="_blank" rel="noreferrer"><Icon name="share" size={14} /> Abrir link · {shortLink(g.link)}</a>}
          {g.description && <p className="update-body">{g.description}</p>}
        </div>
      )}

      <div className="presence">
        <div className="grow">
          <small className="muted">Quem está fazendo agora</small>
          <div className="presence-list">
            {!doing.length && <span className="muted small">Ninguém no momento</span>}
            {doing.map((m) => {
              const it = g.items.find((i) => i.id === m.item_id);
              return (
                <span key={m.id} className="presence-chip" title={`Desde ${hm(m.doing_since)}`}>
                  <Avatar name={m.name} id={m.id} size={24} /><span className="live-dot" />
                  <span><b>{m.name.split(' ')[0]}</b><small>{it ? `item ${g.items.indexOf(it) + 1}` : 'na atividade'} · {since(m.doing_since)}</small></span>
                </span>
              );
            })}
          </div>
        </div>
        {!done && (iAmDoing
          ? <button className="btn" onClick={() => call(`/groups/${g.id}/doing`, 'POST', { on: false })}><Icon name="stop" size={14} /> Parar</button>
          : <button className="btn primary doing-btn" onClick={() => call(`/groups/${g.id}/doing`, 'POST', { on: true })}><Icon name="play" size={14} /> Fazendo isso</button>)}
      </div>

      <div className="row gap wrap" style={{ margin: '14px 0 8px' }}>
        <div className="grow" style={{ minWidth: 200 }}>
          <Progress value={g.items.length ? (count('done') / g.items.length) * 100 : 0} color="#00c875" label={`${count('done')}/${g.items.length} itens feitos`} />
        </div>
        <div className="mini-seg">
          {[['all', `Todos ${g.items.length}`], ['todo', `Livres ${count('todo')}`], ['doing', `Fazendo ${count('doing')}`], ['done', `Feitos ${count('done')}`], ['mine', 'Meus']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>

      {!done && <AddItems groupId={g.id} />}

      {!g.items.length ? <Empty>Sem itens ainda. Adicione um link e uma descrição acima. Cada pessoa clica em "Fazendo isso" no item que pegar.</Empty> : (
        <div className="table-scroll">
          <table className="group-items">
            <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: "19%" }}>Link</th><th>Descrição</th><th style={{ width: 96 }}>Status</th><th style={{ width: 130 }}>Quem</th><th style={{ width: 240 }}>Ações</th></tr></thead>
            <tbody>
              {items.map((i) => <ItemRow key={i.id} i={i} n={g.items.indexOf(i) + 1} me={me} canManage={canManage} groupDone={done} call={call} />)}
            </tbody>
          </table>
        </div>
      )}
      {editing && <GroupForm group={g} onClose={() => setEditing(false)} />}
    </div>
  );
}

function ItemRow({ i, n, me, canManage, groupDone, call }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ link: i.link || '', description: i.description || '' });
  const mine = i.user_id === me.id;
  const [label, color] = ITEM_STATUS[i.status];
  const act = (action) => call(`/group-items/${i.id}`, 'PATCH', { action });
  if (edit) {
    return (
      <tr className="editing">
        <td>{n}</td>
        <td><input className="sm" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://…" /></td>
        <td><input className="sm" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Descrição" /></td>
        <td colSpan={3}>
          <div className="row gap-s">
            <button className="btn sm" onClick={() => setEdit(false)}>Cancelar</button>
            <button className="btn primary sm" onClick={async () => (await call(`/group-items/${i.id}`, 'PATCH', f)) && setEdit(false)}>Salvar</button>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className={'gi-' + i.status + (mine && i.status === 'doing' ? ' gi-mine' : '')}>
      <td className="muted">{n}</td>
      <td>{i.link ? <a href={i.link} target="_blank" rel="noreferrer" className="item-link" title={i.link}>{shortLink(i.link)}</a> : <span className="muted">—</span>}</td>
      <td className="item-desc">{i.description || <span className="muted">—</span>}</td>
      <td><span className="pill" style={{ background: color }}>{label}</span></td>
      <td>
        {i.user_name ? (
          <span className="row gap-s"><Avatar name={i.user_name} id={i.user_id} size={22} />
            <span className="small">{i.user_name.split(' ')[0]}<br /><small className="muted">{i.status === 'done' && i.done_at ? `feito ${hm(i.done_at)}` : i.started_at ? `desde ${hm(i.started_at)}` : ''}</small></span>
          </span>
        ) : <span className="muted">—</span>}
      </td>
      <td>
        <span className="row gap-s wrap">
          {!groupDone && i.status === 'todo' && <button className="btn xs start" onClick={() => act('doing')}><Icon name="play" size={12} /> Fazendo isso</button>}
          {!groupDone && i.status === 'doing' && mine && <button className="btn xs finish" onClick={() => act('done')}><Icon name="check" size={12} /> Feito</button>}
          {!groupDone && i.status === 'doing' && (mine || canManage) && <button className="btn xs" onClick={() => act('release')}>Soltar</button>}
          {!groupDone && i.status === 'doing' && !mine && !canManage && <small className="muted">com {i.user_name?.split(' ')[0]}</small>}
          {!groupDone && i.status === 'done' && (mine || canManage) && <button className="btn xs" onClick={() => act('reopen')}>Reabrir</button>}
          {(i.created_by === me.id || canManage) && (<>
            <button className="icon-btn sm" title="Editar" onClick={() => setEdit(true)}><Icon name="edit" size={13} /></button>
            <button className="icon-btn sm" title="Excluir" onClick={() => confirm('Excluir este item?') && call(`/group-items/${i.id}`, 'DELETE')}><Icon name="trash" size={13} /></button>
          </>)}
        </span>
      </td>
    </tr>
  );
}

// adiciona item: um campo para link e outro para descrição (ou vários links de uma vez)
function AddItems({ groupId }) {
  const [f, setF] = useState({ link: '', description: '' });
  const [bulk, setBulk] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (items) => {
    setBusy(true);
    try { await api(`/groups/${groupId}/items`, { method: 'POST', body: { items } }); emitLocal(); return true; }
    catch (e) { toast(e.message, 'error'); return false; } finally { setBusy(false); }
  };
  const addOne = async () => { if (!f.link.trim() && !f.description.trim()) return; if (await send([f])) setF({ link: '', description: '' }); };
  const addBulk = async () => {
    const items = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [link, ...rest] = l.split(/\s+[-–|;]\s+|\t/);
      return /^(https?:\/\/|www\.)/i.test(link) ? { link, description: rest.join(' ') } : { description: l };
    });
    if (items.length && (await send(items))) { setText(''); setBulk(false); toast(`${items.length} item(ns) adicionado(s)`, 'success'); }
  };
  return (
    <div className="add-items">
      {bulk ? (
        <>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={'Um item por linha. Ex.:\nhttps://shopee.com.br/produto-1 - revisar título e fotos\nhttps://shopee.com.br/produto-2 - ajustar preço'} />
          <div className="row gap-s"><span className="grow" /><button className="btn sm" onClick={() => setBulk(false)}>Cancelar</button><button className="btn primary sm" disabled={busy || !text.trim()} onClick={addBulk}>Adicionar itens</button></div>
        </>
      ) : (
        <div className="row gap-s wrap">
          <input className="grow" style={{ minWidth: 200 }} value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="Link (ex.: anúncio, planilha, pasta)" onKeyDown={(e) => e.key === 'Enter' && addOne()} />
          <input className="grow" style={{ minWidth: 200 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Descrição do que fazer" onKeyDown={(e) => e.key === 'Enter' && addOne()} />
          <button className="btn primary sm" disabled={busy || (!f.link.trim() && !f.description.trim())} onClick={addOne}><Icon name="plus" size={14} /> Adicionar</button>
          <button className="link small" onClick={() => setBulk(true)}>colar vários</button>
        </div>
      )}
    </div>
  );
}

function GroupForm({ group, onClose, onSaved }) {
  const { me, isAdmin, activeUsers, businesses, channels } = useApp();
  const dir = useData(isAdmin ? null : '/users/directory');
  const people = isAdmin ? activeUsers : dir.data || [];
  const editing = !!group;
  const [f, setF] = useState({
    title: group?.title || '', description: group?.description || '', link: group?.link || '',
    business_id: group?.business_id || '', channel_id: group?.channel_id || '', due_date: group?.due_date || '',
    member_ids: group ? group.members.map((m) => m.id) : [me.id], all_members: !group, items: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (id) => setF({ ...f, all_members: false, member_ids: f.member_ids.includes(id) ? f.member_ids.filter((x) => x !== id) : [...f.member_ids, id] });
  const save = async () => {
    if (!f.title.trim()) return toast('Informe o nome da atividade', 'error');
    setBusy(true);
    try {
      const body = { ...f, business_id: f.business_id || null, channel_id: f.channel_id || null, due_date: f.due_date || null };
      body.items = f.items.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [link, ...rest] = l.split(/\s+[-–|;]\s+|\t/);
        return /^(https?:\/\/|www\.)/i.test(link) ? { link, description: rest.join(' ') } : { description: l };
      });
      if (editing) delete body.items;
      const r = await api(editing ? `/groups/${group.id}` : '/groups', { method: editing ? 'PATCH' : 'POST', body });
      emitLocal(); toast(editing ? 'Atividade atualizada' : 'Tarefa em grupo criada', 'success');
      onSaved?.(r); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? 'Editar tarefa em grupo' : 'Nova tarefa em grupo'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>{editing ? 'Salvar' : 'Criar'}</button></>}>
      <div className="grid-form">
        <Field label="Nome da atividade *"><input autoFocus value={f.title} onChange={set('title')} placeholder="Ex.: Revisar anúncios pausados — Popper" /></Field>
        <Field label="Link"><input value={f.link} onChange={set('link')} placeholder="https://… (planilha, pasta, painel)" /></Field>
        <div className="full"><Field label="Descrição"><textarea rows={3} value={f.description} onChange={set('description')} placeholder="O que fazer, critérios, combinados…" /></Field></div>
        <Field label="Empresa">
          <select value={f.business_id} onChange={set('business_id')}><option value="">—</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </Field>
        <Field label="Canal">
          <select value={f.channel_id} onChange={set('channel_id')}><option value="">—</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        <Field label="Prazo"><input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        <div className="full">
          <Field label="Participantes">
            <div className="member-pick">
              <label className="check"><input type="checkbox" checked={f.all_members} onChange={(e) => setF({ ...f, all_members: e.target.checked })} /> <b>Toda a equipe</b></label>
              {!f.all_members && people.map((u) => (
                <label key={u.id} className="check"><input type="checkbox" checked={f.member_ids.includes(u.id)} onChange={() => toggle(u.id)} /> {u.name}</label>
              ))}
            </div>
          </Field>
        </div>
        {!editing && (
          <div className="full">
            <Field label="Itens (opcional)" hint="Um por linha: link - descrição. Também dá para adicionar depois, na própria atividade.">
              <textarea rows={4} value={f.items} onChange={set('items')} placeholder={'https://shopee.com.br/produto-1 - revisar título\nhttps://shopee.com.br/produto-2 - trocar fotos'} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
