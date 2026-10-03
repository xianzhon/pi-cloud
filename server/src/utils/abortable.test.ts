import { describe, expect, it } from 'vitest';
import { abortable } from './abortable.js';

describe('abortable', () => {
  it('rejects pending work on cancellation and handles a later rejection', async () => {
    const controller = new AbortController();
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
    const result = abortable(() => pending, controller.signal);
    controller.abort(new Error('shutdown'));
    await expect(result).rejects.toThrow('shutdown');
    reject(new Error('late failure'));
  });

  it('does not start work after cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('shutdown'));
    let started = false;
    await expect(abortable(async () => { started = true; }, controller.signal)).rejects.toThrow('shutdown');
    expect(started).toBe(false);
  });

  it('returns successful work', async () => {
    expect(await abortable(async () => 42, new AbortController().signal)).toBe(42);
  });
});
