import { beforeEach, describe, expect, it, vi } from 'vitest';

function audio(state: AudioContextState = 'running') {
  const oscillator = { type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  const context = { state, currentTime: 1, destination: {}, resume: vi.fn().mockResolvedValue(undefined), createOscillator: vi.fn(() => oscillator), createGain: vi.fn(() => gain) };
  return { context, oscillator, gain };
}

describe('sound notifications', () => {
  beforeEach(() => vi.resetModules());

  it('initializes unlock listeners once and resumes suspended audio', async () => {
    const { context } = audio('suspended');
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: vi.fn(function () { return context; }) });
    const add = vi.spyOn(window, 'addEventListener');
    const { initSoundNotifications } = await import('./soundNotifications');
    initSoundNotifications();
    initSoundNotifications();
    expect(add).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('pointerdown'));
    expect(context.resume).toHaveBeenCalled();
  });

  it.each([
    ['chime', 3], ['ding', 1], ['beep', 2],
  ] as const)('plays the %s pattern', async (sound, tones) => {
    const { context } = audio();
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: vi.fn(function () { return context; }) });
    const { playTaskNotification } = await import('./soundNotifications');
    playTaskNotification(sound);
    expect(context.createOscillator).toHaveBeenCalledTimes(tones);
  });

  it('does nothing when sound is off or audio is unsupported', async () => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    const { playTaskNotification } = await import('./soundNotifications');
    expect(() => playTaskNotification('off')).not.toThrow();
    expect(() => playTaskNotification('ding')).not.toThrow();
  });

  it('resumes before playing and tolerates denied autoplay', async () => {
    const first = audio('suspended');
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: vi.fn(function () { return first.context; }) });
    let module = await import('./soundNotifications');
    module.playTaskNotification('ding');
    await Promise.resolve();
    expect(first.context.createOscillator).toHaveBeenCalled();

    vi.resetModules();
    const second = audio('suspended');
    second.context.resume.mockRejectedValue(new Error('denied'));
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: vi.fn(function () { return second.context; }) });
    module = await import('./soundNotifications');
    module.playTaskNotification('ding');
    await Promise.resolve();
    expect(second.context.createOscillator).not.toHaveBeenCalled();
  });
});
