import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database';
import { SkillPolicyStore } from './skill-policy-store';

describe('SkillPolicyStore', () => {
  let tempDir: string;
  let db: PiCloudDatabase;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-skill-policy-store-'));
    db = openPiCloudDatabase(path.join(tempDir, 'pi-cloud.sqlite'));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('round-trips a session skill policy', () => {
    const store = new SkillPolicyStore(db);

    store.save({
      sessionId: 'session-1',
      username: 'me',
      mode: 'disabled',
      skills: ['brainstorming', 'frontend-design'],
      presetId: null,
    });

    expect(store.get('session-1')).toEqual({
      sessionId: 'session-1',
      username: 'me',
      mode: 'disabled',
      skills: ['brainstorming', 'frontend-design'],
      presetId: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('deletes a stored session skill policy', () => {
    const store = new SkillPolicyStore(db);

    store.save({
      sessionId: 'session-1',
      username: 'me',
      mode: 'enabled',
      skills: ['systematic-debugging'],
    });

    store.delete('session-1');

    expect(store.get('session-1')).toBeNull();
  });
});
