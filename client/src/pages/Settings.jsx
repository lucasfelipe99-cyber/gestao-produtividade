import React, { useState } from 'react';
import { useData } from '../lib.js';
import { Loading } from '../ui.jsx';
import { AccountsPanel, WeightsPanel, usePeople } from './Ads.jsx';
import Team from './Team.jsx';
import SkuCatalog from './Skus.jsx';

// Configurações: canais de cada cliente, contas, responsável estratégico, pontuação e cadastros
export default function Settings() {
  const { data } = useData('/ads');
  const people = usePeople();
  const [tab, setTab] = useState('canais');
  return (
    <div>
      <div className="page-head"><div><h1>Configurações</h1><p className="muted">Canais e contas de cada cliente, responsáveis, pontuação e cadastros da equipe</p></div></div>
      <div className="mini-seg" style={{ marginBottom: 14 }}>
        {[['canais', 'Canais dos clientes'], ['skus', 'SKUs dos clientes'], ['pontuacao', 'Pesos da pontuação'], ['cadastros', 'Equipe e cadastros']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'cadastros' ? <Team /> : !data ? <Loading /> : (
        <div className="card pad">{tab === 'canais' ? <AccountsPanel data={data} people={people} /> : tab === 'skus' ? <SkuCatalog data={data} /> : <WeightsPanel data={data} />}</div>
      )}
    </div>
  );
}
