import React, { useState } from 'react';
import { api } from '../lib.js';
import { Icon, Field } from '../ui.jsx';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ company: '', name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api(mode === 'login' ? '/auth/login' : '/auth/signup', { method: 'POST', body: f });
      onLogin();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <div className="login-art">
        <div className="logo big"><Icon name="check" size={32} /></div>
        <h1>Gestão de Demandas e Produtividade</h1>
        <p>Centralize as demandas da equipe, controle o tempo de cada atividade e acompanhe o atingimento das metas em tempo real.</p>
        <ul>
          <li><Icon name="clock" /> Cronômetro por tarefa com pausa e lançamento manual</li>
          <li><Icon name="target" /> Metas diárias e semanais com atingimento individual</li>
          <li><Icon name="chart" /> Relatórios de produtividade com exportação para Excel</li>
        </ul>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Entrar' : 'Criar conta da empresa'}</h2>
        {mode === 'signup' && (
          <>
            <Field label="Nome da empresa"><input required value={f.company} onChange={set('company')} /></Field>
            <Field label="Seu nome"><input required value={f.name} onChange={set('name')} /></Field>
          </>
        )}
        <Field label="E-mail"><input type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Senha"><input type="password" required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={set('password')} /></Field>
        {err && <div className="error-box">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        <p className="muted center small">
          {mode === 'login'
            ? <>Primeiro acesso da empresa? <button type="button" className="link" onClick={() => setMode('signup')}>Criar conta</button></>
            : <>Já tem conta? <button type="button" className="link" onClick={() => setMode('login')}>Entrar</button></>}
        </p>
        {mode === 'signup' && <p className="muted small">Quem cria a conta da empresa se torna o administrador. Os colaboradores são cadastrados por ele em “Equipe e cadastros”.</p>}
      </form>
    </div>
  );
}
