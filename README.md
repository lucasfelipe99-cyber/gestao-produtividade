# Gestão de Demandas e Produtividade

Sistema SaaS de gestão de tarefas e produtividade para equipes de e-commerce, inspirado no Monday.com.

## Funcionalidades

- **Multiempresa**: cada empresa tem seus dados isolados. Quem cria a conta da empresa vira administrador.
- **Perfis**: Administrador (gestão completa) e Colaborador (suas tarefas + compartilhadas, iniciar/pausar/finalizar, observações, desempenho próprio).
- **Tarefas diárias e semanais**: visualização em tabela agrupada (status, colaborador ou equipe), Kanban com arrastar e soltar, e calendário mensal.
- **Controle de tempo**: botões Iniciar / Pausar / Retomar / Finalizar com cronômetro em tempo real, lançamento manual de horários (com verificação de sobreposição) e **bloqueio de dois cronômetros simultâneos** por colaborador (garantido no banco por índice único).
- **Automações** (executadas a cada 5 minutos e a cada acesso):
  - diárias não concluídas são transferidas para o próximo dia útil (a data planejada original é preservada);
  - semanais não concluídas continuam visíveis nas semanas seguintes como "Pendência anterior";
  - tarefas vencidas são marcadas como atrasadas;
  - recorrência diária (dias úteis), semanal ou mensal;
  - alertas de vencimento (sino no topo).
- **Metas**: metas diárias e semanais da equipe e por colaborador. Atingimento = concluídas no período ÷ planejadas no período × 100 (canceladas excluídas).
- **Dashboard e relatórios**: indicadores, gráficos e relatórios com filtros e **exportação para Excel**.
- **Histórico/auditoria**: quem criou, iniciou, pausou, finalizou ou alterou cada tarefa (com valores antes/depois).
- **Tempo real**: telas atualizam sozinhas via Server-Sent Events quando qualquer pessoa movimenta uma tarefa.

## Tecnologia

- Backend: Node.js 20+ / Express 5 / PostgreSQL (`server/`)
- Frontend: React + Vite + Recharts (`client/`)
- Autenticação por e-mail e senha (bcrypt + JWT em cookie httpOnly)

## Rodar localmente

```bash
# PostgreSQL rodando e um banco criado
export DATABASE_URL=postgres://usuario:senha@localhost:5432/gestao
export JWT_SECRET=um-segredo-qualquer
npm install
npm run build      # compila o frontend
npm start          # http://localhost:3000
```

Para desenvolvimento do frontend com recarga automática: `npm run dev` (API) e `cd client && npx vite` (interface em http://localhost:5173).

O schema do banco (`server/schema.sql`) é aplicado automaticamente ao iniciar.

## Deploy no Render

O arquivo `render.yaml` cria o banco PostgreSQL e o web service. Variáveis necessárias:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | URL de conexão do PostgreSQL |
| `JWT_SECRET` | Segredo para assinar as sessões |
| `NODE_ENV` | `production` |

Build: `npm install && npm run build` · Start: `npm start` · Health check: `/healthz`
