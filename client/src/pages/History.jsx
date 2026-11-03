import React, { useState } from 'react';
import { useData, ACTIONS, fmtDateTime, fmtDur, STATUS } from '../lib.js';
import { Card, Loading, Avatar, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';

const ACTION_COLOR = {
  created: '#579bfc', started: '#fdab3d', resumed: '#fdab3d', paused: '#a25ddc', finished: '#00c875', manual_time: '#0073ea',
  rolled_over: '#e2445c', marked_late: '#e2445c', cancelled: '#676879', deleted: '#333', reopened: '#fdab3d',
};

export default function History() {
  const { isAdmin, activeUsers, openTask } = useApp();
  const [user, setUser] = useState('');
  const { data } = useData(`/events?limit=300${user ? '&user=' + user : ''}`);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Histórico de movimentações</h1><p className="muted">Quem criou, iniciou, pausou, finalizou ou alterou cada tarefa</p></div>
        {isAdmin && (
          <select value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Todos os usuários</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>
      <Card>
        {!data ? <Loading /> : !data.length ? <Empty>Nenhuma movimentação registrada.</Empty> : (
          <ul className="feed">
            {data.map((e) => (
              <li key={e.id}>
                <span className="feed-dot" style={{ background: ACTION_COLOR[e.action] || '#c4c4c4' }} />
                {e.user_name ? <Avatar name={e.user_name} id={e.user_id} size={26} /> : <span className="avatar sys">⚙</span>}
                <div className="grow">
                  <div>
                    <b>{e.user_name || 'Automação'}</b> {(ACTIONS[e.action] || e.action).toLowerCase()}{' '}
                    {e.task_id && e.action !== 'deleted'
                      ? <button className="link" onClick={() => openTask(e.task_id)}>{e.task_title}</button>
                      : <i>{e.task_title}</i>}
                    {e.action === 'status_changed' && e.details.status && <> → <b style={{ color: STATUS[e.details.status.to]?.color }}>{STATUS[e.details.status.to]?.label}</b></>}
                    {e.action === 'finished' && e.details.total_seconds != null && <span className="muted"> ({fmtDur(e.details.total_seconds)})</span>}
                    {e.action === 'manual_time' && <span className="muted"> ({fmtDur(e.details.seconds)})</span>}
                  </div>
                  <small className="muted">{fmtDateTime(e.created_at)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
