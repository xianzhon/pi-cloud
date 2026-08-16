import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export type PiuiDatabase = Database.Database;

export function openPiuiDatabase(dbPath: string): PiuiDatabase {
  const isPersistent = dbPath !== ':memory:';

  if (isPersistent) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  }

  // SQLite creates the database and journal sidecars using the process umask.
  // Restrict creation before any credentials or TOTP secrets can be persisted.
  const previousUmask = process.umask(0o077);
  let db: PiuiDatabase;
  try {
    db = new Database(dbPath);
  } finally {
    process.umask(previousUmask);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  migrateSessionBuiltinEventsTable(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS security_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commit_message_prompts (
      scope_path TEXT PRIMARY KEY,
      system_prompt TEXT,
      user_prompt TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_profile_settings (
      profile_id TEXT PRIMARY KEY,
      proxy_json TEXT NOT NULL DEFAULT '{}',
      auto_rename_provider TEXT,
      auto_rename_model_id TEXT,
      auto_rename_language TEXT CHECK (auto_rename_language IN ('english', 'chinese')),
      automation_provider TEXT,
      automation_model_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      username TEXT,
      ip TEXT,
      user_agent TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS skill_presets (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('enabled', 'disabled')),
      skills_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (username, name)
    );

    CREATE TABLE IF NOT EXISTS session_skill_policies (
      session_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('all', 'enabled', 'disabled')),
      skills_json TEXT NOT NULL,
      preset_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (preset_id) REFERENCES skill_presets(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS session_worktrees (
      session_id TEXT PRIMARY KEY,
      base_repo_path TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      branch_mode TEXT NOT NULL CHECK (branch_mode IN ('new', 'existing')),
      base_branch TEXT,
      worktree_managed INTEGER NOT NULL DEFAULT 1,
      worktree_status TEXT NOT NULL CHECK (worktree_status IN ('active', 'finished')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS session_builtin_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('commit_created', 'commit_amended', 'pr_created', 'branch_deleted')),
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS session_worktrees_base_repo_path_idx
      ON session_worktrees(base_repo_path);

    CREATE INDEX IF NOT EXISTS session_builtin_events_session_created_idx
      ON session_builtin_events(session_id, created_at, id);

    CREATE TABLE IF NOT EXISTS memory_projects (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      canonical_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (profile_id, canonical_path)
    );

    CREATE TABLE IF NOT EXISTS memory_extraction_runs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      source_session_path TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('automatic', 'session_import')),
      starting_leaf_id TEXT,
      ending_leaf_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      model_provider TEXT,
      model_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      discarded_count INTEGER NOT NULL DEFAULT 0,
      gate_decision TEXT CHECK (gate_decision IN ('extract', 'skip')),
      gate_reason_code TEXT,
      normalized_evidence_count INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      token_accounting_method TEXT,
      prompt_format_version TEXT,
      emitted_count INTEGER NOT NULL DEFAULT 0,
      validated_count INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      replaced_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES memory_projects(id) ON DELETE CASCADE,
      UNIQUE (source_session_id, ending_leaf_id, source_kind)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      project_id TEXT,
      scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
      category TEXT NOT NULL CHECK (category IN ('rule', 'preference', 'decision', 'fact', 'pitfall')),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      pinned_applicability TEXT NOT NULL DEFAULT 'always' CHECK (pinned_applicability IN ('always', 'matched')),
      status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'archived')),
      source TEXT NOT NULL CHECK (source IN ('explicit', 'automatic', 'session_import', 'manual_ui')),
      source_session_id TEXT,
      source_entry_id TEXT,
      evidence TEXT,
      extraction_run_id TEXT,
      supersedes_id TEXT,
      supersedes_revision INTEGER,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      positive_utility_count INTEGER NOT NULL DEFAULT 0,
      negative_utility_count INTEGER NOT NULL DEFAULT 0,
      last_utility_at TEXT,
      FOREIGN KEY (project_id) REFERENCES memory_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (extraction_run_id) REFERENCES memory_extraction_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (supersedes_id) REFERENCES memories(id) ON DELETE SET NULL,
      CHECK ((scope = 'project' AND project_id IS NOT NULL) OR (scope = 'global' AND project_id IS NULL))
    );

    CREATE INDEX IF NOT EXISTS memories_scope_idx
      ON memories(profile_id, project_id, scope, status, category, updated_at);
    CREATE INDEX IF NOT EXISTS memories_extraction_run_idx ON memories(extraction_run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS memories_live_hash_idx
      ON memories(profile_id, IFNULL(project_id, ''), scope, content_hash)
      WHERE status IN ('active', 'pending');

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      memory_id UNINDEXED,
      content,
      tags,
      tokenize = 'unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memory_fts(memory_id, content, tags) VALUES (new.id, new.content, new.tags_json);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
      DELETE FROM memory_fts WHERE memory_id = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE OF content, tags_json ON memories BEGIN
      DELETE FROM memory_fts WHERE memory_id = old.id;
      INSERT INTO memory_fts(memory_id, content, tags) VALUES (new.id, new.content, new.tags_json);
    END;

    CREATE TABLE IF NOT EXISTS memory_recall_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      session_id TEXT,
      injected INTEGER NOT NULL CHECK (injected IN (0, 1)),
      candidate_ids_json TEXT NOT NULL DEFAULT '[]',
      rejected_below_threshold_ids_json TEXT NOT NULL DEFAULT '[]',
      redundancy_rejected_ids_json TEXT NOT NULL DEFAULT '[]',
      selected_json TEXT NOT NULL DEFAULT '[]',
      budget_ceiling INTEGER NOT NULL DEFAULT 0,
      used_tokens INTEGER NOT NULL DEFAULT 0,
      overflow INTEGER NOT NULL DEFAULT 0 CHECK (overflow IN (0, 1)),
      counting_method TEXT NOT NULL,
      ranking_policy_version TEXT NOT NULL,
      prompt_format_version TEXT NOT NULL,
      skip_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES memory_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS memory_recall_events_project_created_idx
      ON memory_recall_events(profile_id, project_id, created_at, id);

    CREATE TABLE IF NOT EXISTS project_tasks (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('waiting', 'starting', 'started', 'completed')),
      agent_profile_id TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      skill_mode TEXT NOT NULL CHECK (skill_mode IN ('all', 'enabled', 'disabled')),
      skills_json TEXT NOT NULL DEFAULT '[]',
      worktree_json TEXT NOT NULL DEFAULT '{"mode":"none"}',
      session_id TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS project_tasks_project_status_created_idx
      ON project_tasks(project_path, status, created_at, id);

    CREATE INDEX IF NOT EXISTS project_tasks_status_created_idx
      ON project_tasks(status, created_at, id);

  `);

  ensureColumn(db, 'agent_profile_settings', 'automation_provider', 'TEXT');
  ensureColumn(db, 'agent_profile_settings', 'automation_model_id', 'TEXT');
  db.exec(`
    UPDATE agent_profile_settings
    SET automation_provider = auto_rename_provider,
        automation_model_id = auto_rename_model_id
    WHERE (automation_provider IS NULL OR automation_model_id IS NULL)
      AND auto_rename_provider IS NOT NULL
      AND auto_rename_model_id IS NOT NULL
  `);

  ensureColumn(db, 'sessions', 'absolute_expires_at', 'TEXT');
  db.prepare('UPDATE sessions SET absolute_expires_at = expires_at WHERE absolute_expires_at IS NULL').run();
  ensureColumn(db, 'memories', 'supersedes_revision', 'INTEGER');
  ensureColumn(db, 'memories', 'pinned_applicability', "TEXT NOT NULL DEFAULT 'always' CHECK (pinned_applicability IN ('always', 'matched'))");
  ensureColumn(db, 'memories', 'positive_utility_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memories', 'negative_utility_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memories', 'last_utility_at', 'TEXT');
  ensureColumn(db, 'memory_extraction_runs', 'discarded_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memory_extraction_runs', 'gate_decision', "TEXT CHECK (gate_decision IN ('extract', 'skip'))");
  ensureColumn(db, 'memory_extraction_runs', 'gate_reason_code', 'TEXT');
  ensureColumn(db, 'memory_extraction_runs', 'normalized_evidence_count', 'INTEGER');
  ensureColumn(db, 'memory_extraction_runs', 'input_tokens', 'INTEGER');
  ensureColumn(db, 'memory_extraction_runs', 'output_tokens', 'INTEGER');
  ensureColumn(db, 'memory_extraction_runs', 'cache_read_tokens', 'INTEGER');
  ensureColumn(db, 'memory_extraction_runs', 'cache_write_tokens', 'INTEGER');
  ensureColumn(db, 'memory_extraction_runs', 'token_accounting_method', 'TEXT');
  ensureColumn(db, 'memory_extraction_runs', 'prompt_format_version', 'TEXT');
  ensureColumn(db, 'memory_extraction_runs', 'emitted_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memory_extraction_runs', 'validated_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memory_extraction_runs', 'created_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memory_extraction_runs', 'duplicate_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memory_extraction_runs', 'replaced_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'project_tasks', 'gitea_issue_owner', 'TEXT');
  ensureColumn(db, 'project_tasks', 'gitea_issue_repo', 'TEXT');
  ensureColumn(db, 'project_tasks', 'gitea_issue_number', 'INTEGER');
  ensureColumn(db, 'project_tasks', 'gitea_issue_url', 'TEXT');
  ensureColumn(db, 'project_tasks', 'gitea_issue_created_at', 'TEXT');

  if (isPersistent) {
    for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, 0o600);
      }
    }
  }

  return db;
}

function migrateSessionBuiltinEventsTable(db: PiuiDatabase): void {
  if (!tableExists(db, 'session_builtin_events')) return;
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_builtin_events'").get() as { sql?: string } | undefined;
  if (table?.sql?.includes("'branch_deleted'")) return;

  db.exec(`
    ALTER TABLE session_builtin_events RENAME TO session_builtin_events_legacy;
    CREATE TABLE session_builtin_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('commit_created', 'commit_amended', 'pr_created', 'branch_deleted')),
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    INSERT INTO session_builtin_events (id, session_id, kind, data_json, created_at)
      SELECT id, session_id, kind, data_json, created_at FROM session_builtin_events_legacy;
    DROP TABLE session_builtin_events_legacy;
  `);
}

function ensureColumn(db: PiuiDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function tableExists(db: PiuiDatabase, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return Boolean(row);
}
