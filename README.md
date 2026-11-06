# Gestão de Demandas e Produtividade

Sistema SaaS de gestão de tarefas e produtividade para equipes de e-commerce, inspirado no Monday.com.

## Funcionalidades

- **Multiempresa**: cada empresa tem seus dados isolados. Quem cria a conta da empresa vira administrador.
- **Perfis**: Administrador vê e gerencia todas as tarefas, tempos e indicadores. Colaborador acessa **somente as próprias tarefas, registros de tempo, metas, relatórios e histórico** (iniciar/pausar/finalizar, observações, desempenho próprio).
- **Empresas atendidas e canais de marketplace**: a mesma equipe pode trabalhar para várias empresas; cada tarefa pode ser vinculada a uma empresa e a um canal (Mercado Livre, Shopee, Amazon...), com filtros, agrupamento, indicadores e exportação por empresa e por canal.
- **Aba Resumo**: lançamentos do dia no estilo das atualizações do Monday (caixa de texto, cada lançamento com hora, empresa/canal, editar/excluir, histórico por dia) e resumo do dia organizado por IA (Claude) — por empresa/canal, feito, pendências, problemas e números — gerado automaticamente no fim da jornada ou sob demanda. Lembretes para revisar criam uma tarefa na data marcada (qualquer lançamento pode virar lembrete). Administradores leem os lançamentos e resumos de qualquer colaborador.
  Para ativar a IA: variável `ANTHROPIC_API_KEY` (opcional `AI_MODEL`, padrão `claude-haiku-5-5`).
- **Colaborador gerencia o próprio dia**: adiciona tarefas para si (sem recorrência), edita e exclui as que criou; tarefas atribuídas por outros só saem do dia com motivo (ficam canceladas e registradas no histórico).
- **Tarefas em grupo**: o administrador ou o responsável adiciona parceiros numa tarefa, cada um com a sua entrega e prazo. A entrega vira uma tarefa no dia do parceiro, ligada à principal; a principal mostra "aguardando / entregue / atrasada" de cada parceiro, e o parceiro vê e comenta a tarefa principal.
- **Permissão de abas**: o administrador escolhe quais abas cada colaborador acessa (bloqueado também na API).
- **Tarefas (aba única)**: diárias, semanais e pontuais juntas, com filtro por tipo; tabela agrupada (tipo, status, prazo, colaborador, equipe, empresa, canal), Kanban com arrastar e soltar e calendário mensal. O tipo é escolhido no pop-up da tarefa.
- **Tempo estimado**: ao concluir uma tarefa sem usar o cronômetro, o período desde a conclusão anterior (ou o início da jornada) é lançado como tempo estimado, só nas lacunas, sem o almoço e com teto de 2h; aparece tracejado na linha do tempo e separado nos relatórios.
- **Subtarefas com tempo próprio**: cada tarefa pode ter subtarefas; o tempo de cada subtarefa compõe o tempo da tarefa principal. Se o cronômetro da tarefa está rodando e uma subtarefa é adicionada, o tempo passa a contar nela imediatamente; ao concluir a subtarefa o cronômetro segue na tarefa principal.
- **Linha do tempo da jornada** (08:00–17:30 com almoço 12:00–13:00, configuráveis; trabalho no almoço conta como hora extra): blocos de trabalho por colaborador, atraso da primeira atividade, hora extra (antes do início ou após o fim), tempo sem apontamento e resumo dos últimos 7 dias.
- **Controle de tempo**: botões Iniciar / Pausar / Retomar / Finalizar com cronômetro em tempo real, lançamento manual de horários (com verificação de sobreposição) e **bloqueio de dois cronômetros simultâneos** por colaborador (garantido no banco por índice único).
- **Automações** (executadas a cada 5 minutos e a cada acesso):
  - diárias avulsas não concluídas são transferidas para o próximo dia útil (a data planejada original é preservada); diárias de rotina (recorrentes) não são transferidas — ficam atrasadas no próprio dia, pois a ocorrência do dia seguinte já existe;
  - semanais não concluídas continuam visíveis nas semanas seguintes como "Pendência anterior";
  - tarefas vencidas são marcadas como atrasadas;
  - recorrência diária (dias úteis), semanal ou mensal, com as ocorrências dos próximos 3 meses já criadas no calendário (horizonte estendido automaticamente; edição pode ser aplicada às próximas ocorrências; encerrar remove as futuras não iniciadas);
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
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic para o resumo por IA (opcional) |

Build: `npm install && npm run build` · Start: `npm start` · Health check: `/healthz`

## Regras atuais (nov/2026)
- **Sem cronômetro**: o tempo de cada tarefa é calculado pela hora da conclusão — da conclusão anterior do colaborador (ou do início da jornada, 08:00) até a conclusão desta, sem o almoço. Não há mais cálculo de atraso no início do dia.
- **Não realizada**: tarefa cujo dia/prazo passou sem conclusão fica como "Não realizada" no próprio dia (nada é transferido). Ainda pode ser finalizada depois.
- **Enviar para colaborador**: no "Nova tarefa", qualquer pessoa envia uma tarefa a um colega; ela começa no dia do envio e exige data final depois desse dia. Quem enviou acompanha (etiqueta "Enviada p/"), quem recebe vê "De Fulano · até dd/mm".
