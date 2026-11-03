import React, { useMemo, useState } from 'react';
import { api, toast, emitLocal, PALETTE } from '../lib.js';
import { Modal, Field, Icon } from '../ui.jsx';
import { useApp } from '../App.jsx';

const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const findBy = (list, key) => list.find((x) => norm(x.name).includes(norm(key)));

// Plano pedido: colaboradores × canais, empresas e atividades
const DEFAULT_PEOPLE = [['joao corazin', ['shopee']], ['joao junior', ['mercado livre']], ['leonardo', ['tiktok', 'magalu']]];
const DEFAULT_BUSINESSES = ['gigante', 'popper', 'unicci'];
const DEFAULT_DAILY = [
  ['Revisão de anúncios pausados'], ['Revisão das Métricas das contas'], ['Revisão de Pesquisa de Mercado e Posicionamento'],
  ['Revisão de ADS'], ['Revisão de central de promoção'], ['Revisão de afiliados', ['magalu']],
];
const DEFAULT_WEEKLY = [['Otimização de ADS'], ['Resumo executivo da conta']];
const WEEKDAYS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta']];

export default function RoutineBuilder({ onClose }) {
  const { activeUsers, businesses, channels, categories, me } = useApp();
  const members = activeUsers;
  const [rows, setRows] = useState(() => {
    const r = DEFAULT_PEOPLE.map(([who, chans]) => ({
      user_id: findBy(members, who)?.id || '', hint: who,
      channel_ids: chans.map((c) => findBy(channels, c)?.id).filter(Boolean),
    }));
    return r;
  });
  const [biz, setBiz] = useState(() => DEFAULT_BUSINESSES.map((b) => findBy(businesses, b)?.id).filter(Boolean));
  const mk = (title, ex = []) => ({ title, exclude_channel_ids: ex.map((c) => findBy(channels, c)?.id).filter(Boolean), estimated_minutes: '' });
  const [daily, setDaily] = useState(() => DEFAULT_DAILY.map(([t, ex]) => mk(t, ex)));
  const [weekly, setWeekly] = useState(() => DEFAULT_WEEKLY.map(([t, ex]) => ({ ...mk(t, ex), weekday: 1 })));
  const [category, setCategory] = useState('');
  const [currentWeek, setCurrentWeek] = useState(false);
  const [busy, setBusy] = useState(false);

  const missingBiz = DEFAULT_BUSINESSES.filter((b) => !findBy(businesses, b));
  const missingPeople = rows.filter((r) => !r.user_id).map((r) => r.hint).filter(Boolean);

  const preview = useMemo(() => {
    const perUser = rows.filter((r) => r.user_id).map((r) => {
      const chans = r.channel_ids.length ? r.channel_ids : [null];
      const nb = biz.length || 1;
      let d = 0, w = 0;
      for (const ch of chans) {
        d += daily.filter((a) => a.title.trim() && !a.exclude_channel_ids.includes(ch)).length * nb;
        w += weekly.filter((a) => a.title.trim() && !a.exclude_channel_ids.includes(ch)).length * nb;
      }
      return { name: members.find((u) => u.id === Number(r.user_id))?.name, d, w };
    });
    return { perUser, total: perUser.reduce((s, u) => s + u.d + u.w, 0) };
  }, [rows, biz, daily, weekly, members]);

  const toggle = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const createMissing = async (path, names) => {
    for (const [i, n] of names.entries()) await api(`/${path}`, { method: 'POST', body: { name: n, color: PALETTE[i % PALETTE.length] } });
    emitLocal(); toast('Cadastros criados. Reabra esta janela para selecioná-los.', 'success');
  };

  const submit = async () => {
    if (!preview.total) return toast('Nada para criar: escolha colaboradores e atividades', 'error');
    if (!confirm(`Criar ${preview.total} rotinas recorrentes? As ocorrências dos próximos 3 meses serão geradas.`)) return;
    setBusy(true);
    try {
      const r = await api('/routines/bulk', { method: 'POST', body: {
        assignments: rows.filter((x) => x.user_id).map((x) => ({ user_id: Number(x.user_id), channel_ids: x.channel_ids })),
        business_ids: biz, category_id: category || null, include_current_week: currentWeek,
        daily: daily.filter((a) => a.title.trim()), weekly: weekly.filter((a) => a.title.trim()),
      } });
      emitLocal();
      toast(`${r.recurrences} rotinas criadas · ${r.tasks} tarefas programadas`, 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal title="Montar rotina em lote" onClose={onClose} wide
      footer={<>
        <span className="grow muted small">{preview.total} rotinas recorrentes</span>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !preview.total} onClick={submit}>{busy ? 'Criando…' : 'Criar rotinas'}</button>
      </>}>
      <p className="muted small" style={{ margin: 0 }}>
        Cria uma atividade recorrente para cada combinação <b>colaborador × canal × empresa × atividade</b>. As diárias se repetem em dias úteis e as semanais no dia escolhido; as ocorrências dos próximos 3 meses já ficam no calendário.
      </p>

      <h4 className="rb-h">1. Colaboradores e seus canais</h4>
      {missingPeople.length > 0 && <div className="warn-box">Não encontrei cadastrado: <b>{missingPeople.join(', ')}</b>. Cadastre em “Novo usuário” ou selecione abaixo.</div>}
      {rows.map((r, i) => (
        <div className="rb-row" key={i}>
          <select value={r.user_id} onChange={(e) => setRow(i, { user_id: e.target.value })}>
            <option value="">{r.hint ? `— selecione (${r.hint}) —` : '— selecione —'}</option>
            {members.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? ' (você)' : ''}</option>)}
          </select>
          <div className="chips">
            {channels.map((c) => (
              <label key={c.id} className={'chip' + (r.channel_ids.includes(c.id) ? ' on' : '')} style={{ '--c': c.color }}>
                <input type="checkbox" checked={r.channel_ids.includes(c.id)} onChange={() => setRow(i, { channel_ids: toggle(r.channel_ids, c.id) })} />{c.name}
              </label>
            ))}
            {!channels.length && <span className="muted small">Nenhum canal cadastrado</span>}
          </div>
          <button className="icon-btn sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { user_id: '', channel_ids: [] }])}><Icon name="plus" size={14} /> Adicionar colaborador</button>

      <h4 className="rb-h">2. Empresas</h4>
      {missingBiz.length > 0 && (
        <div className="warn-box">Empresas do plano não encontradas: <b>{missingBiz.join(', ')}</b>{' '}
          <button className="link" onClick={() => createMissing('businesses', missingBiz.map((b) => ({ gigante: 'Gigante das Baterias', popper: 'Popper', unicci: 'Unicci' }[b])))}>cadastrar agora</button></div>
      )}
      <div className="chips">
        {businesses.map((b) => (
          <label key={b.id} className={'chip' + (biz.includes(b.id) ? ' on' : '')} style={{ '--c': b.color }}>
            <input type="checkbox" checked={biz.includes(b.id)} onChange={() => setBiz(toggle(biz, b.id))} />{b.name}
          </label>
        ))}
      </div>

      <h4 className="rb-h">3. Atividades diárias (dias úteis)</h4>
      <ActivityList list={daily} setList={setDaily} channels={channels} />

      <h4 className="rb-h">4. Atividades semanais</h4>
      <ActivityList list={weekly} setList={setWeekly} isWeekly channels={channels} />
      <label className="check"><input type="checkbox" checked={currentWeek} onChange={(e) => setCurrentWeek(e.target.checked)} /> Criar também as semanais desta semana (se o dia já passou, entram como pendentes/atrasadas)</label>

      <div className="grid-2">
        <Field label="Categoria (opcional)">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="rb-preview">
        <b>Resumo</b>
        {preview.perUser.map((u, i) => <div key={i}>{u.name}: <b>{u.d}</b> atividades por dia · <b>{u.w}</b> por semana</div>)}
        {!preview.perUser.length && <span className="muted">Selecione os colaboradores.</span>}
      </div>
    </Modal>
  );
}

function ActivityList({ list, setList, isWeekly, channels }) {
  const toggle = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  return (
    <div className="rb-acts">
      {list.map((a, i) => (
        <div className="rb-act" key={i}>
          <input className="grow" value={a.title} placeholder="Nome da atividade" onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          {isWeekly && (
            <select value={a.weekday} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
              {WEEKDAYS.map(([v, l]) => <option key={v} value={v}>Toda {l.toLowerCase()}</option>)}
            </select>
          )}
          <input type="number" min="0" className="rb-min" placeholder="min" title="Tempo estimado (minutos)" value={a.estimated_minutes}
            onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, estimated_minutes: e.target.value } : x)))} />
          <details className="rb-ex">
            <summary>{a.exclude_channel_ids.length ? `Não se aplica: ${a.exclude_channel_ids.map((id) => channels.find((c) => c.id === id)?.name).join(', ')}` : 'Exceções'}</summary>
            <div className="chips">
              {channels.map((c) => (
                <label key={c.id} className={'chip' + (a.exclude_channel_ids.includes(c.id) ? ' off' : '')}>
                  <input type="checkbox" checked={a.exclude_channel_ids.includes(c.id)}
                    onChange={() => setList(list.map((x, j) => (j === i ? { ...x, exclude_channel_ids: toggle(x.exclude_channel_ids, c.id) } : x)))} />
                  {c.name}
                </label>
              ))}
            </div>
          </details>
          <button className="icon-btn sm" onClick={() => setList(list.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      <button className="btn sm" onClick={() => setList([...list, { title: '', exclude_channel_ids: [], estimated_minutes: '', ...(isWeekly ? { weekday: 1 } : {}) }])}>
        <Icon name="plus" size={14} /> Adicionar atividade
      </button>
    </div>
  );
}
