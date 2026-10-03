import type { Schedule } from './types.js';
export function validateSchedule(schedule: Schedule): void {
  if (!schedule || !['once', 'interval', 'daily'].includes(schedule.kind))
    throw new Error('Invalid schedule');
  if (schedule.kind === 'daily') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time))
      throw new Error('Invalid daily time');
  } else {
    if (!Number.isFinite(Date.parse(schedule.startAt)))
      throw new Error('Invalid start time');
    if (
      schedule.kind === 'interval' &&
      (!Number.isInteger(schedule.minutes) ||
        schedule.minutes < 5 ||
        schedule.minutes > 525600)
    )
      throw new Error('Interval must be between 5 and 525600 minutes');
  }
}
export function nextOccurrence(
  schedule: Schedule,
  after: string,
): string | null {
  validateSchedule(schedule);
  const now = Date.parse(after);
  if (schedule.kind === 'daily') {
    const next = new Date(now);
    const [hour, minute] = schedule.time.split(':').map(Number);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  const start = Date.parse(schedule.startAt);
  if (start > now) return new Date(start).toISOString();
  if (schedule.kind === 'once') return null;
  const step = schedule.minutes * 60000;
  return new Date(
    start + (Math.floor((now - start) / step) + 1) * step,
  ).toISOString();
}
