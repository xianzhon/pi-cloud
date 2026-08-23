import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openPiuiDatabase } from '../db/database.js';
import { reviewSourceRoutes } from './review-sources.js';
import { ReviewSourceService } from '../services/review-source-service.js';
import { ReviewSourceStore } from '../services/review-source-store.js';
import { DEFAULT_PIN_GROUP_ID, SessionPinStore } from '../services/session-pin-store.js';

describe('review source routes', () => {
  let tempDir: string;
  let dbPath: string;
  let db: Database.Database;
  let store: ReviewSourceStore;
  let service: ReviewSourceService;
  let pinStore: SessionPinStore;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'pi-webui-review-routes-'));
    dbPath = path.join(tempDir, 'piui.db');
    db = openPiuiDatabase(dbPath);
    store = new ReviewSourceStore(db, []);
    service = new ReviewSourceService(store);
    pinStore = new SessionPinStore(db);
    app = Fastify();
    await app.register(reviewSourceRoutes, { prefix: '/api/review-sources', reviewSourceService: service, pinStore });
  });

  afterEach(async () => {
    await app.close();
    db.close();
    await rm(tempDir, { recursive: true, force: true });
    try { await rm(`${dbPath}-wal`, { force: true }); } catch {}
    try { await rm(`${dbPath}-shm`, { force: true }); } catch {}
  });

  it('lists review sources and supported types', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/review-sources' });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(Array.isArray(data.sources)).toBe(true);

    const typesResponse = await app.inject({ method: 'GET', url: '/api/review-sources/types' });
    expect(typesResponse.statusCode).toBe(200);
    expect(typesResponse.json().types.map((type: { type: string }) => type.type)).toEqual(['devin', 'claude-code', 'codex']);
  });

  it('creates and deletes a custom source', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/review-sources',
      payload: { type: 'devin', label: 'Custom Devin', dataPath: '/tmp/custom-devin' },
    });
    expect(createResponse.statusCode).toBe(200);
    const { source } = createResponse.json();
    expect(source.type).toBe('devin');
    expect(source.capabilities).toEqual({ canDeleteSource: true, canDeleteSessions: true });

    const deleteResponse = await app.inject({ method: 'DELETE', url: `/api/review-sources/${source.id}` });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it('rejects an unsupported source type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/review-sources',
      payload: { type: 'unknown', label: 'Unknown', dataPath: '/tmp/unknown' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects missing fields on create', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/review-sources',
      payload: { type: 'devin' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('pins and lists review sessions independently by source', async () => {
    const sourceId = 'codex-source';
    const session = {
      id: 'session-1', sourceId, path: '/tmp/session.jsonl', cwd: '/tmp/project',
      created: '2026-08-01T00:00:00.000Z', modified: '2026-08-01T00:00:00.000Z', messageCount: 1,
    };
    service.listSessions = async () => [session];

    const pinResponse = await app.inject({
      method: 'PUT',
      url: `/api/review-sources/${sourceId}/sessions/${session.id}/pin`,
      payload: { groupId: DEFAULT_PIN_GROUP_ID },
    });
    expect(pinResponse.statusCode).toBe(200);

    const groupsResponse = await app.inject({ method: 'GET', url: `/api/review-sources/${sourceId}/pin-groups` });
    expect(groupsResponse.json().groups[0].sessionIds).toEqual([session.id]);

    const pinnedResponse = await app.inject({ method: 'GET', url: `/api/review-sources/${sourceId}/pinned` });
    expect(pinnedResponse.json().groups[0].sessions).toEqual([session]);

    await app.inject({ method: 'DELETE', url: `/api/review-sources/${sourceId}/sessions/${session.id}/pin` });
    expect(pinStore.listSessionIdsByGroup(sourceId).get(DEFAULT_PIN_GROUP_ID)).toBeUndefined();
  });

  it('returns project paths for a Devin review source', async () => {
    const dataPath = path.join(tempDir, 'devin-data');
    await mkdir(dataPath, { recursive: true });
    const db = new Database(path.join(dataPath, 'sessions.db'));
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        working_directory TEXT NOT NULL,
        backend_type TEXT NOT NULL,
        model TEXT NOT NULL,
        agent_mode TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        title TEXT
      );
      INSERT INTO sessions (id, working_directory, backend_type, model, agent_mode, created_at, last_activity_at, title)
      VALUES ('s1', '/tmp/project-a', 'devin', 'kimi', 'normal', 1700000000, 1700000100, 'A');
      INSERT INTO sessions (id, working_directory, backend_type, model, agent_mode, created_at, last_activity_at, title)
      VALUES ('s2', '/tmp/project-b', 'devin', 'kimi', 'normal', 1700000000, 1700000200, 'B');
    `);
    db.close();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/review-sources',
      payload: { type: 'devin', label: 'Devin', dataPath },
    });
    const { source } = createResponse.json();

    const response = await app.inject({ method: 'GET', url: `/api/review-sources/${source.id}/project-paths` });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.projectPaths).toEqual(['/tmp/project-b', '/tmp/project-a']);
  });
});
