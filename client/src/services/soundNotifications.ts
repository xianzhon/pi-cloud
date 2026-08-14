import type { SoundNotificationPreference } from '../composables/usePreferences';

let audioContext: AudioContext | null = null;
let initialized = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) audioContext = new AudioContextCtor();
  return audioContext;
}

function unlockAudioContext(): void {
  const context = getAudioContext();
  if (!context || context.state !== 'suspended') return;
  void context.resume().catch(() => {
    // Browsers may still block audio until a later user gesture.
  });
}

export function initSoundNotifications(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const unlock = () => unlockAudioContext();
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock, { passive: true });
}

export function playTaskNotification(sound: SoundNotificationPreference): void {
  if (sound === 'off') return;

  const context = getAudioContext();
  if (!context) return;

  const play = () => playNotificationPattern(context, sound);

  if (context.state === 'suspended') {
    void context.resume().then(play).catch(() => {
      // Autoplay policy can deny audio if the tab has not received a user gesture.
    });
    return;
  }

  play();
}

function playNotificationPattern(context: AudioContext, sound: Exclude<SoundNotificationPreference, 'off'>): void {
  const now = context.currentTime;
  if (sound === 'chime') {
    playTone(context, 523, now, 0.09);
    playTone(context, 659, now + 0.1, 0.09);
    playTone(context, 784, now + 0.2, 0.14);
    return;
  }
  if (sound === 'ding') {
    playTone(context, 1046, now, 0.18);
    return;
  }
  playTone(context, 880, now, 0.09);
  playTone(context, 660, now + 0.11, 0.12);
}

function playTone(context: AudioContext, frequency: number, start: number, duration: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.08, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}
