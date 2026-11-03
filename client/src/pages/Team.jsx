import React, { useState } from 'react';
import { api, toast, emitLocal, PALETTE } from '../lib.js';
import { Card, Avatar, Modal, Field, Icon } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function Team() {
  const { users, teams, categories, me } = useApp();
  const [editUser, setEditUser] = useState(null);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Equipe e cadastros</h1><p className="muted">Usuários, permissões, equipes e categorias de atividade</p></div>
        <button className="btn primary" onClick={() => setEditUser({})}><Icon name="plus" /> Novo usuário</button>
      </div>
      <Card title={`Usuários (${users.length})`}>
        <div className="table-scroll">
          <table className="simple">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Equipe</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'inactive'}>
                  <td><span className="row gap-s"><Avatar name={u.name} id={u.id} size={26} />{u.name}{u.id === me.id && <span className="tag">você</span>}</span></td>
                  <td>{u.email}</td>
                  <td><span className={'tag ' + (u.role === 'admin' ? 'primary' : '')}>{u.role === 'admin' ? 'Administrador' : 'Colaborador'}</span></td>
                  <td>{u.team_name || '—'}</td>
                  <td>{u.active ? <span className="tag ok">Ativo</span> : <span className="tag">Inativo</span>}</td>
                  <td><button className="icon-btn sm" onClick={() => setEditUser(u)}><Icon name="edit" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid-2 cards">
        <SimpleList title="Equipes" path="teams" items={teams} />
        <SimpleList title="Categorias de atividade" path="categories" items={categories} withColor />
      </div>
      {editUser && <UserForm user={editUser} teams={teams} onClose={() => setEditUser(null)} />}
    </div>
  );
}

function UserForm({ user, teams, onClose }) {
  const editing = !!user.id;
  const [f, setF] = useState({ name: user.name || '', email: user.email || '', password: '', role: user.role || 'member', team_id: user.team_id || '', active: user.active ?? true });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    try {
      const body = { ...f, team_id: f.team_id || null };
      if (editing && !body.password) delete body.password;
      if (editing) await api(`/users/${user.id}`, { method: 'PATCH', body }); else await api('/users', { method: 'POST', body });
      emitLocal(); toast(editing ? 'Usuário atualizado' : 'Usuário criado. Envie o e-mail e a senha ao colaborador.', 'success'); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={editing ? 'Editar usuário' : 'Novo usuário'} onClose={onClose} footer={<button className="btn primary" onClick={save}>Salvar</button>}>
      <Field label="Nome"><input value={f.name} onChange={set('name')} /></Field>
      <Field label="E-mail (login)"><input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label={editing ? 'Nova senha (deixe em branco para manter)' : 'Senha inicial (mín. 6 caracteres)'}><input type="text" value={f.password} onChange={set('password')} /></Field>
      <div className="grid-2">
        <Field label="Perfil">
          <select value={f.role} onChange={set('role')}><option value="member">Colaborador</option><option value="admin">Administrador</option></select>
        </Field>
        <Field label="Equipe">
          <select value={f.team_id} onChange={set('team_id')}><option value="">—</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </Field>
      </div>
      {editing && <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Usuário ativo (pode acessar o sistema)</label>}
    </Modal>
  );
}

function SimpleList({ title, path, items, withColor }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[items.length % PALETTE.length]);
  const add = async () => {
    if (!name.trim()) return;
    try { await api(`/${path}`, { method: 'POST', body: { name, color } }); setName(''); setColor(PALETTE[(items.length + 1) % PALETTE.length]); emitLocal(); } catch (e) { toast(e.message, 'error'); }
  };
  const rename = async (it) => {
    const n = prompt('Novo nome', it.name);
    if (!n) return;
    try { await api(`/${path}/${it.id}`, { method: 'PATCH', body: { name: n } }); emitLocal(); } catch (e) { toast(e.message, 'error'); }
  };
  const recolor = async (it, c) => { await api(`/${path}/${it.id}`, { method: 'PATCH', body: { name: it.name, color: c } }); emitLocal(); };
  const remove = async (it) => {
    if (!confirm(`Excluir "${it.name}"? As tarefas vinculadas ficarão sem ${withColor ? 'categoria' : 'equipe'}.`)) return;
    try { await api(`/${path}/${it.id}`, { method: 'DELETE' }); emitLocal(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Card title={title}>
      <div className="row gap-s mb">
        {withColor && <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color" />}
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={`Adicionar ${withColor ? 'categoria' : 'equipe'}`} />
        <button className="btn primary" onClick={add}><Icon name="plus" /></button>
      </div>
      <ul className="simple-list">
        {items.map((it) => (
          <li key={it.id}>
            {withColor && <input type="color" value={it.color} onChange={(e) => recolor(it, e.target.value)} className="color sm" />}
            <span className="grow">{it.name}</span>
            <button className="icon-btn sm" onClick={() => rename(it)}><Icon name="edit" size={14} /></button>
            <button className="icon-btn sm" onClick={() => remove(it)}><Icon name="trash" size={14} /></button>
          </li>
        ))}
        {!items.length && <li className="muted">Nenhum cadastro ainda.</li>}
      </ul>
    </Card>
  );
}
