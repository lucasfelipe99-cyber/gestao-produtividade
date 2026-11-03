import React, { useState } from 'react';
import { api, toast, emitLocal, PRIORITY } from '../lib.js';
import { Modal, Field } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function TaskForm({ initial = {}, onClose, onSaved }) {
  const { activeUsers, categories, teams, me } = useApp();
  const editing = !!initial.id;
  const [f, setF] = useState({
    title: '', description: '', kind: 'daily', assignee_id: '', team_id: '', category_id: '', priority: 'medium',
    due_date: me.today, scheduled_time: '', estimated_minutes: '', shared: false, recurrence: '', notes: '',
    ...initial,
    scheduled_time: initial.scheduled_time ? initial.scheduled_time.slice(0, 5) : '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const [estH, setEstH] = useState(f.estimated_minutes ? Math.floor(f.estimated_minutes / 60) : '');
  const [estM, setEstM] = useState(f.estimated_minutes ? f.estimated_minutes % 60 : '');

  const save = async () => {
    if (!f.title.trim()) return toast('Informe o nome da tarefa', 'error');
    setBusy(true);
    const body = {
      title: f.title, description: f.description, kind: f.kind, assignee_id: f.assignee_id || null, team_id: f.team_id || null,
      category_id: f.category_id || null, priority: f.priority, due_date: f.due_date, scheduled_time: f.scheduled_time || null,
      estimated_minutes: (Number(estH) || 0) * 60 + (Number(estM) || 0), shared: f.shared,
    };
    if (!editing) { body.recurrence = f.recurrence || null; body.notes = f.notes; }
    try {
      const t = editing ? await api(`/tasks/${initial.id}`, { method: 'PATCH', body }) : await api('/tasks', { method: 'POST', body });
      toast(editing ? 'Tarefa atualizada' : 'Tarefa criada', 'success');
      emitLocal();
      onSaved?.(t);
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal title={editing ? 'Editar tarefa' : 'Nova tarefa'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>{editing ? 'Salvar alterações' : 'Criar tarefa'}</button></>}>
      <div className="grid-form">
        <Field label="Nome da tarefa *"><input autoFocus value={f.title} onChange={set('title')} placeholder="Ex.: Atualizar preços no Mercado Livre" /></Field>
        <Field label="Tipo">
          <select value={f.kind} onChange={set('kind')}><option value="daily">Diária</option><option value="weekly">Semanal</option></select>
        </Field>
        <Field label="Descrição detalhada" ><textarea rows={3} value={f.description} onChange={set('description')} /></Field>
        <Field label="Responsável">
          <select value={f.assignee_id || ''} onChange={set('assignee_id')}>
            <option value="">— Sem responsável (só administradores veem) —</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Equipe">
          <select value={f.team_id || ''} onChange={set('team_id')}>
            <option value="">—</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label={f.kind === 'daily' ? 'Data de execução' : 'Prazo de conclusão'}><input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        <Field label="Horário previsto"><input type="time" value={f.scheduled_time} onChange={set('scheduled_time')} /></Field>
        <Field label="Prioridade">
          <select value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </Field>
        <Field label="Categoria da atividade">
          <select value={f.category_id || ''} onChange={set('category_id')}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Tempo estimado">
          <div className="row gap-s">
            <input type="number" min="0" value={estH} onChange={(e) => setEstH(e.target.value)} placeholder="0" /> <span>h</span>
            <input type="number" min="0" max="59" value={estM} onChange={(e) => setEstM(e.target.value)} placeholder="0" /> <span>min</span>
          </div>
        </Field>
        {!editing && (
          <Field label="Recorrência" hint="Gera automaticamente uma nova tarefa a cada período">
            <select value={f.recurrence} onChange={set('recurrence')}>
              <option value="">Não se repete</option><option value="daily">Diariamente (dias úteis)</option>
              <option value="weekly">Semanalmente</option><option value="monthly">Mensalmente</option>
            </select>
          </Field>
        )}
        {!editing && <Field label="Observações"><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>}
      </div>
    </Modal>
  );
}
