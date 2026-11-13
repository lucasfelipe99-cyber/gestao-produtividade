-- Schema do sistema de gestão de demandas e produtividade
-- Idempotente: pode ser executado a cada inicialização.

CREATE TABLE IF NOT EXISTS companies (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  last_automation_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  company_id    INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  team_id       INT REFERENCES teams(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','member')),
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#579bfc',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recurrences (
  id            SERIAL PRIMARY KEY,
  company_id    INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  template      JSONB NOT NULL,
  next_date     DATE NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_by    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id                 SERIAL PRIMARY KEY,
  company_id         INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('daily','weekly')),
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  assignee_id        INT REFERENCES users(id) ON DELETE SET NULL,
  team_id            INT REFERENCES teams(id) ON DELETE SET NULL,
  category_id        INT REFERENCES categories(id) ON DELETE SET NULL,
  shared             BOOLEAN NOT NULL DEFAULT false,
  priority           TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status             TEXT NOT NULL DEFAULT 'not_started'
                     CHECK (status IN ('not_started','in_progress','paused','done','late','cancelled')),
  due_date           DATE NOT NULL,           -- diária: data de execução atual; semanal: prazo
  planned_date       DATE NOT NULL,           -- data original planejada (base do atingimento)
  week_start         DATE,                    -- semanal: segunda-feira da semana planejada
  scheduled_time     TIME,
  estimated_minutes  INT NOT NULL DEFAULT 0,
  tracked_seconds    INT NOT NULL DEFAULT 0,  -- soma dos registros de tempo encerrados
  notes              TEXT NOT NULL DEFAULT '',
  rollover_count     INT NOT NULL DEFAULT 0,
  recurrence_id      INT REFERENCES recurrences(id) ON DELETE SET NULL,
  created_by         INT REFERENCES users(id) ON DELETE SET NULL,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_company_due ON tasks (company_id, due_date);
CREATE INDEX IF NOT EXISTS tasks_company_planned ON tasks (company_id, planned_date);
CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks (assignee_id);

CREATE TABLE IF NOT EXISTS time_entries (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id     INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  seconds     INT NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'timer' CHECK (source IN ('timer','manual')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at > started_at)
);
-- Regra: um colaborador só pode ter um cronômetro ativo por vez
CREATE UNIQUE INDEX IF NOT EXISTS one_active_timer_per_user ON time_entries (user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS time_entries_task ON time_entries (task_id);
CREATE INDEX IF NOT EXISTS time_entries_company_start ON time_entries (company_id, started_at);

CREATE TABLE IF NOT EXISTS task_notes (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id     INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','difficulty','progress')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico de auditoria (preservado mesmo se a tarefa for excluída)
CREATE TABLE IF NOT EXISTS task_events (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id     INT,
  task_title  TEXT,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_events_task ON task_events (task_id);
CREATE INDEX IF NOT EXISTS task_events_company ON task_events (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS goals (
  id              SERIAL PRIMARY KEY,
  company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         INT REFERENCES users(id) ON DELETE CASCADE,  -- NULL = meta da equipe
  period          TEXT NOT NULL CHECK (period IN ('daily','weekly')),
  target_percent  INT NOT NULL DEFAULT 90 CHECK (target_percent BETWEEN 1 AND 100),
  target_tasks    INT,               -- opcional: mínimo de tarefas concluídas no período
  target_minutes  INT,               -- opcional: horas apontadas no período
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS goals_uq ON goals (company_id, COALESCE(user_id, 0), period);

-- ===== v2: jornada, subtarefas =====
ALTER TABLE companies ADD COLUMN IF NOT EXISTS work_start TIME NOT NULL DEFAULT '08:00';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS work_end TIME NOT NULL DEFAULT '17:30';

CREATE TABLE IF NOT EXISTS subtasks (
  id              SERIAL PRIMARY KEY,
  company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id         INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  done            BOOLEAN NOT NULL DEFAULT false,
  tracked_seconds INT NOT NULL DEFAULT 0,
  position        INT NOT NULL DEFAULT 0,
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subtasks_task ON subtasks (task_id);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS subtask_id INT REFERENCES subtasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_recurrence ON tasks (recurrence_id, planned_date);

-- ===== v3: empresas atendidas, canais, permissões, almoço =====
CREATE TABLE IF NOT EXISTS businesses (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#0073ea',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channels (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#fdab3d',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS business_id INT REFERENCES businesses(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS channel_id INT REFERENCES channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_business ON tasks (business_id);
CREATE INDEX IF NOT EXISTS tasks_channel ON tasks (channel_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_tabs TEXT[];
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lunch_start TIME NOT NULL DEFAULT '12:00';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lunch_end TIME NOT NULL DEFAULT '13:00';

-- ===== v4: apontamentos e lembretes pessoais (aba Resumo) =====
CREATE TABLE IF NOT EXISTS notes (
  id            SERIAL PRIMARY KEY,
  company_id    INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('note','reminder')),
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  pinned        BOOLEAN NOT NULL DEFAULT false,
  remind_date   DATE,
  remind_time   TIME,
  business_id   INT REFERENCES businesses(id) ON DELETE SET NULL,
  channel_id    INT REFERENCES channels(id) ON DELETE SET NULL,
  task_id       INT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'note' OR remind_date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS notes_user ON notes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notes_remind ON notes (company_id, remind_date) WHERE kind = 'reminder';

-- ===== v5: bloco de notas diário com resumo por IA =====
CREATE TABLE IF NOT EXISTS notepads (
  id             SERIAL PRIMARY KEY,
  company_id     INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day            DATE NOT NULL,
  content        TEXT NOT NULL DEFAULT '',
  summary        JSONB,
  summary_at     TIMESTAMPTZ,
  summary_error  TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);
CREATE INDEX IF NOT EXISTS notepads_pending_summary ON notepads (day) WHERE content <> '';

-- Migração: o texto do bloco de notas vira lançamentos separados (uma linha = um lançamento; "HH:MM texto" usa o horário)
-- Executa uma vez: depois da conversão o texto do bloco é esvaziado.
WITH lines AS (
  SELECT p.company_id, p.user_id, l.line,
         CASE WHEN l.line ~ '^([01]\d|2[0-3]):[0-5]\d '
              THEN ((p.day::text || ' ' || substr(l.line, 1, 5))::timestamp AT TIME ZONE c.timezone)
              ELSE p.updated_at + l.n * interval '1 millisecond' END AS ts
  FROM notepads p JOIN companies c ON c.id = p.company_id
  CROSS JOIN LATERAL regexp_split_to_table(p.content, E'\n') WITH ORDINALITY AS l(line, n)
  WHERE p.content <> '' AND btrim(l.line) <> ''
)
INSERT INTO notes (company_id, user_id, kind, body, created_at, updated_at)
SELECT company_id, user_id, 'note', CASE WHEN line ~ '^\d{2}:\d{2} ' THEN substr(line, 7) ELSE line END, ts, ts FROM lines;
UPDATE notepads SET content = '' WHERE content <> '';

-- ===== v6: tarefas em grupo (entrega de parceiro ligada a uma tarefa principal) =====
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INT REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;

-- ===== v7: tipo de tarefa "pontual" (avulsa com prazo, não diária nem semanal) =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_kind_check' AND pg_get_constraintdef(oid) LIKE '%oneoff%') THEN
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
    ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('daily','weekly','oneoff'));
  END IF;
END $$;
-- migrações que rodam uma única vez
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, done_at TIMESTAMPTZ NOT NULL DEFAULT now());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'v7_aba_pontuais') THEN
    -- quem já tinha acesso às tarefas diárias passa a ver também as pontuais
    UPDATE users SET allowed_tabs = array_append(allowed_tabs, 'pontuais')
      WHERE allowed_tabs IS NOT NULL AND 'diarias' = ANY(allowed_tabs) AND NOT 'pontuais' = ANY(allowed_tabs);
    INSERT INTO app_meta (key) VALUES ('v7_aba_pontuais');
  END IF;
END $$;

-- Início considerado de um dia específico (ex.: dia em que o sistema começou a ser usado à tarde).
-- Antes desse horário não conta atraso nem inatividade.
CREATE TABLE IF NOT EXISTS day_starts (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  start_time TIME NOT NULL,
  reason TEXT,
  PRIMARY KEY (company_id, day)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'v8_inicio_04_11') THEN
    INSERT INTO day_starts (company_id, day, start_time, reason)
      SELECT id, DATE '2026-11-04', TIME '14:10', 'Início do uso do sistema' FROM companies
      ON CONFLICT (company_id, day) DO NOTHING;
    INSERT INTO app_meta (key) VALUES ('v8_inicio_04_11');
  END IF;
END $$;

-- v9: abas de tarefas unificadas em "tarefas"
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'v9_aba_tarefas') THEN
    UPDATE users SET allowed_tabs = array_append(array_remove(array_remove(array_remove(allowed_tabs, 'diarias'), 'semanais'), 'pontuais'), 'tarefas')
      WHERE allowed_tabs IS NOT NULL AND allowed_tabs && ARRAY['diarias','semanais','pontuais'];
    UPDATE users SET allowed_tabs = array_remove(array_remove(array_remove(allowed_tabs, 'diarias'), 'semanais'), 'pontuais')
      WHERE allowed_tabs IS NOT NULL;
    INSERT INTO app_meta (key) VALUES ('v9_aba_tarefas');
  END IF;
END $$;

-- v9: tempo estimado (tarefa concluída sem cronômetro)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_source_check' AND pg_get_constraintdef(oid) LIKE '%inferred%') THEN
    ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_source_check;
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_source_check CHECK (source IN ('timer','manual','inferred'));
  END IF;
END $$;

-- v11: tarefa enviada a outro colaborador (começa no dia da criação, com data final)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;
-- v11: "Não realizada" só vale para dias que já passaram (tarefas transferidas antes ficaram 'late' no dia de hoje)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'v11_nao_realizada') THEN
    UPDATE tasks t SET status = CASE WHEN t.tracked_seconds > 0 THEN 'paused' ELSE 'not_started' END
      FROM companies c WHERE c.id = t.company_id AND t.status = 'late' AND t.due_date >= (now() AT TIME ZONE c.timezone)::date;
    INSERT INTO app_meta (key) VALUES ('v11_nao_realizada');
  END IF;
END $$;

-- v13: mural de clientes (comentários gerais e pontos de reunião, visível a toda a equipe)
CREATE TABLE IF NOT EXISTS client_posts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,  -- NULL = geral (todos os clientes)
  parent_id INTEGER REFERENCES client_posts(id) ON DELETE CASCADE,  -- resposta
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','meeting')),
  meeting_date DATE,
  body TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_posts_biz ON client_posts (company_id, business_id, created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'v13_aba_clientes') THEN
    UPDATE users SET allowed_tabs = array_append(allowed_tabs, 'clientes') WHERE allowed_tabs IS NOT NULL AND NOT 'clientes' = ANY(allowed_tabs);
    INSERT INTO app_meta (key) VALUES ('v13_aba_clientes');
  END IF;
END $$;

-- v14: tarefas em grupo (atividade feita ao mesmo tempo por vários colaboradores, com itens de link + descrição)
CREATE TABLE IF NOT EXISTS group_tasks (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  link TEXT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS group_task_members (
  group_id INTEGER NOT NULL REFERENCES group_tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doing_since TIMESTAMPTZ,            -- preenchido = "fazendo isso" agora
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS group_items (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES group_tasks(id) ON DELETE CASCADE,
  link TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- quem está fazendo / fez
  started_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_items_group ON group_items (group_id, position, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'v14_aba_grupo') THEN
    UPDATE users SET allowed_tabs = array_append(allowed_tabs, 'grupo') WHERE allowed_tabs IS NOT NULL AND NOT 'grupo' = ANY(allowed_tabs);
    INSERT INTO app_meta (key) VALUES ('v14_aba_grupo');
  END IF;
END $$;

-- v15: itens de SKU nas tarefas em grupo (link do drive de fotos/vídeos e checklist)
ALTER TABLE group_items ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE group_items ADD COLUMN IF NOT EXISTS drive_link TEXT;
ALTER TABLE group_items ADD COLUMN IF NOT EXISTS checks JSONB NOT NULL DEFAULT '{}'::jsonb;

-- v17: tarefa em grupo fixa "Gestão de SKU" por cliente; cliente Next10
ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS fixed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS group_tasks_fixed_biz ON group_tasks (business_id) WHERE fixed;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'v17_next10') THEN
    INSERT INTO businesses (company_id, name, color)
      SELECT DISTINCT b.company_id, 'Next10', '#ff642e' FROM businesses b
      WHERE b.name IN ('Popper','Unicci','Gigante das Baterias')
        AND NOT EXISTS (SELECT 1 FROM businesses x WHERE x.company_id=b.company_id AND lower(x.name)='next10');
    INSERT INTO app_meta (key) VALUES ('v17_next10');
  END IF;
END $$;

-- v19: curva ABC por SKU (planilha de curva ABC importada nas tarefas em grupo)
ALTER TABLE group_items ADD COLUMN IF NOT EXISTS curva TEXT;
ALTER TABLE group_items ADD COLUMN IF NOT EXISTS faturamento NUMERIC(14,2);
ALTER TABLE group_items ADD COLUMN IF NOT EXISTS abc JSONB;
ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS abc_period TEXT;
ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS abc_updated_at TIMESTAMPTZ;
ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS abc_file TEXT;

-- v20: anúncios por canal dentro de cada SKU (vários anúncios por canal)
ALTER TABLE group_items ADD COLUMN IF NOT EXISTS listings JSONB NOT NULL DEFAULT '[]'::jsonb;

-- v22: avisos para todo o time (ex.: SKU com fotos e vídeos prontos)
CREATE TABLE IF NOT EXISTS team_notices (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  group_id INTEGER REFERENCES group_tasks(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES group_items(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_notices_company ON team_notices (company_id, created_at DESC);

-- v23: responsável por SKU (distribuição dos SKUs entre colaboradores)
ALTER TABLE group_items ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS group_items_assignee ON group_items (assignee_id) WHERE assignee_id IS NOT NULL;

-- v24: quadro de acompanhamento de clientes (situação, pontos, próximo passo, prioridade) + foco geral
CREATE TABLE IF NOT EXISTS client_status (
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  situacao TEXT, pontos TEXT, proximo TEXT,
  prioridade TEXT CHECK (prioridade IN ('alta','media','baixa')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS client_board (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  foco TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
