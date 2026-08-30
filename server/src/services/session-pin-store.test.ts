import { afterEach, describe, expect, it } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database.js';
import { DEFAULT_PIN_GROUP_ID, SessionPinStore } from './session-pin-store.js';

describe('SessionPinStore', () => {
  let db: PiCloudDatabase;

  afterEach(() => db?.close());

  it('isolates groups and pins by profile or review source owner', () => {
    db = openPiCloudDatabase(':memory:');
    const store = new SessionPinStore(db);
    const defaultProfile = { type: 'profile', id: 'default' } as const;
    const workProfile = { type: 'profile', id: 'work' } as const;
    const codexSource = { type: 'review', id: 'codex' } as const;

    expect(store.listGroups(defaultProfile)).toMatchObject([
      { id: DEFAULT_PIN_GROUP_ID, name: 'Default', isDefault: true },
    ]);
    expect(store.listGroups(workProfile)).toMatchObject([
      { id: DEFAULT_PIN_GROUP_ID, name: 'Default', isDefault: true },
    ]);

    const group = store.createGroup(defaultProfile, 'Important');
    store.pinSession(defaultProfile, 'session-1', group.id);
    store.pinSession(workProfile, 'session-1', DEFAULT_PIN_GROUP_ID);
    store.pinSession(codexSource, 'session-1', DEFAULT_PIN_GROUP_ID);

    expect(store.listSessionIdsByGroup(defaultProfile).get(group.id)).toEqual(['session-1']);
    expect(store.listSessionIdsByGroup(workProfile).get(DEFAULT_PIN_GROUP_ID)).toEqual(['session-1']);
    expect(store.listSessionIdsByGroup(codexSource).get(DEFAULT_PIN_GROUP_ID)).toEqual(['session-1']);
    expect(store.listGroups(workProfile)).toHaveLength(1);

    store.unpinSession(workProfile, 'session-1');
    expect(store.listSessionIdsByGroup(workProfile).get(DEFAULT_PIN_GROUP_ID)).toBeUndefined();
    expect(store.listSessionIdsByGroup(codexSource).get(DEFAULT_PIN_GROUP_ID)).toEqual(['session-1']);
  });
});
