import { randomUUID } from 'node:crypto';
import type { PiCloudDatabase } from '../db/database.js';
import type {
  Routine,
  RoutineInput,
  Run,
  RunStatus,
  Delivery,
} from './types.js';
import { nextOccurrence, validateSchedule } from './schedule.js';
function notificationText(value: string): string {
  let bytes = 0;
  let result = '';
  for (const character of value) {
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > 3600) break;
    result += character;
  }
  return result;
}
const active = (run: Run) =>
  run.status === 'queued' || run.status === 'running';
export class RoutineError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
export class RoutineStore {
  constructor(private db: PiCloudDatabase) {}
  private rows<T>(
    table: 'routines' | 'routine_runs' | 'routine_deliveries',
    status?: string,
  ): T[] {
    return (
      this.db
        .prepare(
          `SELECT data FROM ${table}${status ? ' WHERE status=?' : ''} ORDER BY rowid`,
        )
        .all(...(status ? [status] : [])) as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data));
  }
  list(): Routine[] {
    return this.rows<Routine>('routines');
  }
  private one<T>(table: string, id: string): T | undefined {
    const row = this.db
      .prepare(`SELECT data FROM ${table} WHERE id=?`)
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  private hasActive(id: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM routine_runs WHERE routine_id=? AND status IN ('queued','running') LIMIT 1",
        )
        .get(id),
    );
  }
  get(id: string): Routine {
    const item = this.one<Routine>('routines', id);
    if (!item) throw new RoutineError('Routine not found', 404);
    return item;
  }
  run(id: string): Run {
    const item = this.one<Run>('routine_runs', id);
    if (!item) throw new RoutineError('Run not found', 404);
    return { ...item, delivery: this.delivery(id) };
  }
  private delivery(runId: string): Delivery | undefined {
    const row = this.db
      .prepare('SELECT data FROM routine_deliveries WHERE run_id=?')
      .get(runId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  history(offset = 0, limit = 50): Run[] {
    return (
      this.db
        .prepare(
          'SELECT data FROM routine_runs ORDER BY rowid DESC LIMIT ? OFFSET ?',
        )
        .all(limit, offset) as { data: string }[]
    ).map((row) => {
      const run: Run = JSON.parse(row.data);
      return { ...run, delivery: this.delivery(run.id) };
    });
  }

  latestRuns(): Run[] {
    return (
      this.db
        .prepare(
          `SELECT id FROM routine_runs WHERE rowid IN (
      SELECT MAX(rowid) FROM routine_runs GROUP BY routine_id
    )`,
        )
        .all() as { id: string }[]
    ).map((row) => this.run(row.id));
  }

  private saveRoutine(r: Routine) {
    this.db
      .prepare(
        'INSERT INTO routines VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(r.id, JSON.stringify(r));
  }
  private saveRun(r: Run) {
    const { delivery: _delivery, ...data } = r;
    this.db
      .prepare(
        'INSERT INTO routine_runs VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data',
      )
      .run(r.id, r.routineId, r.occurrence, r.status, JSON.stringify(data));
  }
  saveDelivery(d: Delivery) {
    this.db
      .prepare(
        'INSERT INTO routine_deliveries VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data',
      )
      .run(d.id, d.runId, d.status, JSON.stringify(d));
  }
  private validate(input: RoutineInput) {
    for (const key of [
      'name',
      'prompt',
      'projectPath',
      'profileId',
      'provider',
      'modelId',
    ] as const)
      if (typeof input[key] !== 'string' || !input[key].trim())
        throw new RoutineError(`${key} is required`);
    if (input.name.length > 200 || input.prompt.length > 50000)
      throw new RoutineError('Name or prompt too long');
    if (typeof input.enabled !== 'boolean')
      throw new RoutineError('Invalid enabled value');
    if (
      !Number.isInteger(input.timeoutMinutes) ||
      input.timeoutMinutes < 1 ||
      input.timeoutMinutes > 120
    )
      throw new RoutineError('Timeout must be between 1 and 120 minutes');
    if (
      input.notificationChannelId !== null &&
      typeof input.notificationChannelId !== 'string'
    )
      throw new RoutineError('Invalid notification channel');
    validateSchedule(input.schedule);
  }
  create(input: RoutineInput, now = new Date().toISOString()): Routine {
    this.validate(input);
    const next = nextOccurrence(input.schedule, now);
    if (input.schedule.kind === 'once' && !next)
      throw new RoutineError('One-time schedule must be in the future');
    const r: Routine = {
      ...input,
      id: randomUUID(),
      revision: 1,
      nextRunAt: next,
      createdAt: now,
      updatedAt: now,
    };
    this.saveRoutine(r);
    return r;
  }
  update(
    id: string,
    input: RoutineInput,
    now = new Date().toISOString(),
  ): Routine {
    return this.db.transaction(() => {
      this.validate(input);
      const old = this.get(id);
      if (input.revision !== old.revision)
        throw new RoutineError('Routine changed; reload before saving', 409);
      const r: Routine = {
        ...input,
        id,
        revision: old.revision + 1,
        createdAt: old.createdAt,
        updatedAt: now,
        nextRunAt: nextOccurrence(input.schedule, now),
      };
      this.saveRoutine(r);
      for (const run of this.queued())
        if (
          run.routineId === id &&
          run.trigger === 'scheduled' &&
          run.status === 'queued'
        )
          this.settle(
            run.id,
            'cancelled',
            '',
            'Routine configuration changed',
            now,
          );
      return r;
    })();
  }
  delete(id: string) {
    this.get(id);
    if (this.hasActive(id))
      throw new RoutineError('Cancel active work before deleting', 409);
    this.db.prepare('DELETE FROM routines WHERE id=?').run(id);
  }
  private enqueue(
    r: Routine,
    trigger: Run['trigger'],
    occurrence: string,
    now: string,
  ): Run {
    if (this.hasActive(r.id))
      throw new RoutineError('Routine already has active work', 409);
    const run: Run = {
      id: randomUUID(),
      routineId: r.id,
      trigger,
      occurrence,
      snapshot: r,
      status: 'queued',
      sessionId: null,
      sessionPath: null,
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      summary: '',
      error: null,
    };
    this.saveRun(run);
    return run;
  }
  manual(id: string, now = new Date().toISOString()): Run {
    return this.db.transaction(() =>
      this.enqueue(this.get(id), 'manual', randomUUID(), now),
    )();
  }
  materialize(now: string) {
    this.db.transaction(() => {
      for (const r of this.list()) {
        if (!r.enabled || !r.nextRunAt || r.nextRunAt > now) continue;
        if (this.hasActive(r.id)) continue;
        this.enqueue(r, 'scheduled', `${r.revision}:${r.nextRunAt}`, now);
        r.nextRunAt = nextOccurrence(r.schedule, now);
        this.saveRoutine(r);
      }
    })();
  }
  queued(): Run[] {
    return this.rows<Run>('routine_runs', 'queued');
  }
  claim(id: string, now = new Date().toISOString()): Run {
    return this.db.transaction(() => {
      const r = this.run(id);
      if (r.status !== 'queued')
        throw new RoutineError('Run is not queued', 409);
      r.status = 'running';
      r.startedAt = now;
      this.saveRun(r);
      return r;
    })();
  }
  attachSession(id: string, sessionId: string, sessionPath: string | null) {
    const r = this.run(id);
    r.sessionId = sessionId;
    r.sessionPath = sessionPath;
    this.saveRun(r);
  }
  settle(
    id: string,
    status: RunStatus,
    summary = '',
    error: string | null = null,
    now = new Date().toISOString(),
  ) {
    this.db.transaction(() => {
      const r = this.run(id);
      if (!active(r)) return;
      r.status = status;
      r.summary = summary.slice(0, 8000);
      r.error = error?.slice(0, 8000) || null;
      r.finishedAt = now;
      this.saveRun(r);
      if (r.snapshot.notificationChannelId && !r.delivery)
        this.saveDelivery({
          id: randomUUID(),
          runId: id,
          channelId: r.snapshot.notificationChannelId,
          message: notificationText(
            `${r.snapshot.name}: ${status}\nRun: ${id}\n${r.summary || r.error || ''}`,
          ),
          status: 'pending',
          attempts: 0,
          nextAttemptAt: now,
          error: null,
        });
    })();
  }
  recover(now = new Date().toISOString()) {
    for (const r of this.rows<Run>('routine_runs', 'running'))
      if (r.status === 'running')
        this.settle(r.id, 'interrupted', '', 'Server restarted', now);
    for (const d of this.rows<Delivery>('routine_deliveries', 'sending'))
      if (d.status === 'sending')
        this.saveDelivery({
          ...d,
          status: d.attempts >= 4 ? 'failed' : 'pending',
          error: 'Server restarted during delivery; acceptance is unknown',
        });
  }
  pendingDeliveries(now: string): Delivery[] {
    return this.rows<Delivery>('routine_deliveries', 'pending').filter(
      (d) => d.status === 'pending' && d.nextAttemptAt <= now,
    );
  }
  retryDelivery(id: string) {
    const d = this.run(id).delivery;
    if (!d || d.status !== 'failed')
      throw new RoutineError('Delivery is not failed', 409);
    this.saveDelivery({
      ...d,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      error: null,
    });
  }
}
