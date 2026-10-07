/** Stop waiting on cancellation; work must also guard any subsequent side effects. */
export async function abortable<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return work();
  let cancel!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([interrupted, work()]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
