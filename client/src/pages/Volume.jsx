import React, { useState } from 'react';
import { useData, toISODate, addDays, weekStart, monthStart, monthEnd, fmtDateFull } from '../lib.js';
import { Avatar, Loading, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { usePeople } from './Ads.jsx';

// Volume de trabalho: conta quem clicou/preencheu cada etapa (não quem era o responsável)
const FOTO = ['capa', 'ambientada', 'beneficios', 'objecao', 'como_usar', 'extra'];
const ESTR = ['ads', 'afiliados', 'promocao', 'cupom', 'relampago'];
const COLS = [
  ['listing', 'Anúncios criados', 'Anúncios cadastrados (manual, importação ou estrutura antiga)'],
  ['link', 'Links/IDs', 'Link ou ID do anúncio preenchido'],
  ['noar', 'No ar', 'Anúncios marcados como no ar'],
  ['fotos', 'Fotos', 'Capa, ambientada, benefícios, objeções, como usar, imagem extra e fotos da base do SKU'],
  ['videos', 'Vídeos', 'Vídeo do anúncio e vídeos da base do SKU'],
  ['estr', 'Estratégico', 'ADS, afiliados, promoção, cupom e oferta relâmpago'],
  ['sku', 'SKUs', 'SKUs cadastrados / subidos por planilha'],
  ['drive', 'Drive', 'Links do Drive colados'],
  ['task', 'Tarefas', 'Tarefas concluídas'],
  ['note', 'Apontamentos', 'Apontamentos registrados'],
];
const LABEL = { anuncio: 'No ar', capa: 'Capa', ambientada: 'Ambientada', beneficios: 'Benefícios', objecao: 'Objeções', como_usar: 'Como usar', extra: 'Imagem extra', video: 'Vídeo',
  ads: 'ADS', afiliados: 'Afiliados', promocao: 'Promoção', cupom: 'Cupom', relampago: 'Oferta relâmpago', fotos: 'Fotos da base', videos: 'Vídeos da base' };
const catOf = (e) => {
  if (e.kind === 'check') return e.key === 'anuncio' ? 'noar' : FOTO.includes(e.key) ? 'fotos' : e.key === 'video' ? 'videos' : ESTR.includes(e.key) ? 'estr' : null;
  if (e.kind === 'base') return e.key === 'fotos' ? 'fotos' : e.key === 'videos' ? 'videos' : null;
  return e.kind;
};

export default function Volume() {
  const { me, isAdmin, businesses, channels } = useApp();
  const people = usePeople();
  const today = toISODate(new Date());
  const [per, setPer] = useState('week');
  const [range, setRange] = useState({ from: weekStart(today), to: today });
  const [user, setUser] = useState('');
  const [open, setOpen] = useState(null);
  const setPeriod = (p) => {
    setPer(p);
    if (p === 'day') setRange({ from: today, to: today });
    if (p === 'week') setRange({ from: weekStart(today), to: today });
    if (p === 'lastweek') setRange({ from: addDays(weekStart(today), -7), to: addDays(weekStart(today), -1) });
    if (p === 'month') setRange({ from: monthStart(today), to: today });
    if (p === 'lastmonth') { const s = monthStart(addDays(monthStart(today), -1)); setRange({ from: s, to: monthEnd(s) }); }
  };
  const { data } = useData(`/volume?from=${range.from}&to=${range.to}${isAdmin && user ? `&user=${user}` : ''}`);
  const name = (id) => people.find((p) => p.id === id)?.name || (id === me.id ? me.name : `#${id}`);
  const bizName = (id) => businesses.find((b) => b.id === id)?.name || 'Sem cliente';
  const ch = (id) => channels.find((c) => c.id === id);

  let body = <Loading />;
  if (data) {
    const ev = data.events.map((e) => ({ ...e, cat: catOf(e) })).filter((e) => e.cat && e.user_id);
    const byUser = new Map();
    for (const e of ev) {
      const u = byUser.get(e.user_id) || { id: e.user_id, total: 0, c: {}, biz: new Map(), ev: [] };
      u.total++; u.c[e.cat] = (u.c[e.cat] || 0) + 1; u.ev.push(e);
      const b = u.biz.get(e.business_id) || {}; b[e.cat] = (b[e.cat] || 0) + 1; u.biz.set(e.business_id, b);
      byUser.set(e.user_id, u);
    }
    const list = [...byUser.values()].sort((a, b) => b.total - a.total);
    const cols = COLS.filter(([k]) => list.some((u) => u.c[k]));
    const sum = (k) => list.reduce((a, u) => a + (u.c[k] || 0), 0);
    body = !list.length ? <Empty>Nada registrado neste período{!isAdmin || user ? ' para esta pessoa' : ''}.</Empty> : (
      <>
        <div className="card vol-card">
          <table className="workload-table">
            <thead><tr><th>Pessoa</th>{cols.map(([k, l, t]) => <th key={k} title={t}>{l}</th>)}<th>Total</th><th /></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className={open === u.id ? 'open' : ''}>
                  <td><span className="row gap-s"><Avatar name={name(u.id)} id={u.id} size={22} />{u.id === me.id ? 'Você' : name(u.id)}</span></td>
                  {cols.map(([k]) => <td key={k}>{u.c[k] || <span className="muted">—</span>}</td>)}
                  <td><b>{u.total}</b></td>
                  <td><button className="link small" onClick={() => setOpen(open === u.id ? null : u.id)}>{open === u.id ? 'Fechar' : 'Detalhar'}</button></td>
                </tr>
              ))}
              {list.length > 1 && <tr className="tot"><td>Equipe</td>{cols.map(([k]) => <td key={k}>{sum(k) || '—'}</td>)}<td>{ev.length}</td><td /></tr>}
            </tbody>
          </table>
        </div>
        {list.filter((u) => open === u.id || list.length === 1).map((u) => (
          <div key={u.id} className="card vol-detail">
            <h3><Avatar name={name(u.id)} id={u.id} size={24} /> {name(u.id)} — por cliente</h3>
            <table className="workload-table">
              <thead><tr><th>Cliente</th>{cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
              <tbody>{[...u.biz.entries()].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0)).map(([b, c]) => (
                <tr key={b || 0}><td>{bizName(b)}</td>{cols.map(([k]) => <td key={k}>{c[k] || <span className="muted">—</span>}</td>)}</tr>
              ))}</tbody>
            </table>
            <details>
              <summary>Ver cada ação ({u.ev.length})</summary>
              <ul className="vol-list">
                {u.ev.slice(0, 1500).map((e, k) => (
                  <li key={k}>
                    <span className="muted small">{new Date(e.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    <b>{e.kind === 'check' || e.kind === 'base' ? LABEL[e.key] : COLS.find((c) => c[0] === e.cat)?.[1]}</b>
                    <span>{bizName(e.business_id)}</span>
                    {e.channel_id && ch(e.channel_id) && <span className="chan" style={{ background: ch(e.channel_id).color }}>{ch(e.channel_id).name}</span>}
                    {e.sku && <span className="mono">{e.sku}</span>}
                    {e.kind === 'task' || e.kind === 'note' ? <span className="muted ellip">{e.ad_code}</span>
                      : e.ad_code && (e.link ? <a href={e.link} target="_blank" rel="noreferrer" className="mono">{e.ad_code}</a> : <span className="mono">{e.ad_code}</span>)}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
      </>
    );
  }
  return (
    <div>
      <div className="page-head">
        <div><h1>Volume de trabalho</h1><p className="muted">{isAdmin ? 'O que cada pessoa da equipe fez' : 'O que você fez'} — conta quem clicou ou preencheu cada etapa · {fmtDateFull(range.from)}{range.to !== range.from ? ` a ${fmtDateFull(range.to)}` : ''}</p></div>
      </div>
      <div className="row gap wrap" style={{ marginBottom: 12 }}>
        <div className="mini-seg">
          {[['day', 'Hoje'], ['week', 'Esta semana'], ['lastweek', 'Semana passada'], ['month', 'Este mês'], ['lastmonth', 'Mês passado'], ['custom', 'Período']].map(([k, l]) => <button key={k} className={per === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
        </div>
        {per === 'custom' && <><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /> até <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></>}
        {isAdmin && <select value={user} onChange={(e) => setUser(e.target.value)}><option value="">Toda a equipe</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      </div>
      {body}
    </div>
  );
}
