interface ChatQueue {
  tail: Promise<void>;
  pending: Set<AbortController>;
  active?: { controller: AbortController; startedAt: number };
}

export class GatewayMessageQueue {
  private readonly chats = new Map<string, ChatQueue>();

  constructor(private readonly now = Date.now) {}

  enqueue(clientId: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    let chat = this.chats.get(clientId);
    if (!chat) {
      chat = { tail: Promise.resolve(), pending: new Set() };
      this.chats.set(clientId, chat);
    }
    const state = chat;
    const controller = new AbortController();
    state.pending.add(controller);
    const next = state.tail.catch(() => undefined).then(async () => {
      state.pending.delete(controller);
      if (controller.signal.aborted) return;
      state.active = { controller, startedAt: this.now() };
      try {
        await work(controller.signal);
      } finally {
        state.active = undefined;
      }
    }).finally(() => {
      if (state.tail === next) this.chats.delete(clientId);
    });
    state.tail = next;
    return next;
  }

  stop(clientId: string): number {
    const chat = this.chats.get(clientId);
    if (!chat) return 0;
    const count = chat.pending.size + (chat.active && !chat.active.controller.signal.aborted ? 1 : 0);
    chat.active?.controller.abort();
    for (const controller of chat.pending) controller.abort();
    chat.pending.clear();
    return count;
  }

  status(clientId: string) {
    const chat = this.chats.get(clientId);
    return {
      running: Boolean(chat?.active),
      stopping: Boolean(chat?.active?.controller.signal.aborted),
      elapsedSeconds: chat?.active ? Math.max(0, Math.floor((this.now() - chat.active.startedAt) / 1000)) : 0,
      pending: chat?.pending.size || 0,
    };
  }

  formatStatus(clientId: string): string {
    const status = this.status(clientId);
    return `- Execution: ${status.stopping ? 'stopping' : status.running ? 'running' : 'idle'}\n- Elapsed: ${status.elapsedSeconds}s\n- Pending messages: ${status.pending}`;
  }
}

export function isImmediateGatewayCommand(text: string): boolean {
  return /^\/(?:stop|abort|status)(?:\s|$)/i.test(text.trim())
    || /^\/task\s+(?:list|status|result|stop)(?:\s|$)/i.test(text.trim());
}

export async function requestGatewayAbort(session: { abort(): Promise<void> } | undefined): Promise<void> {
  if (!session) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => session.abort()),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
