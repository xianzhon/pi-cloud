import { afterEach, describe, expect, it } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database.js';
import { DEFAULT_PIN_GROUP_ID, SessionPinStore } from './session-pin-store.js';

describe('SessionPinStore', () => {
  let db: PiuiDatabase;

  afterEach(() => db?.close());

  it('creates the default group and assigns a session to any selected group', () => {
    db = openPiuiDatabase(':memory:');
    const store = new SessionPinStore(db);

    expect(store.listGroups()).toMatchObject([
      { id: DEFAULT_PIN_GROUP_ID, name: 'Default', isDefault: true },
    ]);

    const group = store.createGroup('Important');
    store.pinSession('session-1', group.id);
    expect(store.listSessionIdsByGroup().get(group.id)).toEqual(['session-1']);

    store.pinSession('session-1', DEFAULT_PIN_GROUP_ID);
    expect(store.listSessionIdsByGroup().get(group.id)).toBeUndefined();
    expect(store.listSessionIdsByGroup().get(DEFAULT_PIN_GROUP_ID)).toEqual(['session-1']);
  });
});
