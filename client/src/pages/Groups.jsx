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
const CHECKS = [['fotos', 'Fotos'], ['videos', 'Vídeos'], ['anuncio', 'Anúncio'], ['ads', 'ADS'], ['afiliados', 'Afiliados']];
// cola de planilha: colunas separadas por tab (SKU, link, drive, descrição) ou "link - descrição"
function parseLines(text) {
  return text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim()).map((l) => {
    if (l.includes('\t')) {
      const c = l.split('\t').map((x) => x.trim());
      const isUrl = (x) => /^(https?:\/\/|www\.)/i.test(x || '');
      const drive = c.find((x) => /drive\.google|dropbox|photos\.google/i.test(x)) || '';
      const link = c.find((x) => isUrl(x) && x !== drive) || '';
      const rest = c.filter((x) => x && x !== drive && x !== link);
      return { sku: isUrl(c[0]) ? '' : rest[0] || '', link, drive_link: drive, description: rest.slice(isUrl(c[0]) ? 0 : 1).join(' ') };
    }
    const [first, ...more] = l.trim().split(/\s+[-–|;]\s+/);
    if (/^(https?:\/\/|www\.)/i.test(first)) return /drive\.google/i.test(first) ? { drive_link: first, description: more.join(' ') } : { link: first, description: more.join(' ') };
    return { description: l.trim() };
  });
}
const ITEM_STATUS = { todo: ['Livre', '#c4c4c4'], doing: ['Fazendo', '#fdab3d'], done: ['Feito', '#00c875'] };

// Tarefas em grupo (dentro da aba Tarefas): separadas por cliente; clicar abre o quadro da atividade
export function GroupsView({ creating, setCreating }) {
  const { me, businesses } = useApp();
  const [business, setBusiness] = useState('');
  const [status, setStatus] = useState('open');
  const [sel, setSel] = useState(null);
  const list = useData(`/groups?status=${status}${business ? `&business=${business}` : ''}`);
  const groups = list.data || [];

  // agrupa por cliente (empresa), na ordem do cadastro; sem empresa no fim
  const sections = [];
  for (const b of businesses) { const items = groups.filter((g) => g.business_id === b.id); if (items.length) sections.push({ key: b.id, name: b.name, color: b.color, items }); }
  const none = groups.filter((g) => !g.business_id || !businesses.some((b) => b.id === g.business_id));
  if (none.length) sections.push({ key: 0, name: 'Sem cliente', color: '#c4c4c4', items: none });

  const form = creating && <GroupForm defaultBusiness={business} onClose={() => setCreating(false)} onSaved={(g) => { setStatus('open'); setSel(g.id); }} />;
  if (sel) {
    return (
      <div className="client-feed">
        <button className="link small" style={{ marginBottom: 10 }} onClick={() => setSel(null)}><Icon name="left" size={13} /> Voltar para as tarefas em grupo</button>
        <GroupBoard key={sel} id={sel} me={me} onDeleted={() => setSel(null)} />
        {form}
      </div>
    );
  }
  return (
    <div>
      <div className="row gap wrap" style={{ marginBottom: 12 }}>
        <div className="mini-seg">
          <button className={status === 'open' ? 'on' : ''} onClick={() => setStatus('open')}>Em andamento</button>
          <button className={status === 'done' ? 'on' : ''} onClick={() => setStatus('done')}>Concluídas</button>
        </div>
        <select className="sm" value={business} onChange={(e) => setBusiness(e.target.value)}>
          <option value="">Todos os clientes</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <span className="muted small grow">A mesma atividade feita por várias pessoas ao mesmo tempo, com lista de SKUs. Clique em <b>Fazendo isso</b> e todos veem quem está em cada item.</span>
      </div>
      {!list.data ? <Loading /> : !groups.length ? (
        <Empty>{status === 'open' ? 'Nenhuma tarefa em grupo em andamento. Use "Nova tarefa em grupo" e suba a planilha de SKUs.' : 'Nenhuma tarefa em grupo concluída.'}</Empty>
      ) : sections.map((sec) => (
        <div key={sec.key} className="group-section" style={{ '--c': sec.color }}>
          <h3><i />{sec.name}<small>{sec.items.length} tarefa(s) em grupo</small></h3>
          <div className="group-cards">
            {sec.items.map((g) => {
              const doing = g.members.filter((m) => m.doing_since);
              const pct = g.items_total ? (g.items_done / g.items_total) * 100 : 0;
              return (
                <button key={g.id} className={'group-card' + (g.fixed ? ' fixed' : '')} onClick={() => setSel(g.id)}>
                  <b>{g.title}{g.fixed && <span className="tag primary" style={{ marginLeft: 6 }}>Fixa</span>}</b>
                  <small className="muted">{g.channel_name || 'Todos os canais'}{g.due_date && ` · até ${fmtDate(g.due_date)}`}</small>
                  <span className="row gap-s" style={{ alignItems: 'center' }}>
                    <span className="mini-progress grow"><span style={{ width: `${pct}%` }} /></span>
                    <small><b>{g.items_done}/{g.items_total}</b> SKUs</small>
                  </span>
                  {doing.length > 0
                    ? <span className="doing-now"><span className="live-dot" />{doing.map((m) => m.name.split(' ')[0]).join(', ')} fazendo agora</span>
                    : <small className="muted">ninguém fazendo agora</small>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {form}
    </div>
  );
}

function GroupBoard({ id, me, onDeleted }) {
  const { isAdmin } = useApp();
  const { data: g } = useData(`/groups/${id}`);
  const [filter, setFilter] = useState('all');
  const [curvaF, setCurvaF] = useState('');
  const [sort, setSort] = useState('list');
  const [editing, setEditing] = useState(false);
  if (!g) return <Loading />;
  const canManage = isAdmin || g.created_by === me.id;
  const mine = g.members.find((m) => m.id === me.id);
  const iAmDoing = !!mine?.doing_since;
  const doing = g.members.filter((m) => m.doing_since);
  const hasAbc = g.items.some((i) => i.abc);
  const items = g.items
    .filter((i) => filter === 'all' || i.status === filter || (filter === 'mine' && i.user_id === me.id))
    .filter((i) => !curvaF || (curvaF === 'none' ? !i.curva : i.curva === curvaF))
    .sort(sort === 'fat' ? (a, b) => (b.faturamento || 0) - (a.faturamento || 0)
      : sort === 'curva' ? (a, b) => (a.curva || 'Z').localeCompare(b.curva || 'Z') || (b.faturamento || 0) - (a.faturamento || 0) : () => 0);
  const count = (s) => g.items.filter((i) => i.status === s).length;
  const done = g.status === 'done';
  const call = async (path, method, body) => { try { await api(path, { method, body }); emitLocal(); return true; } catch (e) { toast(e.message, 'error'); return false; } };

  return (
    <div className="group-board">
      <div className="row gap wrap" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h2 className="client-title">{g.business_color && <i style={{ background: g.business_color }} />}{g.title}{g.fixed && <span className="tag primary">Fixa · toda a equipe</span>}{done && <span className="tag ok">Concluída</span>}</h2>
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
            {!g.fixed && (<>
            <button className="btn sm" onClick={() => call(`/groups/${g.id}`, 'PATCH', { status: done ? 'open' : 'done' })}>
              <Icon name="check" size={14} /> {done ? 'Reabrir' : 'Concluir atividade'}
            </button>
            <button className="icon-btn" title="Excluir" onClick={async () => confirm('Excluir esta tarefa em grupo e todos os itens?') && (await call(`/groups/${g.id}`, 'DELETE')) && onDeleted()}><Icon name="trash" size={16} /></button>
            </>)}
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

      {hasAbc && <AbcSummary g={g} curvaF={curvaF} setCurvaF={setCurvaF} sort={sort} setSort={setSort} />}

      {g.items.length > 0 && <ListingSummary g={g} />}

      {!done && <AddItems groupId={g.id} />}

      {!g.items.length ? <Empty>Sem itens ainda. Adicione um link e uma descrição acima. Cada pessoa clica em "Fazendo isso" no item que pegar.</Empty> : (
        <div className="table-scroll">
          <table className="group-items">
            <thead><tr>
              <th style={{ width: 28 }}>#</th><th style={{ width: 92 }}>SKU</th>{hasAbc && <><th style={{ width: 48 }}>Curva</th><th style={{ width: 92 }}>Faturam.</th></>}<th style={{ width: 158 }}>Anúncios por canal</th><th style={{ width: 56 }}>Drive</th><th style={{ width: 96 }} title="Fotos e vídeos prontos no geral (base para todos os anúncios)">Base do SKU</th><th>Descrição</th>
              {CHECKS.map(([k, l]) => <th key={k} className="ck-col">{l}</th>)}
              <th style={{ width: 96 }}>Quem</th><th style={{ width: 172 }}>Ações</th>
            </tr></thead>
            <tbody>
              {items.map((i) => <ItemRow key={i.id} hasAbc={hasAbc} i={i} n={g.items.indexOf(i) + 1} me={me} canManage={canManage} groupDone={done} call={call} />)}
            </tbody>
          </table>
        </div>
      )}
      {editing && <GroupForm group={g} onClose={() => setEditing(false)} />}
    </div>
  );
}

const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
function AbcCells({ i }) {
  const rows = i.abc?.rows || [];
  const tip = rows.length ? rows.map((r) => `${r.classe} · ${r.marketplace}${r.conta ? ` (${r.conta})` : ''} ${r.anuncio}: ${brl(r.faturamento)} · ${r.qtd} un.`).join('\n') : i.abc?.none ? 'Sem venda no período da planilha' : '';
  return (<>
    <td title={tip}>{i.curva ? <span className={'curva c' + i.curva}>{i.curva}</span> : <span className="muted small">{i.abc ? 'sem venda' : '—'}</span>}</td>
    <td title={tip} className="num">{i.abc ? <><b>{brl(i.faturamento)}</b>{i.abc.qtd ? <small className="muted block">{i.abc.qtd} un.</small> : null}</> : <span className="muted">—</span>}</td>
  </>);
}
function AbcSummary({ g, curvaF, setCurvaF, sort, setSort }) {
  const total = g.items.reduce((a, i) => a + (i.faturamento || 0), 0);
  const by = (c) => g.items.filter((i) => (c === 'none' ? !i.curva : i.curva === c));
  return (
    <div className="abc-summary">
      <div className="abc-head">
        <b>Curva ABC</b>
        <span className="muted small">{g.abc_period && `${g.abc_period} · `}atualizada {g.abc_updated_at && new Date(g.abc_updated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          {' '}· para atualizar, suba a planilha nova de curva ABC</span>
        <span className="grow" />
        <select className="sm" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="list">Ordem da lista</option><option value="fat">Maior faturamento</option><option value="curva">Curva (A → C)</option>
        </select>
      </div>
      <div className="abc-cards">
        {[['A', 'Curva A'], ['B', 'Curva B'], ['C', 'Curva C'], ['none', 'Sem venda']].map(([c, l]) => {
          const list = by(c); const fat = list.reduce((a, i) => a + (i.faturamento || 0), 0);
          return (
            <button key={c} className={'abc-card c' + c + (curvaF === c ? ' on' : '')} onClick={() => setCurvaF(curvaF === c ? '' : c)} title="Filtrar">
              <small>{l}</small><b>{list.length} SKU(s)</b>{c !== 'none' && <small>{brl(fat)} · {total ? Math.round((fat / total) * 100) : 0}%</small>}
            </button>
          );
        })}
        <div className="abc-card total"><small>Faturamento total</small><b>{brl(total)}</b></div>
      </div>
    </div>
  );
}

// anúncios do SKU por canal (cada anúncio tem o próprio checklist); Drive é um só por SKU
const initials = (name) => { const w = name.split(/\s+/).filter(Boolean); return (w.length > 1 ? w.map((x) => x[0]).join('') : name.slice(0, 3)).slice(0, 3).toUpperCase(); };
const listingDone = (l) => CHECKS.every(([k]) => l.checks?.[k]);
function ChannelChips({ list, channels }) {
  return (
    <span className="lst-chips-inner">
      {channels.map((c) => {
        const mine = list.filter((l) => l.channel_id === c.id);
        const ok = mine.filter(listingDone).length;
        const cls = !mine.length ? '' : ok === mine.length ? ' on' : ' part';
        return <span key={c.id} className={'lst-chip' + cls} style={{ '--c': c.color }} title={`${c.name}: ${mine.length ? `${mine.length} anúncio(s), ${ok} completo(s)` : 'sem anúncio'}`}>{initials(c.name)}{mine.length > 0 && <sup>{mine.length}</sup>}</span>;
      })}
    </span>
  );
}
function ListingsPanel({ i, call, colSpan, disabled }) {
  const { channels } = useApp();
  const [ch, setCh] = useState(channels[0]?.id || '');
  const [val, setVal] = useState('');
  const list = i.listings || [];
  const add = async () => {
    if (!val.trim() || !ch) return;
    if (await call(`/group-items/${i.id}`, 'PATCH', { action: 'add_listing', channel_id: ch, value: val.trim() })) setVal('');
  };
  const chanOf = (id) => channels.find((c) => c.id === id) || { name: '?', color: '#c4c4c4' };
  const sorted = [...list].sort((a, b) => channels.findIndex((c) => c.id === a.channel_id) - channels.findIndex((c) => c.id === b.channel_id));
  const complete = list.filter(listingDone).length;
  return (
    <tr className="lst-panel-row">
      <td colSpan={colSpan}>
        <div className="lst-panel">
          <div className="lst-head">
            <b>Anúncios do SKU {i.sku || ''}</b>
            <span className="muted small">{list.length} anúncio(s) · {complete} completo(s) · {channels.filter((c) => list.some((l) => l.channel_id === c.id)).length}/{channels.length} canais</span>
            <ChannelChips list={list} channels={channels} />
            <span className="small muted">Base:</span><BaseToggles i={i} call={call} disabled={disabled} />
            {i.drive_link && <a className="small item-link drive" href={i.drive_link} target="_blank" rel="noreferrer">📁 Drive do SKU (fotos e vídeos)</a>}
          </div>
          {list.length > 0 && (
            <table className="lst-table">
              <thead><tr><th style={{ width: 130 }}>Canal</th><th>Anúncio</th><th style={{ width: 150 }}>Conta</th>
                {CHECKS.map(([k, l]) => <th key={k} className="ck-col">{l}</th>)}<th style={{ width: 90 }}>Situação</th><th style={{ width: 34 }} /></tr></thead>
              <tbody>
                {sorted.map((l) => {
                  const c = chanOf(l.channel_id); const ok = listingDone(l);
                  return (
                    <tr key={l.id} className={ok ? 'lst-ok' : ''}>
                      <td><span className="chan" style={{ background: c.color }}>{c.name}</span></td>
                      <td>{l.link ? <a href={l.link} target="_blank" rel="noreferrer" className="item-link" title={l.link}>{l.code || shortLink(l.link)}</a> : <span className="sku">{l.code}</span>}</td>
                      <td className="muted small">{l.conta || '—'}</td>
                      {CHECKS.map(([k, lb]) => {
                        const v = l.checks?.[k];
                        return (
                          <td key={k} className="ck-col">
                            <button className={'ck' + (v ? ' on' : '')} disabled={disabled} title={v ? `${lb}: feito por ${v.name} às ${hm(v.at)}` : `Marcar ${lb} neste anúncio`}
                              onClick={() => call(`/group-items/${i.id}`, 'PATCH', { action: 'check_listing', listing_id: l.id, key: k, value: !v })}>{v ? '✓' : ''}</button>
                          </td>
                        );
                      })}
                      <td>{ok ? <span className="tag ok">Completo</span> : <span className="muted small">{CHECKS.filter(([k]) => l.checks?.[k]).length}/{CHECKS.length}</span>}</td>
                      <td>{!disabled && <button className="icon-btn sm" title="Remover anúncio" onClick={() => confirm('Remover este anúncio e o checklist dele?') && call(`/group-items/${i.id}`, 'PATCH', { action: 'remove_listing', listing_id: l.id })}><Icon name="trash" size={13} /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!disabled && (
            <div className="lst-add-row">
              <select className="sm" value={ch} onChange={(e) => setCh(Number(e.target.value))}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <input className="sm grow" placeholder="Link ou código do anúncio (ex.: MLB123…)" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
              <button className="btn primary sm" disabled={!val.trim()} onClick={add}><Icon name="plus" size={13} /> Adicionar anúncio</button>
            </div>
          )}
          {!list.length && <p className="muted small" style={{ margin: '6px 0 0' }}>Nenhum anúncio ainda. Adicione um anúncio por canal; cada anúncio terá o seu checklist (fotos, vídeos, anúncio, ADS e afiliados).</p>}
        </div>
      </td>
    </tr>
  );
}

// placar por anúncio: checklist geral e por canal
function ListingSummary({ g }) {
  const { channels } = useApp();
  const all = g.items.flatMap((i) => (i.listings || []).map((l) => ({ ...l, sku: i.sku })));
  const skuNoListing = g.items.filter((i) => !(i.listings || []).length).length;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const rows = channels.map((c) => {
    const l = all.filter((x) => x.channel_id === c.id);
    return { c, total: l.length, skus: new Set(g.items.filter((i) => (i.listings || []).some((x) => x.channel_id === c.id)).map((i) => i.id)).size, by: CHECKS.map(([k]) => l.filter((x) => x.checks?.[k]).length), done: l.filter(listingDone).length };
  });
  return (
    <div className="lst-summary">
      <div className="check-summary">
        <div className={g.items.length && g.items.every((i) => i.checks?.fotos && i.checks?.videos) ? 'full' : ''}>
          <small>Base pronta (fotos e vídeos)</small><b>{g.items.filter((i) => i.checks?.fotos && i.checks?.videos).length}/{g.items.length} SKUs</b>
          <small className="muted">📷 {g.items.filter((i) => i.checks?.fotos).length} · 🎬 {g.items.filter((i) => i.checks?.videos).length}</small>
        </div>
        <div><small>Anúncios</small><b>{all.length}</b><small className="muted">{all.filter(listingDone).length} completo(s){skuNoListing ? ` · ${skuNoListing} SKU(s) sem anúncio` : ''}</small></div>
        {CHECKS.map(([k, l]) => {
          const n = all.filter((x) => x.checks?.[k]).length;
          return (
            <div key={k} className={all.length && n === all.length ? 'full' : ''}>
              <small>{l}</small><b>{n}/{all.length}</b>
              <span className="mini-progress"><span style={{ width: `${pct(n, all.length)}%` }} /></span>
            </div>
          );
        })}
      </div>
      <details className="chan-table" open={all.length > 0}>
        <summary>Por canal</summary>
        <table>
          <thead><tr><th>Canal</th><th>Anúncios</th><th>SKUs com anúncio</th>{CHECKS.map(([k, l]) => <th key={k}>{l}</th>)}<th>Completos</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.c.id} className={r.total ? '' : 'muted'}>
                <td><span className="chan" style={{ background: r.c.color }}>{r.c.name}</span></td>
                <td><b>{r.total}</b></td>
                <td>{r.skus}/{g.items.length}</td>
                {r.by.map((n, k) => <td key={k} className={r.total && n === r.total ? 'ok-text' : ''}>{r.total ? `${n}/${r.total}` : '—'}</td>)}
                <td>{r.total ? <b className={r.done === r.total ? 'ok-text' : ''}>{r.done}/{r.total}</b> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// base do SKU: fotos e vídeos prontos no geral (servem para todos os anúncios)
function BaseToggles({ i, call, disabled }) {
  const b = i.checks || {};
  const both = b.fotos && b.videos;
  const t = (k, label, icon) => {
    const v = b[k];
    return (
      <button className={'base-btn' + (v ? ' on' : '')} disabled={disabled} onClick={() => call(`/group-items/${i.id}`, 'PATCH', { action: 'check', key: k, value: !v })}
        title={v ? `${label} prontas na base — ${v.name}, ${new Date(v.at).toLocaleDateString('pt-BR')}` : `Marcar ${label.toLowerCase()} prontas na base do SKU`}>
        {icon} {label}{v ? ' ✓' : ''}
      </button>
    );
  };
  return (
    <span className={'base-toggles' + (both ? ' ready' : '')}>
      {t('fotos', 'Fotos', '📷')}{t('videos', 'Vídeos', '🎬')}
    </span>
  );
}

function ItemRow({ i, n, me, canManage, groupDone, call, hasAbc }) {
  const { channels } = useApp();
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ sku: i.sku || '', drive_link: i.drive_link || '', description: i.description || '' });
  const mine = i.user_id === me.id;
  const [label, color] = ITEM_STATUS[i.status];
  const act = (action) => call(`/group-items/${i.id}`, 'PATCH', { action });
  const list = i.listings || [];
  const cols = 6 + (hasAbc ? 2 : 0) + CHECKS.length + 2;
  if (edit) {
    return (
      <tr className="editing">
        <td>{n}</td>
        <td><input className="sm" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} placeholder="SKU" /></td>
        {hasAbc && <AbcCells i={i} />}
        <td><ChannelChips list={list} channels={channels} /></td>
        <td><input className="sm" value={f.drive_link} onChange={(e) => setF({ ...f, drive_link: e.target.value })} placeholder="Link do Drive" /></td>
        <td><BaseToggles i={i} call={call} disabled /></td>
        <td><input className="sm" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Descrição" /></td>
        <td colSpan={CHECKS.length + 2}>
          <div className="row gap-s">
            <button className="btn sm" onClick={() => setEdit(false)}>Cancelar</button>
            <button className="btn primary sm" onClick={async () => (await call(`/group-items/${i.id}`, 'PATCH', f)) && setEdit(false)}>Salvar</button>
          </div>
        </td>
      </tr>
    );
  }
  return (<>
    <tr className={'gi-' + i.status + (mine && i.status === 'doing' ? ' gi-mine' : '') + (open ? ' gi-open' : '')}>
      <td className="muted">{n}</td>
      <td><button className="sku-btn" onClick={() => setOpen(!open)} title="Ver anúncios do SKU"><Icon name={open ? 'down' : 'right'} size={12} /><b className="sku">{i.sku || '—'}</b></button></td>
      {hasAbc && <AbcCells i={i} />}
      <td><button className={'lst-chips' + (open ? ' open' : '')} onClick={() => setOpen(!open)} title="Anúncios por canal">
        <ChannelChips list={list} channels={channels} /><small className="muted lst-count">{list.length ? `${list.length} anúncio(s)` : '+ anúncio'}</small></button></td>
      <td>{i.drive_link ? <a href={i.drive_link} target="_blank" rel="noreferrer" className="item-link drive" title={i.drive_link}>📁 Drive</a> : <span className="muted">—</span>}</td>
      <td><BaseToggles i={i} call={call} disabled={groupDone} /></td>
      <td className="item-desc">{i.description || <span className="muted">—</span>}</td>
      {CHECKS.map(([k, l]) => {
        const nOk = list.filter((x) => x.checks?.[k]).length;
        const full = list.length > 0 && nOk === list.length;
        return (
          <td key={k} className="ck-col">
            {list.length ? (
              <button className={'ck-count' + (full ? ' full' : nOk ? ' part' : '')} onClick={() => setOpen(true)} title={`${l}: ${nOk} de ${list.length} anúncio(s)`}>{full ? '✓' : `${nOk}/${list.length}`}</button>
            ) : <span className="muted">—</span>}
          </td>
        );
      })}
      <td>
        <span className="pill sm" style={{ background: color }}>{label}</span>
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
            <button className="icon-btn sm" title="Editar SKU" onClick={() => setEdit(true)}><Icon name="edit" size={13} /></button>
            <button className="icon-btn sm" title="Excluir SKU" onClick={() => confirm('Excluir este SKU e os anúncios dele?') && call(`/group-items/${i.id}`, 'DELETE')}><Icon name="trash" size={13} /></button>
          </>)}
        </span>
      </td>
    </tr>
    {open && <ListingsPanel i={i} call={call} colSpan={cols} disabled={groupDone} />}
  </>);
}

// adiciona item: SKU, link do anúncio, link do Drive (fotos e vídeos) e descrição; colar vários; subir planilha
function AddItems({ groupId }) {
  const empty = { sku: '', link: '', drive_link: '', description: '' };
  const [f, setF] = useState(empty);
  const [bulk, setBulk] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (items) => {
    setBusy(true);
    try { const r = await api(`/groups/${groupId}/items`, { method: 'POST', body: { items } }); emitLocal(); return r; }
    catch (e) { toast(e.message, 'error'); return null; } finally { setBusy(false); }
  };
  const any = Object.values(f).some((v) => v.trim());
  const addOne = async () => { if (any && (await send([f]))) setF(empty); };
  const addBulk = async () => {
    const items = parseLines(text);
    const r = items.length && (await send(items));
    if (r) { setText(''); setBulk(false); toast(`${r.added} item(ns) adicionado(s)`, 'success'); }
  };
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('Planilha muito grande (máx. 10 MB)', 'error');
    setBusy(true);
    try {
      const data = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });
      const r = await api(`/groups/${groupId}/import`, { method: 'POST', body: { filename: file.name, data } });
      emitLocal();
      toast(r.abc
        ? `Curva ABC ${r.period || ''} atualizada: ${r.updated} SKU(s) atualizados, ${r.added} novos${r.without_sales ? `, ${r.without_sales} sem venda no período` : ''}`
        : `${r.added} SKU(s) novo(s), ${r.updated} já existente(s) atualizado(s), ${r.listings} anúncio(s) adicionado(s)`, 'success');
      if (r.no_channel?.length) toast(`Sem canal reconhecido (não entraram): ${r.no_channel.join('; ')}`, 'error');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const onKey = (e) => e.key === 'Enter' && addOne();
  return (
    <div className="add-items">
      {bulk ? (
        <>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={'Cole aqui as linhas copiadas da planilha (SKU, link, drive, descrição)\nou um item por linha: link - descrição'} />
          <div className="row gap-s"><span className="grow" /><button className="btn sm" onClick={() => setBulk(false)}>Cancelar</button><button className="btn primary sm" disabled={busy || !text.trim()} onClick={addBulk}>Adicionar itens</button></div>
        </>
      ) : (
        <div className="add-grid">
          <input value={f.sku} onChange={set('sku')} placeholder="SKU" onKeyDown={onKey} />
          <input value={f.link} onChange={set('link')} placeholder="1º anúncio (link) — opcional" onKeyDown={onKey} />
          <input value={f.drive_link} onChange={set('drive_link')} placeholder="Link do Drive do SKU (fotos e vídeos)" onKeyDown={onKey} />
          <input value={f.description} onChange={set('description')} placeholder="Descrição" onKeyDown={onKey} />
          <button className="btn primary sm" disabled={busy || !any} onClick={addOne}><Icon name="plus" size={14} /> Adicionar</button>
        </div>
      )}
      {!bulk && (
        <div className="row gap wrap small">
          <label className={'btn sm' + (busy ? ' disabled' : '')}>
            <Icon name="download" size={14} /> Subir planilha (SKUs ou Curva ABC)
            <input type="file" accept=".xlsx,.csv,.tsv,.txt" hidden onChange={upload} disabled={busy} />
          </label>
          <a className="btn sm" href="/api/sku-template.xlsx" download><Icon name="download" size={14} /> Baixar modelo</a>
          <button className="link small" onClick={() => setBulk(true)}>colar linhas da planilha</button>
          <span className="muted">Use o <b>modelo</b> (uma linha por anúncio: SKU, descrição, Drive, canal, anúncio, fotos/vídeos prontos) ou a planilha de <b>Curva ABC</b> (atualiza curva e faturamento). Pode reenviar: não duplica.</span>
        </div>
      )}
    </div>
  );
}

function GroupForm({ group, onClose, onSaved, defaultBusiness }) {
  const { me, isAdmin, activeUsers, businesses, channels } = useApp();
  const dir = useData(isAdmin ? null : '/users/directory');
  const people = isAdmin ? activeUsers : dir.data || [];
  const editing = !!group;
  const [f, setF] = useState({
    title: group?.title || '', description: group?.description || '', link: group?.link || '',
    business_id: group?.business_id || defaultBusiness || '', channel_id: group?.channel_id || '', due_date: group?.due_date || '',
    member_ids: group ? group.members.map((m) => m.id) : [me.id], all_members: !group, items: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (id) => setF({ ...f, all_members: false, member_ids: f.member_ids.includes(id) ? f.member_ids.filter((x) => x !== id) : [...f.member_ids, id] });
  const save = async () => {
    if (!f.title.trim()) return toast('Informe o nome da atividade', 'error');
    if (!f.business_id) return toast('Escolha o cliente (empresa) da tarefa em grupo', 'error');
    setBusy(true);
    try {
      const body = { ...f, business_id: f.business_id || null, channel_id: f.channel_id || null, due_date: f.due_date || null };
      body.items = parseLines(f.items);
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
        <Field label="Cliente (empresa) *">
          <select value={f.business_id} onChange={set('business_id')}><option value="">— Escolha —</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
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
            <Field label="Itens (opcional)" hint="Cole linhas da planilha (SKU, link, drive, descrição) ou um por linha: link - descrição. Também dá para subir a planilha de SKUs depois, na própria atividade.">
              <textarea rows={4} value={f.items} onChange={set('items')} placeholder={'https://shopee.com.br/produto-1 - revisar título\nhttps://shopee.com.br/produto-2 - trocar fotos'} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
