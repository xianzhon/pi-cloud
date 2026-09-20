import type { FastifyInstance } from 'fastify';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

interface ShutdownProcess {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
  exit(code: number): void;
}

// Leave time before stop.sh's five-second force-kill deadline.
const SHUTDOWN_TIMEOUT_MS = 4_000;

export function installGracefulShutdown(app: FastifyInstance, runtime: ShutdownProcess = process): void {
  let shuttingDown = false;
  let requestedExitCode: number | undefined;

  function exit(code: number): void {
    if (requestedExitCode !== undefined) return;
    requestedExitCode = code;
    runtime.exit(code);
  }

  function removeListeners(): void {
    runtime.off('SIGINT', shutdown);
    runtime.off('SIGTERM', shutdown);
  }

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => {
      app.log.error('Graceful shutdown timed out');
      exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    try {
      await app.close();
      exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Graceful shutdown failed');
      exit(1);
    } finally {
      clearTimeout(timeout);
      removeListeners();
    }
  }

  runtime.on('SIGINT', shutdown);
  runtime.on('SIGTERM', shutdown);
  app.addHook('onClose', async () => {
    // Signal-driven shutdown must keep handling repeated signals until cleanup finishes.
    if (!shuttingDown) removeListeners();
  });
}
