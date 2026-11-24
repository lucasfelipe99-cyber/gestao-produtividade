import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, useData, toast, emitLocal, fmtDateTime } from '../lib.js';
import { Icon, Avatar, Modal, Field, Loading, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';

// ---------------- definições ----------------
export const PILLARS = {
  estrutura: ['Estrutura do anúncio', '#579bfc'],
  publicidade: ['Publicidade e divulgação', '#00c875'],
  comercial: ['Estratégias comerciais', '#fdab3d'],
};
export const CHECKS = [
  ['anuncio', 'No ar', 'Anúncio no ar', 'estrutura'],
  ['capa', 'Capa', 'Foto de capa', 'estrutura'],
  ['ambientada', 'Ambient.', 'Foto ambientada', 'estrutura'],
  ['beneficios', 'Benef.', 'Foto de benefícios', 'estrutura'],
  ['objecao', 'Objeções', 'Foto de quebra de objeções', 'estrutura'],
  ['como_usar', 'Como usar', 'Foto de como usar', 'estrutura'],
  ['extra', 'Img. extra', 'Imagem extra explicativa', 'estrutura'],
  ['video', 'Vídeo', 'Vídeo', 'estrutura'],
  ['ads', 'ADS', 'ADS (publicidade paga)', 'publicidade'],
  ['afiliados', 'Afiliados', 'Afiliados', 'publicidade'],
  ['promocao', 'Promoção', 'Promoção', 'comercial'],
  ['cupom', 'Cupom', 'Cupom', 'comercial'],
  ['relampago', 'Relâmpago', 'Oferta relâmpago', 'comercial'],
];
export const CLASS = { alta: ['Alta performance', '#a25ddc'], estrategico: ['Estratégico', '#ff7a45'], geral: ['Geral', '#8a90a6'] };
const LEVELS = [[95, 'Excelente', '#037f4c'], [80, 'Muito bom', '#00c875'], [60, 'Bom', '#9cd326'], [40, 'Precisa melhorar', '#fdab3d'], [0, 'Crítico', '#e2445c']];
export const levelOf = (s) => (s == null ? null : LEVELS.find(([min]) => s >= min));
const PRIO = { 1: ['Urgente', '#e2445c'], 2: ['Alta', '#ff7a45'], 3: ['Média', '#fdab3d'], 4: ['Baixa', '#579bfc'], 5: ['Manutenção', '#00c875'] };

export function weightsFor(data, channelId, cls) {
  const cfg = data.config || [];
  const pick = (ch, c) => cfg.find((x) => (x.channel_id || null) === ch && (x.classification || null) === c)?.weights;
  return pick(channelId, cls) || pick(channelId, null) || pick(null, cls) || pick(null, null) || data.default_weights;
}
export function scoreOf(ad, w) {
  let max = 0, got = 0, pending = 0;
  const pil = {};
  for (const [k, , , p] of CHECKS) {
    const wk = Number(w[k]) || 0; const st = ad.checks?.[k]?.s;
    if (!wk || st === 'na') continue;
    max += wk; pil[p] = pil[p] || [0, 0]; pil[p][1] += wk;
    if (st === 'ok') { got += wk; pil[p][0] += wk; } else pending++;
  }
  return { score: max ? Math.round((got / max) * 100) : null, pending, pillars: pil };
}
const prioOf = (cls, score) => (score == null || score >= 80 ? 5 : cls === 'alta' ? 1 : cls === 'estrategico' ? 2 : score < 40 ? 3 : 4);
const ago = (iso) => { if (!iso) return '—'; const m = (Date.now() - new Date(iso)) / 6e4; return m < 1 ? 'agora' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : fmtDateTime(iso); };
const LS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

export function usePeople() {
  const { isAdmin, activeUsers } = useApp();
  const dir = useData(isAdmin ? null : '/users/directory');
  return isAdmin ? activeUsers : dir.data || [];
}
const fileToData = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });

// ---------------- página ----------------
export default function Ads() {
  const { me, isAdmin, businesses, channels } = useApp();
  const people = usePeople();
  const { data, setData, reload } = useData('/ads');
  const [biz, setBiz] = useState(() => LS('ads.biz', 'all'));
  const [f, setF] = useState({ channel: '', account: '', resp: '', cls: '', level: '', prio: '', q: '', pending: false, missing: '' });
  const [sort, setSort] = useState({ k: 'prio', dir: 1 });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState(() => new Set());
  const [hidden, setHidden] = useState(() => LS('ads.hidden', []));
  const [modal, setModal] = useState(null);
  useEffect(() => saveLS('ads.biz', biz), [biz]);
  useEffect(() => saveLS('ads.hidden', hidden), [hidden]);
  useEffect(() => { setPage(0); }, [biz, f, sort]);

  const ctx = useMemo(() => {
    if (!data) return null;
    const bizName = (id) => businesses.find((b) => b.id === id)?.name || '—';
    const ch = (id) => channels.find((c) => c.id === id) || { name: '—', color: '#c4c4c4' };
    const acc = new Map((data.accounts || []).map((a) => [a.id, a]));
    const owner = (b, c) => data.owners.find((o) => o.business_id === b && o.channel_id === c)?.user_id || null;
    const adOwner = (b, c) => data.owners.find((o) => o.business_id === b && o.channel_id === c)?.ad_user_id || null;
    const pname = (id) => people.find((p) => p.id === id)?.name || '';
    const drive = new Map((data.skus || []).map((s) => [`${s.business_id}:${(s.sku || '').toLowerCase()}`, s]));
    const rows = data.ads.map((a) => {
      const w = weightsFor(data, a.channel_id, a.classification);
      const sc = scoreOf(a, w);
      return { ...a, w, ...sc, prio: prioOf(a.classification, sc.score), owner: owner(a.business_id, a.channel_id), adOwner: adOwner(a.business_id, a.channel_id), sku_info: drive.get(`${a.business_id}:${(a.sku || '').toLowerCase()}`) };
    });
    return { rows, bizName, ch, acc, owner, pname };
  }, [data, businesses, channels, people]);

  if (!data || !ctx) return <Loading />;
  if (!data.ready) return <Empty>A base de anúncios ainda está sendo preparada. Atualize a página em alguns instantes.</Empty>;

  const inBiz = ctx.rows.filter((r) => biz === 'all' || r.business_id === Number(biz));
  const qn = f.q.trim().toLowerCase();
  const filtered = inBiz.filter((r) =>
    (!f.channel || r.channel_id === Number(f.channel))
    && (!f.account || r.account_id === Number(f.account))
    && (!f.resp || (f.resp === 'me' ? (r.responsible_id || r.adOwner) === me.id || r.owner === me.id : f.resp === 'none' ? !(r.responsible_id || r.adOwner) : (r.responsible_id || r.adOwner) === Number(f.resp) || r.owner === Number(f.resp)))
    && (!f.cls || r.classification === f.cls)
    && (!f.level || levelOf(r.score)?.[1] === f.level)
    && (!f.prio || r.prio === Number(f.prio))
    && (!f.pending || r.pending > 0)
    && (!f.missing || (f.missing === 'noid' ? !r.ad_code : !r.checks?.[f.missing]))
    && (!qn || [r.sku, r.ad_code, r.title, r.link, r.notes].some((v) => (v || '').toLowerCase().includes(qn))));
  const val = {
    prio: (r) => r.prio * 1000 + (r.score ?? 101), score: (r) => r.score ?? -1, cliente: (r) => ctx.bizName(r.business_id), mkt: (r) => ctx.ch(r.channel_id).name,
    conta: (r) => ctx.acc.get(r.account_id)?.name || '', sku: (r) => (r.sku || '').toLowerCase(), ad: (r) => r.ad_code || '', cls: (r) => ({ alta: 0, estrategico: 1, geral: 2 }[r.classification]),
    resp: (r) => ctx.pname(r.responsible_id), upd: (r) => r.updated_at, notes: (r) => r.notes || '',
    ...Object.fromEntries(CHECKS.map(([k]) => [k, (r) => ({ ok: 0, na: 2 }[r.checks?.[k]?.s] ?? 1)])),
  };
  const sorted = [...filtered].sort((a, b) => { const x = val[sort.k]?.(a), y = val[sort.k]?.(b); return (x > y ? 1 : x < y ? -1 : a.id - b.id) * sort.dir; });
  const PER = 100;
  const pages = Math.max(1, Math.ceil(sorted.length / PER));
  const shown = sorted.slice(page * PER, page * PER + PER);

  // ---- alterações ----
  const localChange = (ids, fn) => setData((d) => ({ ...d, ads: d.ads.map((a) => (ids.includes(a.id) ? fn(a) : a)) }));
  const patch = async (ad, body) => {
    localChange([ad.id], (a) => {
      const n = { ...a, ...body, updated_at: new Date().toISOString() };
      if (body.check) { const c = { ...a.checks }; if (body.check.state) c[body.check.key] = { s: body.check.state, by: me.id, name: me.name, at: new Date().toISOString() }; else delete c[body.check.key]; n.checks = c; delete n.check; }
      if ('ad' in body) { delete n.ad; }
      return n;
    });
    try { const row = await api(`/ads/${ad.id}`, { method: 'PATCH', body }); localChange([ad.id], () => row); }
    catch (e) { toast(e.message, 'error'); reload(); }
  };
  const bulk = async (change, label) => {
    const ids = [...sel];
    try { const r = await api('/ads/bulk', { method: 'POST', body: { ids, change } }); toast(`${r.updated} anúncio(s) ${label}`, 'success'); emitLocal(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const toggleSel = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  const allShownSel = shown.length > 0 && shown.every((r) => sel.has(r.id));
  const setFilter = (k, v) => setF({ ...f, [k]: v });

  // ---- indicadores (respeitam os filtros) ----
  const ind = {
    total: filtered.length,
    noar: filtered.filter((r) => r.checks?.anuncio?.s === 'ok').length,
    alta: filtered.filter((r) => r.classification === 'alta').length,
    estr: filtered.filter((r) => r.classification === 'estrategico').length,
    geral: filtered.filter((r) => r.classification === 'geral').length,
    media: (() => { const s = filtered.filter((r) => r.score != null); return s.length ? Math.round(s.reduce((a, r) => a + r.score, 0) / s.length) : null; })(),
    criticos: filtered.filter((r) => r.score != null && r.score < 40).length,
    completos: filtered.filter((r) => r.pending === 0 && r.ad_code).length,
    pend: filtered.reduce((a, r) => a + r.pending, 0),
    urgentes: filtered.filter((r) => r.prio <= 2).length,
  };
  const pct = (n) => (ind.total ? Math.round((n / ind.total) * 100) : 0);

  // marketplaces/contas existentes no recorte
  const chansHere = [...new Set(inBiz.map((r) => r.channel_id))].map((id) => ctx.ch(id) && { ...ctx.ch(id), id, n: inBiz.filter((r) => r.channel_id === id).length }).sort((a, b) => b.n - a.n);
  const accHere = (data.accounts || []).filter((a) => (biz === 'all' || a.business_id === Number(biz)) && (!f.channel || a.channel_id === Number(f.channel)));
  const bizCounts = (id) => ctx.rows.filter((r) => r.business_id === id).length;

  // ---- colunas ----
  const showClient = biz === 'all';
  const COLS = [
    ['cliente', 'Cliente', 120, true], ['mkt', 'Marketplace', 104, true], ['conta', 'Conta', 104, true], ['sku', 'SKU', 120, true], ['ad', 'Anúncio', 150, true],
    ['score', 'Pontuação', 92], ['prio', 'Prioridade', 92],
    ...CHECKS.map(([k, l, , p]) => [k, l, 62, false, p]),
    ['resp', 'Responsável', 130], ['estr', 'Estratégico', 110], ['notes', 'Observações', 220], ['upd', 'Última atualização', 120],
  ].filter(([k]) => (k !== 'cliente' || showClient) && !hidden.includes(k));
  let left = 34;
  const stick = {};
  for (const [k, , w, s] of COLS) if (s) { stick[k] = left; left += w; }
  const lastSticky = Object.keys(stick).pop();
  const th = (k, label, w, p) => (
    <th key={k} style={{ width: w, minWidth: w, left: stick[k], '--pc': p ? PILLARS[p][1] : undefined }}
      className={(k in stick ? 'stk' : '') + (k === lastSticky ? ' stk-last' : '') + (p ? ' chk-h' : '') + (sort.k === k ? ' sorted' : '')}
      onClick={() => setSort({ k, dir: sort.k === k ? -sort.dir : 1 })} title={p ? CHECKS.find((c) => c[0] === k)[2] + ' — clique para ordenar' : 'Clique para ordenar'}>
      {label}{sort.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="ads-page">
      <div className="ads-head">
        <h1 className="grow">Anúncios</h1>
        <div className="ads-actions">
          <button className="btn primary" onClick={() => setModal({ t: 'new' })}><Icon name="plus" size={15} /> Anúncio</button>
          <button className="btn" onClick={() => setModal({ t: 'import' })}><Icon name="download" size={15} /> Importar anúncios</button>
          <button className="btn" disabled title="Parte 2: importação da base de vendas (curva atual e faturamento)">Importar vendas <small className="soon">em breve</small></button>
          <button className="btn" disabled title="Parte 2: importação do planejamento comercial (Forecast)">Importar Forecast <small className="soon">em breve</small></button>
          <MoreMenu isAdmin={isAdmin} onPick={(t) => setModal({ t })} />
        </div>
      </div>
      <div className="biz-chips">
            <button className={biz === 'all' ? 'on' : ''} onClick={() => setBiz('all')}>Todos os clientes <small>{ctx.rows.length}</small></button>
            {businesses.map((b) => <button key={b.id} className={String(biz) === String(b.id) ? 'on' : ''} style={{ '--c': b.color }} onClick={() => { setBiz(b.id); setF({ ...f, channel: '', account: '' }); }}><i />{b.name} <small>{bizCounts(b.id)}</small></button>)}
      </div>

      <div className="ads-kpis">
        <Kp l="Anúncios" v={ind.total} />
        <Kp l="No ar" v={ind.noar} s={`${pct(ind.noar)}%`} />
        <Kp l="Alta performance" v={ind.alta} c={CLASS.alta[1]} onClick={() => setFilter('cls', f.cls === 'alta' ? '' : 'alta')} on={f.cls === 'alta'} />
        <Kp l="Estratégicos" v={ind.estr} c={CLASS.estrategico[1]} onClick={() => setFilter('cls', f.cls === 'estrategico' ? '' : 'estrategico')} on={f.cls === 'estrategico'} />
        <Kp l="Gerais" v={ind.geral} c={CLASS.geral[1]} onClick={() => setFilter('cls', f.cls === 'geral' ? '' : 'geral')} on={f.cls === 'geral'} />
        <Kp l="Pontuação média" v={ind.media ?? '—'} c={levelOf(ind.media)?.[2]} s={levelOf(ind.media)?.[1]} />
        <Kp l="Críticos" v={ind.criticos} c="#e2445c" onClick={() => setFilter('level', f.level === 'Crítico' ? '' : 'Crítico')} on={f.level === 'Crítico'} />
        <Kp l="Completos" v={`${pct(ind.completos)}%`} s={`${ind.completos} anúncio(s)`} />
        <Kp l="Pendências" v={ind.pend} c="#fdab3d" onClick={() => setFilter('pending', !f.pending)} on={f.pending} />
        <Kp l="Prioridade urgente/alta" v={ind.urgentes} c="#e2445c" onClick={() => setFilter('prio', f.prio ? '' : '1')} on={f.prio === '1'} />
      </div>

      {chansHere.length > 0 && (
        <div className="mkt-chips">
          <button className={!f.channel ? 'on' : ''} onClick={() => setF({ ...f, channel: '', account: '' })}>Consolidado</button>
          {chansHere.map((c) => <button key={c.id} className={String(f.channel) === String(c.id) ? 'on' : ''} onClick={() => setF({ ...f, channel: String(c.id), account: '' })}><span className="chan" style={{ background: c.color }}>{c.name}</span> {c.n}</button>)}
          {f.channel && accHere.length > 1 && (
            <select className="sm" value={f.account} onChange={(e) => setFilter('account', e.target.value)}>
              <option value="">Todas as contas</option>{accHere.map((a) => <option key={a.id} value={a.id}>{a.name}{showClient ? ` — ${ctx.bizName(a.business_id)}` : ''}</option>)}
            </select>
          )}
        </div>
      )}

      <div className="ads-filters">
        <input className="search" placeholder="Buscar SKU, anúncio, produto ou observação…" value={f.q} onChange={(e) => setFilter('q', e.target.value)} />
        <select value={f.resp} onChange={(e) => setFilter('resp', e.target.value)}>
          <option value="">Todos os responsáveis</option><option value="me">Meus anúncios</option><option value="none">Sem responsável</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={f.cls} onChange={(e) => setFilter('cls', e.target.value)}>
          <option value="">Todas as classificações</option>{Object.entries(CLASS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={f.level} onChange={(e) => setFilter('level', e.target.value)}>
          <option value="">Todas as pontuações</option>{[...LEVELS].reverse().map(([min, l]) => <option key={l} value={l}>{l} ({min}+)</option>)}
        </select>
        <select value={f.prio} onChange={(e) => setFilter('prio', e.target.value)}>
          <option value="">Todas as prioridades</option>{Object.entries(PRIO).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={f.missing} onChange={(e) => setFilter('missing', e.target.value)}>
          <option value="">Pendência: qualquer</option><option value="noid">Sem ID do anúncio</option>
          {CHECKS.map(([k, , l]) => <option key={k} value={k}>Falta: {l}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={f.pending} onChange={(e) => setFilter('pending', e.target.checked)} /> Só com pendências</label>
        {Object.values(f).some(Boolean) && <button className="link small" onClick={() => setF({ channel: '', account: '', resp: '', cls: '', level: '', prio: '', q: '', pending: false, missing: '' })}>Limpar filtros</button>}
        <span className="grow" />
        <ColumnsMenu hidden={hidden} setHidden={setHidden} />
      </div>

      {sel.size > 0 && <BulkBar n={sel.size} people={people} isAdmin={isAdmin} total={sorted.length} onAll={() => setSel(new Set(sorted.map((r) => r.id)))} onClear={() => setSel(new Set())} bulk={bulk} />}

      {!sorted.length ? <Empty>Nenhum anúncio {inBiz.length ? 'com esses filtros' : 'cadastrado ainda — use "+ Anúncio" ou "Importar anúncios"'}.</Empty> : (
        <div className="sheet-wrap">
          <table className="sheet">
            <thead><tr>
              <th className="stk sel-c" style={{ left: 0, width: 34, minWidth: 34 }}><input type="checkbox" checked={allShownSel} onChange={() => { const s = new Set(sel); shown.forEach((r) => (allShownSel ? s.delete(r.id) : s.add(r.id))); setSel(s); }} /></th>
              {COLS.map(([k, l, w, , p]) => (k === 'estr' ? <th key={k} style={{ width: w, minWidth: w }} title="Responsável pela parte estratégica deste cliente neste marketplace">{l}</th> : th(k, l, w, p)))}
            </tr></thead>
            <tbody>
              {shown.map((r) => <Row key={r.id} r={r} cols={COLS} stick={stick} lastSticky={lastSticky} ctx={ctx} people={people} me={me} sel={sel.has(r.id)} onSel={() => toggleSel(r.id)} patch={patch} accounts={data.accounts} />)}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="pager">
          <button className="btn sm" disabled={!page} onClick={() => setPage(page - 1)}><Icon name="left" size={14} /></button>
          <span>{page * PER + 1}–{Math.min(sorted.length, page * PER + PER)} de {sorted.length}</span>
          <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><Icon name="right" size={14} /></button>
        </div>
      )}
      <p className="muted small legend">Clique no quadradinho do checklist para alternar: <span className="ck ok">✓</span> feito → <span className="ck na">N/A</span> não se aplica (não conta na pontuação) → <span className="ck">&nbsp;</span> pendente. Passe o mouse para ver quem marcou.</p>

      {modal?.t === 'new' && <NewAd onClose={() => setModal(null)} biz={biz} accounts={data.accounts} people={people} />}
      {modal?.t === 'import' && <ImportAds onClose={() => setModal(null)} biz={biz} accounts={data.accounts} />}
      {modal?.t === 'accounts' && <Accounts onClose={() => setModal(null)} biz={biz} data={data} people={people} />}
      {modal?.t === 'weights' && <Weights onClose={() => setModal(null)} data={data} />}
      {modal?.t === 'imports' && <ImportsLog onClose={() => setModal(null)} />}
    </div>
  );
}

const Kp = ({ l, v, s, c, onClick, on }) => (
  <div className={'kp' + (onClick ? ' click' : '') + (on ? ' on' : '')} onClick={onClick} style={{ '--kc': c || '#323338' }}>
    <small>{l}</small><b>{v}</b>{s && <span>{s}</span>}
  </div>
);

function MoreMenu({ isAdmin, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="menu-wrap">
      <button className="btn" onClick={() => setOpen(!open)}><Icon name="menu" size={15} /> Mais</button>
      {open && (
        <div className="pop-menu" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { onPick('accounts'); setOpen(false); }}>Canais e responsáveis dos clientes</button>
          <button onClick={() => { onPick('weights'); setOpen(false); }}>Pesos da pontuação</button>
          <button onClick={() => { onPick('imports'); setOpen(false); }}>Histórico de importações</button>
          {isAdmin && <a href="/api/admin/backup" onClick={() => setOpen(false)}>Baixar cópia completa dos dados</a>}
        </div>
      )}
    </span>
  );
}

function ColumnsMenu({ hidden, setHidden }) {
  const [open, setOpen] = useState(false);
  const opts = [['cliente', 'Cliente'], ['conta', 'Conta'], ['score', 'Pontuação'], ['prio', 'Prioridade'], ...CHECKS.map(([k, , l]) => [k, l]), ['resp', 'Responsável'], ['estr', 'Estratégico'], ['notes', 'Observações'], ['upd', 'Última atualização']];
  return (
    <span className="menu-wrap">
      <button className="btn sm" onClick={() => setOpen(!open)}><Icon name="list" size={14} /> Colunas{hidden.length ? ` (${hidden.length} ocultas)` : ''}</button>
      {open && (
        <div className="pop-menu right cols" onMouseLeave={() => setOpen(false)}>
          {opts.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={!hidden.includes(k)} onChange={() => setHidden(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k])} /> {l}</label>)}
          {hidden.length > 0 && <button className="link small" onClick={() => setHidden([])}>Mostrar todas</button>}
        </div>
      )}
    </span>
  );
}

// ---------------- linha ----------------
const Row = React.memo(function Row({ r, cols, stick, lastSticky, ctx, people, me, sel, onSel, patch, accounts }) {
  const lv = levelOf(r.score);
  const ch = ctx.ch(r.channel_id);
  const cell = (k, w, content, cls = '') => (
    <td key={k} style={{ left: stick[k], width: w, minWidth: w }} className={(k in stick ? 'stk ' : '') + (k === lastSticky ? 'stk-last ' : '') + cls}>{content}</td>
  );
  const accs = accounts.filter((a) => a.business_id === r.business_id && a.channel_id === r.channel_id && (a.active || a.id === r.account_id));
  return (
    <tr className={(sel ? 'sel ' : '') + (r.pending ? 'has-pend' : 'done')} style={{ '--lv': lv?.[2] || '#c4c4c4' }}>
      <td className="stk sel-c" style={{ left: 0 }}><input type="checkbox" checked={sel} onChange={onSel} /></td>
      {cols.map(([k, , w]) => {
        switch (k) {
          case 'cliente': return cell(k, w, <span className="ellip" title={ctx.bizName(r.business_id)}>{ctx.bizName(r.business_id)}</span>);
          case 'mkt': return cell(k, w, <span className="chan" style={{ background: ch.color }}>{ch.name}</span>);
          case 'conta': return cell(k, w, accs.length > 1
            ? <select className="cell-sel" value={r.account_id} onChange={(e) => patch(r, { account_id: Number(e.target.value) })}>{accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            : <span className="ellip muted">{ctx.acc.get(r.account_id)?.name}</span>);
          case 'sku': return cell(k, w, <span className="sku-cell"><TextCell value={r.sku} onSave={(v) => patch(r, { sku: v })} mono placeholder="SKU" />
            {r.sku_info?.drive_link && <a className="drive-ic" href={r.sku_info.drive_link} target="_blank" rel="noreferrer" title="Pasta do Drive (fotos e vídeos)">📁</a>}</span>);
          case 'ad': return cell(k, w, <AdCell r={r} patch={patch} />, !r.ad_code ? 'miss' : '');
          case 'cls': return cell(k, w, <select className="cls-sel" style={{ '--cc': CLASS[r.classification][1] }} value={r.classification} onChange={(e) => patch(r, { classification: e.target.value })}>
            {Object.entries(CLASS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}</select>);
          case 'score': return cell(k, w, r.score == null ? <span className="muted">—</span>
            : <span className="score" style={{ '--sc': lv[2] }} title={`${lv[1]}\n` + Object.entries(r.pillars).map(([p, [g, m]]) => `${PILLARS[p][0]}: ${g}/${m}`).join('\n') + `\n${r.pending} pendência(s)`}><b>{r.score}</b><i style={{ width: `${r.score}%` }} /></span>);
          case 'prio': return cell(k, w, <span className="prio" style={{ '--pc': PRIO[r.prio][1] }}>{PRIO[r.prio][0]}</span>);
          case 'resp': return cell(k, w, <select className={'cell-sel' + (r.responsible_id === me.id ? ' mine' : '')} value={r.responsible_id || ''} onChange={(e) => patch(r, { responsible_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{r.adOwner ? `— ${(ctx.pname(r.adOwner) || '').split(' ')[0]} (do canal) —` : '— ninguém —'}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>, !r.responsible_id && !r.adOwner ? 'miss' : '');
          case 'estr': return cell(k, w, r.owner ? <span className={'ellip small' + (r.owner === me.id ? ' mine' : '')}>{r.owner === me.id ? 'Você' : (ctx.pname(r.owner) || '').split(' ')[0]}</span> : <span className="muted small">—</span>);
          case 'notes': return cell(k, w, <TextCell value={r.notes} onSave={(v) => patch(r, { notes: v })} placeholder="Observações…" />);
          case 'upd': return cell(k, w, <span className="small muted" title={r.updated_at ? new Date(r.updated_at).toLocaleString('pt-BR') : ''}>{ago(r.updated_at)}</span>);
          default: {
            const st = r.checks?.[k];
            const wk = Number(r.w[k]) || 0;
            const next = !st ? 'ok' : st.s === 'ok' ? 'na' : null;
            return cell(k, w, (
              <button className={'ck' + (st?.s === 'ok' ? ' ok' : st?.s === 'na' ? ' na' : wk ? ' pend' : '')}
                title={`${CHECKS.find((c) => c[0] === k)[2]} · ${wk} ponto(s)` + (st ? `\n${st.s === 'ok' ? 'Feito' : 'Não se aplica'} por ${st.name || '?'} em ${st.at ? new Date(st.at).toLocaleString('pt-BR') : '?'}` : '\nPendente')}
                onClick={() => patch(r, { check: { key: k, state: next } })}>{st?.s === 'ok' ? '✓' : st?.s === 'na' ? 'N/A' : ''}</button>
            ), 'ck-c');
          }
        }
      })}
    </tr>
  );
});

function TextCell({ value, onSave, placeholder, mono }) {
  const [v, setV] = useState(value || '');
  const ref = useRef(null);
  useEffect(() => { if (document.activeElement !== ref.current) setV(value || ''); }, [value]);
  const save = () => { if ((v || '').trim() !== (value || '')) onSave(v.trim() || null); };
  return <input ref={ref} className={'cell-in' + (mono ? ' mono' : '')} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={save}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(value || ''); setTimeout(() => e.target.blur()); } }} />;
}
function AdCell({ r, patch }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState('');
  if (edit) {
    return <input className="cell-in" autoFocus value={v} placeholder="Cole o link ou o ID" onChange={(e) => setV(e.target.value)}
      onBlur={() => { setEdit(false); if (v.trim() && v.trim() !== (r.link || r.ad_code)) patch(r, { ad: v.trim() }); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(''); setEdit(false); } }} />;
  }
  return (
    <span className="ad-cell">
      {r.ad_code ? <span className="mono ellip" title={r.title || r.ad_code} onDoubleClick={() => { setV(r.link || r.ad_code); setEdit(true); }}>{r.ad_code}</span>
        : <button className="link small warn" onClick={() => { setV(''); setEdit(true); }}>+ ID / link</button>}
      {r.link && <a href={r.link} target="_blank" rel="noreferrer" title="Abrir anúncio">↗</a>}
      {r.ad_code && <button className="icon-mini" title="Editar ID / link" onClick={() => { setV(r.link || r.ad_code); setEdit(true); }}>✎</button>}
    </span>
  );
}

function BulkBar({ n, total, people, isAdmin, onAll, onClear, bulk }) {
  const [key, setKey] = useState('');
  return (
    <div className="bulk-bar">
      <b>{n} selecionado(s)</b>
      {n < total && <button className="link small" onClick={onAll}>Selecionar todos os {total} filtrados</button>}
      <span className="sep" />
      <select value="" onChange={(e) => e.target.value && bulk({ classification: e.target.value }, 'reclassificados')}>
        <option value="">Classificar como…</option>{Object.entries(CLASS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <select value="" onChange={(e) => e.target.value && bulk({ responsible_id: e.target.value === 'none' ? null : Number(e.target.value) }, 'atualizados')}>
        <option value="">Responsável…</option><option value="none">— ninguém —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select value={key} onChange={(e) => setKey(e.target.value)}>
        <option value="">Checklist…</option>{CHECKS.map(([k, , l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {key && <>
        <button className="btn xs" onClick={() => bulk({ check: { key, state: 'ok' } }, 'marcados como feito')}>✓ Feito</button>
        <button className="btn xs" onClick={() => bulk({ check: { key, state: 'na' } }, 'marcados como N/A')}>N/A</button>
        <button className="btn xs" onClick={() => bulk({ check: { key, state: null } }, 'voltaram para pendente')}>Pendente</button>
      </>}
      {isAdmin && <button className="btn xs danger" onClick={() => confirm(`Arquivar ${n} anúncio(s)? Eles saem da planilha, mas continuam guardados.`) && bulk({ archived: true }, 'arquivados')}>Arquivar</button>}
      <span className="grow" />
      <button className="link small" onClick={onClear}>Limpar seleção</button>
    </div>
  );
}

// ---------------- modais ----------------
function AccountPicker({ bizId, chId, accounts, value, onChange }) {
  const list = accounts.filter((a) => a.business_id === Number(bizId) && a.channel_id === Number(chId) && a.active);
  useEffect(() => { if (list.length && !list.some((a) => a.id === Number(value))) onChange(String(list[0].id)); }, [bizId, chId, accounts.length]); // eslint-disable-line
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={!bizId || !chId}>
      {!list.length && <option value="">Conta principal (será criada)</option>}
      {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

function NewAd({ onClose, biz, accounts, people }) {
  const { businesses, channels } = useApp();
  const [f, setF] = useState({ business_id: biz !== 'all' ? String(biz) : '', channel_id: '', account_id: '', ad: '', sku: '', title: '', classification: 'geral', responsible_id: '' });
  const [busy, setBusy] = useState(false);
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { await api('/ads', { method: 'POST', body: { ...f, account_id: f.account_id || null } }); toast('Anúncio cadastrado', 'success'); emitLocal(); onClose(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Novo anúncio" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.business_id || !f.channel_id} onClick={save}>Cadastrar</button></>}>
      <div className="grid2">
        <Field label="Cliente"><select value={f.business_id} onChange={s('business_id')}><option value="">Escolha…</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Marketplace"><select value={f.channel_id} onChange={s('channel_id')}><option value="">Escolha…</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Conta"><AccountPicker bizId={f.business_id} chId={f.channel_id} accounts={accounts} value={f.account_id} onChange={(v) => setF((x) => ({ ...x, account_id: v }))} /></Field>
        <Field label="Classificação"><select value={f.classification} onChange={s('classification')}>{Object.entries(CLASS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <Field label="Anúncio (link ou ID)" hint="Pode deixar em branco e preencher depois — o anúncio fica marcado como pendente."><input value={f.ad} onChange={s('ad')} placeholder="https://… ou MLB123…" /></Field>
      <div className="grid2">
        <Field label="SKU"><input value={f.sku} onChange={s('sku')} /></Field>
        <Field label="Responsável (anúncio e alta performance)"><select value={f.responsible_id} onChange={s('responsible_id')}><option value="">— ninguém —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      </div>
      <Field label="Produto / título"><input value={f.title} onChange={s('title')} /></Field>
    </Modal>
  );
}

function Accounts({ onClose, biz, data, people }) {
  return <Modal title="Canais e responsáveis dos clientes" onClose={onClose} wide><AccountsPanel biz={biz} data={data} people={people} /></Modal>;
}
export function AccountsPanel({ biz, data, people }) {
  const { businesses, channels, isAdmin } = useApp();
  const [only, setOnly] = useState(biz && biz !== 'all' ? String(biz) : '');
  const [adding, setAdding] = useState({});
  const call = async (path, method, body) => { try { const r = await api(path, { method, body }); emitLocal(); return r; } catch (e) { toast(e.message, 'error'); return null; } };
  const accs = (bId, chId) => data.accounts.filter((a) => a.business_id === bId && a.channel_id === chId);
  const own = (bId, chId) => data.owners.find((o) => o.business_id === bId && o.channel_id === chId) || {};
  const adsOf = (bId, chId) => data.ads.filter((a) => a.business_id === bId && a.channel_id === chId);
  const count = (accId) => data.ads.filter((a) => a.account_id === accId).length;
  const active = (bId, chId) => accs(bId, chId).some((a) => a.active);
  const pname = (id) => people.find((p) => p.id === id)?.name || '—';
  const enable = async (bId, chId) => {
    const list = accs(bId, chId);
    if (list.length) { for (const a of list) await call(`/mkt-accounts/${a.id}`, 'PATCH', { active: true }); }
    else await call('/mkt-accounts', 'POST', { business_id: bId, channel_id: chId, name: 'Conta principal' });
  };
  const disable = async (bId, chId) => {
    const n = adsOf(bId, chId).length;
    if (!confirm(n ? `Tirar este canal do cliente? Os ${n} anúncio(s) continuam guardados na planilha; a conta só deixa de aparecer para novos cadastros.` : 'Tirar este canal do cliente?')) return;
    for (const a of accs(bId, chId).filter((x) => x.active)) await call(`/mkt-accounts/${a.id}`, 'PATCH', { active: false });
  };
  const setOwner = async (bId, chId, kind, userId) => {
    let apply = null;
    if (kind === 'anuncio' && userId) {
      const list = adsOf(bId, chId);
      const other = list.filter((a) => a.responsible_id !== Number(userId)).length;
      const empty = list.filter((a) => !a.responsible_id).length;
      if (other) {
        apply = confirm(`Passar os ${other} anúncio(s) deste canal para ${pname(Number(userId))}?\n\nOK = todos os anúncios do canal\nCancelar = só os que estão sem responsável (${empty})`) ? 'all' : 'empty';
      }
    }
    const r = await call('/client-channel-owner', 'PUT', { business_id: bId, channel_id: chId, user_id: userId || null, kind, apply });
    if (r?.applied) toast(`${r.applied} anúncio(s) passaram para ${pname(Number(userId))}`, 'success');
  };
  const list = businesses.filter((x) => !only || String(x.id) === only);
  return (
    <div>
      <div className="row gap wrap" style={{ marginBottom: 10 }}>
        <select value={only} onChange={(e) => setOnly(e.target.value)}><option value="">Todos os clientes</option>{businesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <span className="muted small grow">Cada cliente tem seus próprios canais. Em cada canal: o <b>responsável pelo anúncio</b> (cadastro, anúncio no ar, fotos e vídeo) e o <b>responsável estratégico</b> (ADS, afiliados, promoção, cupom e oferta relâmpago). Um canal pode ter várias contas (ex.: conta principal e secundária).</span>
      </div>
      <div className="client-ch-list">
        {list.map((x) => {
          const on = channels.filter((c) => active(x.id, c.id));
          const off = channels.filter((c) => !active(x.id, c.id));
          return (
            <div key={x.id} className="client-ch" style={{ '--c': x.color }}>
              <div className="client-ch-head"><i /><b>{x.name}</b><small className="muted">{on.length} canal(is) · {data.ads.filter((a) => a.business_id === x.id).length} anúncio(s)</small>
                <span className="grow" />
                {isAdmin && off.length > 0 && (
                  <select className="sm" value="" onChange={(e) => e.target.value && enable(x.id, Number(e.target.value))}>
                    <option value="">+ Adicionar canal…</option>{off.map((c) => <option key={c.id} value={c.id}>{c.name}{accs(x.id, c.id).length ? ' (reativar)' : ''}</option>)}
                  </select>
                )}
              </div>
              {!on.length ? <p className="muted small" style={{ margin: '6px 0 2px' }}>Nenhum canal ainda — use "+ Adicionar canal".</p> : (
                <table className="acc-table">
                  <thead><tr><th style={{ width: 150 }}>Canal</th><th>Contas</th><th style={{ width: 200 }}>Responsável anúncio</th><th style={{ width: 200 }}>Responsável estratégico</th><th style={{ width: 30 }} /></tr></thead>
                  <tbody>
                    {on.map((c) => {
                      const o = own(x.id, c.id);
                      const k = `${x.id}:${c.id}`;
                      return (
                        <tr key={c.id}>
                          <td><span className="chan" style={{ background: c.color }}>{c.name}</span> <small className="muted">{adsOf(x.id, c.id).length}</small></td>
                          <td><div className="acc-list">
                            {accs(x.id, c.id).map((a) => (
                              <span key={a.id} className={'acc-pill' + (a.active ? '' : ' off')}>
                                {isAdmin ? <input defaultValue={a.name} onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && call(`/mkt-accounts/${a.id}`, 'PATCH', { name: e.target.value })} /> : a.name}
                                <small>{count(a.id)}</small>
                                {isAdmin && accs(x.id, c.id).length > 1 && <button className="icon-mini" title={a.active ? 'Desativar conta' : 'Reativar conta'} onClick={() => call(`/mkt-accounts/${a.id}`, 'PATCH', { active: !a.active })}>{a.active ? '⏸' : '▶'}</button>}
                              </span>
                            ))}
                            {isAdmin && (adding[k] != null
                              ? <input className="sm" autoFocus placeholder="Nome da conta (Enter)" value={adding[k]} onChange={(e) => setAdding({ ...adding, [k]: e.target.value })}
                                onKeyDown={async (e) => { if (e.key === 'Enter' && adding[k].trim()) { await call('/mkt-accounts', 'POST', { business_id: x.id, channel_id: c.id, name: adding[k] }); setAdding({ ...adding, [k]: undefined }); } if (e.key === 'Escape') setAdding({ ...adding, [k]: undefined }); }}
                                onBlur={() => setAdding({ ...adding, [k]: undefined })} />
                              : <button className="link small" onClick={() => setAdding({ ...adding, [k]: '' })}>+ conta</button>)}
                          </div></td>
                          {['anuncio', 'estrategico'].map((kind) => {
                            const v = kind === 'anuncio' ? o.ad_user_id : o.user_id;
                            return <td key={kind}>{isAdmin
                              ? <select className="sm" value={v || ''} onChange={(e) => setOwner(x.id, c.id, kind, e.target.value)}><option value="">— ninguém —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                              : pname(v)}</td>;
                          })}
                          <td>{isAdmin && <button className="icon-mini" title="Tirar este canal do cliente" onClick={() => disable(x.id, c.id)}>✕</button>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Weights({ onClose, data }) {
  return <Modal title="Pesos da pontuação" onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Fechar</button>}><WeightsPanel data={data} /></Modal>;
}
export function WeightsPanel({ data }) {
  const { channels, isAdmin } = useApp();
  const [scope, setScope] = useState({ channel_id: '', classification: '' });
  const own = (data.config || []).find((x) => String(x.channel_id || '') === scope.channel_id && (x.classification || '') === scope.classification);
  const base = weightsFor(data, scope.channel_id ? Number(scope.channel_id) : null, scope.classification || null);
  const [w, setW] = useState(base);
  useEffect(() => setW(weightsFor(data, scope.channel_id ? Number(scope.channel_id) : null, scope.classification || null)), [scope.channel_id, scope.classification, data]); // eslint-disable-line
  const total = (p) => CHECKS.filter((c) => c[3] === p).reduce((a, [k]) => a + (Number(w[k]) || 0), 0);
  const sum = CHECKS.reduce((a, [k]) => a + (Number(w[k]) || 0), 0);
  const save = async (reset) => {
    try { await api('/score-config', { method: 'PUT', body: { ...scope, weights: w, reset } }); toast(reset ? 'Ajuste removido — volta a usar o padrão' : 'Pesos salvos', 'success'); emitLocal(); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <p className="muted small" style={{ marginTop: 0 }}>A pontuação vai de 0 a 100: soma os pesos dos itens feitos e divide pelo total dos itens que se aplicam. Itens marcados como <b>N/A</b> (ou com peso 0) não prejudicam a nota. O sistema usa o ajuste mais específico que existir: marketplace + classificação → marketplace → classificação → padrão.</p>
      <div className="grid2">
        <Field label="Marketplace"><select value={scope.channel_id} onChange={(e) => setScope({ ...scope, channel_id: e.target.value })}><option value="">Todos (padrão)</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Classificação"><select value={scope.classification} onChange={(e) => setScope({ ...scope, classification: e.target.value })}><option value="">Todas (padrão)</option>{Object.entries(CLASS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      {!own && (scope.channel_id || scope.classification) && <p className="small warn-txt">Ainda não há ajuste para este recorte — mostrando os pesos que valem hoje. Ao salvar, cria um ajuste só para ele.</p>}
      <div className="weights-grid">
        {Object.entries(PILLARS).map(([p, [l, c]]) => (
          <div key={p} className="w-pillar" style={{ '--pc': c }}>
            <div className="w-head"><b>{l}</b><span>{total(p)} pts</span></div>
            {CHECKS.filter((x) => x[3] === p).map(([k, , lab]) => (
              <label key={k} className="w-row"><span>{lab}</span><input type="number" min="0" max="100" disabled={!isAdmin} value={w[k] ?? 0} onChange={(e) => setW({ ...w, [k]: e.target.value })} /></label>
            ))}
          </div>
        ))}
      </div>
      <p className="small">Total: <b>{sum}</b> pontos {sum !== 100 && <span className="muted">(não precisa somar 100 — a nota é sempre convertida para 0–100)</span>}</p>
      <p className="muted small">Níveis: {[...LEVELS].reverse().map(([m, l, c]) => <span key={l} className="lvl" style={{ '--lc': c }}>{l} {m}+</span>)}</p>
      {isAdmin && <div className="row gap-s">{own && (scope.channel_id || scope.classification) && <button className="btn" onClick={() => save(true)}>Remover este ajuste</button>}<span className="grow" /><button className="btn primary" onClick={() => save(false)}>Salvar pesos</button></div>}
    </div>
  );
}

function ImportsLog({ onClose }) {
  const { data } = useData('/ads/imports');
  return (
    <Modal title="Histórico de importações" onClose={onClose} wide>
      {!data ? <Loading /> : !data.length ? <Empty>Nenhuma importação ainda.</Empty> : (
        <table className="plain-table">
          <thead><tr><th>Quando</th><th>Tipo</th><th>Cliente / marketplace / conta</th><th>Arquivo</th><th>Resultado</th><th>Por</th></tr></thead>
          <tbody>{data.map((i) => (
            <tr key={i.id}><td>{fmtDateTime(i.created_at)}</td><td>{i.kind}</td><td>{i.business} · {i.channel} · {i.account}</td><td className="small">{i.filename}</td>
              <td className="small">{i.counts ? `${i.counts.novos} novos, ${i.counts.atualizar} atualizados, ${i.counts.iguais} iguais${i.counts.sem_id ? `, ${i.counts.sem_id} sem ID` : ''}` : '—'}</td><td>{i.user_name}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  );
}

const FIELD_LABEL = { ad_code: 'ID do anúncio *', link: 'Link do anúncio', sku: 'SKU', title: 'Produto / título', status: 'Status', price: 'Preço', stock: 'Estoque' };
function ImportAds({ onClose, biz, accounts }) {
  const { businesses, channels, isAdmin } = useApp();
  const [f, setF] = useState({ business_id: biz !== 'all' ? String(biz) : '', channel_id: '', account_id: '' });
  const [file, setFile] = useState(null);
  const [pv, setPv] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (extra = {}) => {
    if (!file || !f.business_id || !f.channel_id) return;
    setBusy(true);
    try {
      let accountId = f.account_id;
      if (!accountId) { // cria a conta principal se ainda não existir
        if (!isAdmin) throw new Error('Este cliente ainda não tem conta neste marketplace. Peça a um administrador para criar.');
        const a = await api('/mkt-accounts', { method: 'POST', body: { business_id: f.business_id, channel_id: f.channel_id, name: 'Conta principal' } });
        accountId = String(a.id); setF((x) => ({ ...x, account_id: accountId })); emitLocal();
      }
      const body = { ...f, account_id: accountId, filename: file.name, data: file.data, header_row: pv?.header_row, mapping: pv?.mapping, ...extra };
      setPv(await api('/ads/import/preview', { method: 'POST', body }));
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  useEffect(() => { setPv(null); }, [f.business_id, f.channel_id, f.account_id]);
  useEffect(() => { if (file && !pv) run({ header_row: undefined, mapping: undefined }); }, [file, f.account_id]); // eslint-disable-line
  const pick = async (e) => { const x = e.target.files[0]; if (!x) return; setPv(null); setFile({ name: x.name, data: await fileToData(x) }); };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api('/ads/import/apply', { method: 'POST', body: { ...f, filename: file.name, data: file.data, header_row: pv.header_row, mapping: pv.mapping } });
      toast(`Importado: ${r.novos} novo(s), ${r.atualizar} atualizado(s), ${r.iguais} sem mudança`, 'success'); emitLocal(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const setMap = (field, idx) => { const m = { ...pv.mapping }; if (idx === '') delete m[field]; else m[field] = Number(idx); run({ mapping: m }); };
  return (
    <Modal title="Importar base de anúncios" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !pv?.ready || !(pv.counts.novos + pv.counts.atualizar)} onClick={apply}>
        {pv?.ready ? `Confirmar: ${pv.counts.novos} novo(s) e ${pv.counts.atualizar} atualização(ões)` : 'Confirmar importação'}</button></>}>
      <div className="grid3">
        <Field label="1. Cliente"><select value={f.business_id} onChange={(e) => setF({ ...f, business_id: e.target.value, account_id: '' })}><option value="">Escolha…</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="2. Marketplace"><select value={f.channel_id} onChange={(e) => setF({ ...f, channel_id: e.target.value, account_id: '' })}><option value="">Escolha…</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="3. Conta"><AccountPicker bizId={f.business_id} chId={f.channel_id} accounts={accounts} value={f.account_id} onChange={(v) => setF((x) => ({ ...x, account_id: v }))} /></Field>
      </div>
      <Field label="4. Arquivo (.xlsx ou .csv)" hint="Relatório de anúncios exportado do marketplace. A combinação cliente + marketplace + conta + ID do anúncio identifica cada anúncio.">
        <input type="file" accept=".xlsx,.csv,.txt" disabled={!f.business_id || !f.channel_id} onChange={pick} />
      </Field>
      {busy && !pv && <Loading />}
      {pv && (<>
        {pv.sheets?.length > 1 && <Field label="Aba do arquivo"><select onChange={(e) => run({ sheet: Number(e.target.value), header_row: undefined, mapping: undefined })}>{pv.sheets.map((s, k) => <option key={k} value={k}>{s}</option>)}</select></Field>}
        <div className="imp-block">
          <b>5. Relacionar colunas</b> <small className="muted">— a linha de títulos é a {pv.header_row + 1}ª. Se estiver errada, clique na linha certa na amostra abaixo. O relacionamento fica salvo para as próximas importações deste marketplace.</small>
          <div className="map-grid">
            {pv.fields.map((fl) => (
              <label key={fl}><span>{FIELD_LABEL[fl]}</span>
                <select value={pv.mapping[fl] ?? ''} onChange={(e) => setMap(fl, e.target.value)}>
                  <option value="">— não importar —</option>{pv.headers.map((h, k) => <option key={k} value={k}>{h || `(coluna ${k + 1})`}</option>)}
                </select></label>
            ))}
          </div>
          <div className="sample-wrap"><table className="sample">
            <tbody>{pv.sample_rows.map((r, k) => (
              <tr key={k} className={k === pv.header_row ? 'hdr' : k < pv.header_row ? 'skip' : ''} onClick={() => k !== pv.header_row && run({ header_row: k, mapping: undefined })} title="Clique para usar esta linha como títulos">
                <th>{k + 1}</th>{r.slice(0, 14).map((c, j) => <td key={j}>{String(c).slice(0, 40)}</td>)}</tr>
            ))}</tbody>
          </table></div>
        </div>
        {!pv.ready ? <p className="warn-txt">Relacione a coluna do <b>ID do anúncio</b> (ou do link) para continuar.</p> : (
          <div className="imp-block">
            <b>6. Prévia e validação</b>
            <div className="imp-counts">
              <span className="ok">{pv.counts.novos} novos</span><span className="up">{pv.counts.atualizar} serão atualizados</span><span>{pv.counts.iguais} sem mudança</span>
              {pv.counts.sem_id > 0 && <span className="bad">{pv.counts.sem_id} linha(s) sem ID — ignoradas</span>}
              {pv.counts.repetidos_no_arquivo > 0 && <span className="warn" title={pv.dup_codes.join(', ')}>{pv.counts.repetidos_no_arquivo} ID(s) repetidos no arquivo (variações) — juntados em um</span>}
              {pv.counts.duplicados_no_sistema > 0 && <span className="bad">{pv.counts.duplicados_no_sistema} ID(s) duplicados no sistema — revise</span>}
              {pv.counts.no_sistema_fora_do_arquivo > 0 && <span>{pv.counts.no_sistema_fora_do_arquivo} anúncio(s) da conta não estão no arquivo (nada muda neles)</span>}
            </div>
            <p className="muted small">Atualizar nunca apaga checklist, classificação, responsável ou observações — só completa SKU, título, link e os dados do relatório.</p>
            <table className="plain-table small"><thead><tr><th>Linha</th><th>ID</th><th>SKU</th><th>Produto</th><th>Ação</th></tr></thead>
              <tbody>{pv.preview.map((r) => <tr key={r.line}><td>{r.line}</td><td className="mono">{r.code}</td><td>{r.sku}</td><td className="ellip" style={{ maxWidth: 300 }}>{r.title}</td><td><span className={'act ' + r.action}>{r.action}</span></td></tr>)}</tbody></table>
          </div>
        )}
      </>)}
    </Modal>
  );
}
