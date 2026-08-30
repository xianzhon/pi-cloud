import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openPiCloudDatabase } from './database';
import { runDatabaseMigrations } from './migrations/index';

describe('openPiCloudDatabase', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-db-'));
    dbPath = path.join(tempDir, 'nested', 'pi-cloud.sqlite');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates parent directories and required tables', () => {
    const db = openPiCloudDatabase(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB 'memory_fts_*' ORDER BY name")
      .all()
      .map((row: any) => row.name);

    expect(tables).toEqual([
      'agent_profile_settings',
      'audit_events',
      'commit_message_prompts',
      'feishu_gateway_configs',
      'feishu_gateway_sessions',
      'memories',
      'memory_extraction_runs',
      'memory_fts',
      'memory_projects',
      'memory_recall_events',
      'project_history',
      'project_tasks',
      'review_sources',
      'schema_migrations',
      'security_settings',
      'session_builtin_events',
      'session_pin_groups',
      'session_pins',
      'session_skill_policies',
      'session_worktrees',
      'sessions',
      'skill_presets',
      'weixin_gateway_configs',
      'weixin_gateway_context_tokens',
      'weixin_gateway_credentials',
      'weixin_gateway_sessions',
      'weixin_gateway_state',
    ]);
    const columns = db.prepare('PRAGMA table_info(project_tasks)').all() as Array<{ name: string; notnull: number }>;
    expect(columns.map((column) => column.name)).toEqual([
      'id', 'project_path', 'title', 'prompt', 'notes', 'status',
      'agent_profile_id', 'model_provider', 'model_id', 'skill_mode',
      'skills_json', 'preset_id', 'worktree_json', 'session_id', 'created_at',
      'updated_at', 'started_at', 'completed_at', 'gitea_issue_owner',
      'gitea_issue_repo', 'gitea_issue_number', 'gitea_issue_url',
      'gitea_issue_created_at',
    ]);
    expect(columns.find((column) => column.name === 'prompt')?.notnull).toBe(1);

    const memoryColumns = db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string; dflt_value: string | null }>;
    expect(memoryColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'pinned_applicability',
      'positive_utility_count',
      'negative_utility_count',
      'last_utility_at',
    ]));
    expect(memoryColumns.find((column) => column.name === 'pinned_applicability')?.dflt_value).toBe("'always'");

    const extractionColumns = db.prepare('PRAGMA table_info(memory_extraction_runs)').all() as Array<{ name: string }>;
    expect(extractionColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'gate_decision',
      'gate_reason_code',
      'normalized_evidence_count',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'token_accounting_method',
      'prompt_format_version',
      'emitted_count',
      'validated_count',
      'created_count',
      'duplicate_count',
      'replaced_count',
    ]));

    const recallColumns = db.prepare('PRAGMA table_info(memory_recall_events)').all() as Array<{ name: string }>;
    expect(recallColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'candidate_ids_json',
      'rejected_below_threshold_ids_json',
      'redundancy_rejected_ids_json',
      'selected_json',
      'budget_ceiling',
      'used_tokens',
      'overflow',
      'counting_method',
      'ranking_policy_version',
      'prompt_format_version',
      'skip_reason',
    ]));
    db.close();
  });

  it.runIf(process.platform !== 'win32')('restricts database and journal files to the current user', async () => {
    const db = openPiCloudDatabase(dbPath);
    db.exec('CREATE TABLE permission_check (id INTEGER); INSERT INTO permission_check VALUES (1);');

    for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      const stats = await fs.stat(filePath);
      expect(stats.mode & 0o777).toBe(0o600);
    }

    db.close();
  });

  it('migrates session activity to support branch deletion events', async () => {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE session_builtin_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('commit_created', 'commit_amended', 'pr_created')),
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      INSERT INTO session_builtin_events (session_id, kind, data_json, created_at)
        VALUES ('session-1', 'commit_created', '{}', '2026-07-22T00:00:00.000Z');
    `);
    legacyDb.close();

    const db = openPiCloudDatabase(dbPath);
    expect(() => db.prepare(`INSERT INTO session_builtin_events (session_id, kind, data_json, created_at)
      VALUES (?, 'branch_deleted', '{}', ?)`)
      .run('session-1', '2026-07-22T00:00:01.000Z')).not.toThrow();
    expect(db.prepare('SELECT kind FROM session_builtin_events ORDER BY id').all()).toEqual([
      { kind: 'commit_created' },
      { kind: 'branch_deleted' },
    ]);
    db.close();
  });

  it('adds memory-efficiency columns to an existing memory schema with compatible defaults', async () => {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE memory_projects (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, canonical_path TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (profile_id, canonical_path)
      );
      CREATE TABLE memory_extraction_runs (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, project_id TEXT NOT NULL,
        source_session_id TEXT NOT NULL, source_session_path TEXT NOT NULL,
        source_kind TEXT NOT NULL, starting_leaf_id TEXT, ending_leaf_id TEXT NOT NULL,
        status TEXT NOT NULL, model_provider TEXT, model_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        discarded_count INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL,
        started_at TEXT, completed_at TEXT, UNIQUE (source_session_id, ending_leaf_id, source_kind)
      );
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, project_id TEXT, scope TEXT NOT NULL,
        category TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, source TEXT NOT NULL, source_session_id TEXT, source_entry_id TEXT,
        evidence TEXT, extraction_run_id TEXT, supersedes_id TEXT, supersedes_revision INTEGER,
        revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        last_used_at TEXT, use_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO memory_projects VALUES ('project-1', 'default', '/workspace', 'now', 'now');
      INSERT INTO memories (
        id, profile_id, project_id, scope, category, content, content_hash, tags_json,
        pinned, status, source, revision, created_at, updated_at, use_count
      ) VALUES ('memory-1', 'default', 'project-1', 'project', 'rule', 'Run tests', 'hash', '[]',
        1, 'active', 'manual_ui', 1, 'now', 'now', 3);
      INSERT INTO memory_extraction_runs (
        id, profile_id, project_id, source_session_id, source_session_path, source_kind,
        ending_leaf_id, status, attempts, discarded_count, created_at
      ) VALUES ('run-1', 'default', 'project-1', 'session-1', '/session.jsonl', 'automatic',
        'leaf-1', 'completed', 1, 0, 'now');
    `);
    legacyDb.close();

    const db = openPiCloudDatabase(dbPath);
    expect(db.prepare(`SELECT pinned_applicability, positive_utility_count,
      negative_utility_count, last_utility_at, use_count FROM memories WHERE id = 'memory-1'`).get()).toEqual({
      pinned_applicability: 'always',
      positive_utility_count: 0,
      negative_utility_count: 0,
      last_utility_at: null,
      use_count: 3,
    });
    expect(db.prepare(`SELECT gate_decision, normalized_evidence_count, input_tokens,
      prompt_format_version FROM memory_extraction_runs WHERE id = 'run-1'`).get()).toEqual({
      gate_decision: null,
      normalized_evidence_count: null,
      input_tokens: null,
      prompt_format_version: null,
    });
    db.close();
  });

  it('indexes memory content and tags with FTS5', () => {
    const db = openPiCloudDatabase(':memory:');
    db.prepare(`INSERT INTO memory_projects (id, profile_id, canonical_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run('project-1', 'default', '/workspace', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z');
    db.prepare(`INSERT INTO memories (
      id, profile_id, project_id, scope, category, content, content_hash, tags_json,
      pinned, status, source, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', 'manual_ui', 1, ?, ?)`)
      .run(
        'memory-1', 'default', 'project-1', 'project', 'pitfall',
        'Clamp keyboard selection to visible results', 'hash-1', '["keyboard","selection"]',
        '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z',
      );

    expect(db.prepare(`SELECT memory_id FROM memory_fts WHERE memory_fts MATCH 'keyboard'`).all())
      .toEqual([{ memory_id: 'memory-1' }]);
    db.close();
  });

  it('records migrations and does not reapply them', () => {
    const db = openPiCloudDatabase(':memory:');

    expect(db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1, name: 'application-schema' },
      { version: 2, name: 'gateway-schema' },
      { version: 3, name: 'project-history-schema' },
    ]);

    runDatabaseMigrations(db);
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 3 });
    db.close();
  });

  it('adds gateway config columns to existing tables after inspecting their schema', async () => {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE feishu_gateway_configs (
        client_id TEXT PRIMARY KEY, agent_profile TEXT, default_cwd TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE weixin_gateway_configs (
        client_id TEXT PRIMARY KEY, agent_profile TEXT, default_cwd TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    legacyDb.close();

    const db = openPiCloudDatabase(dbPath);
    for (const table of ['feishu_gateway_configs', 'weixin_gateway_configs']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['skill_mode', 'skill_preset_id']));
    }
    db.close();
  });

  it('rolls back a failed migration without recording it', () => {
    const db = new Database(':memory:');
    db.exec('CREATE VIEW project_tasks AS SELECT 1 AS id');

    expect(() => runDatabaseMigrations(db)).toThrow();
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()).toBeUndefined();
    db.close();
  });

  it('surfaces gateway migration errors instead of treating them as duplicate columns', () => {
    const db = new Database(':memory:');
    db.exec('CREATE VIEW feishu_gateway_configs AS SELECT 1 AS client_id');

    expect(() => runDatabaseMigrations(db)).toThrow();
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1 }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'weixin_gateway_sessions'").get()).toBeUndefined();
    db.close();
  });

  it('enables foreign keys and wal mode', () => {
    const db = openPiCloudDatabase(dbPath);

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    db.close();
  });
});
