import React, { useState } from 'react';
import { api, toast, emitLocal, fmtDateFull } from '../lib.js';
import { Icon, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';

export const isNew = (iso) => iso && Date.now() - new Date(iso).getTime() < 7 * 864e5;
const fileToData = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });

// Catálogo de SKUs por cliente: planilha com SKU e descrição + quais canais ainda não têm anúncio
export default function SkuCatalog({ data }) {
  const { businesses, channels, isAdmin } = useApp();
  const [b, setB] = useState(String(businesses[0]?.id || ''));
  const [show, setShow] = useState('all');
  const [q, setQ] = useState('');
  const [add, setAdd] = useState({ sku: '', description: '' });
  const [busy, setBusy] = useState(false);
  const bid = Number(b);
  const chans = channels.filter((c) => data.accounts.some((a) => a.business_id === bid && a.channel_id === c.id && a.active));
  const ads = data.ads.filter((a) => a.business_id === bid);
  const cover = new Map();
  for (const a of ads) { const k = `${(a.sku || '').toLowerCase()}|${a.channel_id}`; cover.set(k, (cover.get(k) || 0) + 1); }
  const skus = data.skus.filter((s) => s.business_id === bid).map((s) => {
    const miss = chans.filter((c) => !cover.get(`${s.sku.toLowerCase()}|${c.id}`));
    return { ...s, miss, novo: isNew(s.created_at) };
  });
  const qn = q.trim().toLowerCase();
  const list = skus.filter((s) => (show === 'all' || (show === 'miss' ? s.miss.length : s.novo)) && (!qn || `${s.sku} ${s.description || ''}`.toLowerCase().includes(qn)));
  const totalMiss = skus.reduce((a, s) => a + s.miss.length, 0);
  const call = async (path, body, okMsg) => {
    setBusy(true);
    try { const r = await api(path, { method: 'POST', body }); if (okMsg) toast(okMsg(r), 'success'); emitLocal(); return r; }
    catch (e) { toast(e.message, 'error'); return null; } finally { setBusy(false); }
  };
  const upload = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    await call('/skus/import', { business_id: bid, filename: f.name, data: await fileToData(f) }, (r) => `Planilha lida: ${r.novos} SKU(s) novo(s), ${r.atualizados} atualizado(s), ${r.iguais} sem mudança`);
  };
  const createAds = (items) => {
    if (!items.length) return;
    if (items.length > 1 && !confirm(`Criar ${items.length} anúncio(s) pendente(s) (sem link do anúncio e sem Drive) na planilha de Anúncios?`)) return;
    call('/skus/create-ads', { business_id: bid, items }, (r) => `${r.created} anúncio(s) criado(s) como pendentes`);
  };
  const patch = async (s, body) => { try { await api(`/skus/${s.id}`, { method: 'PATCH', body }); emitLocal(); } catch (e) { toast(e.message, 'error'); } };

  return (
    <div>
      <div className="biz-chips" style={{ marginBottom: 10 }}>
        {businesses.map((x) => <button key={x.id} className={String(b) === String(x.id) ? 'on' : ''} style={{ '--c': x.color }} onClick={() => setB(String(x.id))}><i />{x.name} <small>{data.skus.filter((s) => s.business_id === x.id).length} SKU(s)</small></button>)}
      </div>
      <div className="row gap wrap" style={{ marginBottom: 10 }}>
        <label className="btn primary"><Icon name="download" size={15} /> Subir planilha (SKU e Descrição)<input type="file" accept=".xlsx,.csv,.txt" hidden onChange={upload} disabled={busy || !bid} /></label>
        <span className="muted small grow">A planilha precisa das colunas <b>SKU</b> e <b>Descrição</b>. Pode subir de novo quando quiser: SKUs novos entram, os que já existem só atualizam a descrição.</span>
      </div>
      <div className="ads-kpis" style={{ marginBottom: 10 }}>
        <div className="kp"><small>SKUs</small><b>{skus.length}</b></div>
        <div className="kp click" style={{ '--kc': '#a25ddc' }} onClick={() => setShow(show === 'new' ? 'all' : 'new')}><small>Novos (7 dias)</small><b>{skus.filter((s) => s.novo).length}</b></div>
        <div className="kp click" style={{ '--kc': '#e2445c' }} onClick={() => setShow(show === 'miss' ? 'all' : 'miss')}><small>SKUs com anúncio faltando</small><b>{skus.filter((s) => s.miss.length).length}</b></div>
        <div className="kp" style={{ '--kc': '#fdab3d' }}><small>Anúncios faltando</small><b>{totalMiss}</b><span>em {chans.length} canal(is)</span></div>
      </div>
      {!chans.length && <p className="warn-txt small">Este cliente ainda não tem canais ativos — ligue os canais em "Canais dos clientes" para ver o que falta em cada um.</p>}
      <div className="row gap wrap" style={{ marginBottom: 8 }}>
        <div className="mini-seg">{[['all', 'Todos'], ['miss', 'Com anúncio faltando'], ['new', 'Novos']].map(([k, l]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>)}</div>
        <input placeholder="Buscar SKU ou descrição…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <span className="grow" />
        {totalMiss > 0 && <button className="btn" disabled={busy} onClick={() => createAds(list.flatMap((s) => s.miss.map((c) => ({ sku: s.sku, channel_id: c.id }))))}>Criar anúncios pendentes para as faltas da lista ({list.reduce((a, s) => a + s.miss.length, 0)})</button>}
      </div>
      <div className="sheet-wrap" style={{ maxHeight: 'calc(100vh - 380px)' }}>
        <table className="sheet sku-sheet">
          <thead><tr>
            <th style={{ width: 150 }}>SKU</th><th style={{ width: 320 }}>Descrição</th><th style={{ width: 110 }}>Adicionado</th>
            {chans.map((c) => <th key={c.id} style={{ width: 104, textAlign: 'center' }}><span className="chan" style={{ background: c.color }}>{c.name}</span></th>)}
            {isAdmin && <th style={{ width: 40 }} />}
          </tr></thead>
          <tbody>
            <tr className="add-row">
              <td><input className="cell-in mono" placeholder="+ novo SKU" value={add.sku} onChange={(e) => setAdd({ ...add, sku: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && document.getElementById('sku-add-desc')?.focus()} /></td>
              <td><input id="sku-add-desc" className="cell-in" placeholder="Descrição (Enter para salvar)" value={add.description} onChange={(e) => setAdd({ ...add, description: e.target.value })}
                onKeyDown={async (e) => { if (e.key === 'Enter' && add.sku.trim()) { await call('/skus', { business_id: bid, ...add }); setAdd({ sku: '', description: '' }); } }} /></td>
              <td colSpan={chans.length + 1 + (isAdmin ? 1 : 0)} className="muted small">{add.sku.trim() && 'Enter para adicionar'}</td>
            </tr>
            {list.map((s) => (
              <tr key={s.id} className={s.miss.length ? 'has-pend' : ''}>
                <td><span className="sku-cell"><span className="mono">{s.sku}</span>{s.novo && <span className="novo-tag">NOVO</span>}</span></td>
                <td><DescCell value={s.description} onSave={(v) => patch(s, { description: v })} /></td>
                <td className="small muted">{fmtDateFull((s.created_at || '').slice(0, 10))}</td>
                {chans.map((c) => {
                  const n = cover.get(`${s.sku.toLowerCase()}|${c.id}`) || 0;
                  return <td key={c.id} style={{ textAlign: 'center' }} className={n ? '' : 'miss'}>
                    {n ? <span className="cov-ok" title={`${n} anúncio(s) neste canal`}>✓{n > 1 ? ` ${n}` : ''}</span>
                      : <button className="cov-miss" title="Criar anúncio pendente (sem link do anúncio e sem Drive)" disabled={busy} onClick={() => createAds([{ sku: s.sku, channel_id: c.id }])}>Falta +</button>}
                  </td>;
                })}
                {isAdmin && <td><button className="icon-mini" title="Tirar este SKU do catálogo (os anúncios continuam)" onClick={() => confirm(`Tirar o SKU ${s.sku} do catálogo? Os anúncios dele continuam na planilha.`) && patch(s, { archived: true })}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty>{skus.length ? 'Nenhum SKU com esse filtro.' : 'Nenhum SKU ainda — suba a planilha com SKU e Descrição.'}</Empty>}
      </div>
    </div>
  );
}

function DescCell({ value, onSave }) {
  const [v, setV] = useState(value || '');
  return <input className="cell-in" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== (value || '') && onSave(v.trim() || null)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}
