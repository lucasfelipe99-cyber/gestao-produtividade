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
