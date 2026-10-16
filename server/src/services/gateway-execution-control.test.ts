import { describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase } from '../db/database';
import { FeishuGatewayService } from './feishu-gateway';
import { WecomGatewayService } from './wecom-gateway';
import { WeixinGatewayService } from './weixin-gateway';
import type { PiSessionService } from './session-manager';

for (const [name, Gateway, clientId] of [
  ['Feishu', FeishuGatewayService, 'feishu:dm:chat'],
  ['WeCom', WecomGatewayService, 'wecom:dm:user'],
  ['WeChat', WeixinGatewayService, 'weixin:dm:chat'],
] as const) {
  describe(`${name} execution controls`, () => {
    function setup() {
      const db = openPiCloudDatabase(':memory:');
      let finish!: () => void;
      const blocked = new Promise<void>((resolve) => { finish = resolve; });
      const session = {
        prompt: vi.fn(async () => blocked), abort: vi.fn(async () => { finish(); }),
        subscribe: () => () => {}, messages: [], sessionId: 'session-1', model: undefined,
      };
      const sessions = {
        getSession: () => session, listAgentProfiles: async () => [{ id: 'default' }],
        runForegroundWithClientProfileProxy: async (_id: string, fn: () => Promise<void>) => fn(),
        disposeSession: vi.fn(),
      };
      const execute = vi.fn(async () => ({ reply: 'task result' }));
      const gateway = new Gateway(db, undefined, sessions as unknown as PiSessionService, { execute });
      const internal = gateway as any;
      const replies: string[] = [];
      vi.spyOn(internal, 'sendReply').mockImplementation(async (...args: unknown[]) => { replies.push(String(args[2])); });
      vi.spyOn(internal, 'ensureSession').mockResolvedValue(session);
      if (name === 'WeChat') {
        vi.spyOn(internal, 'saveInboundImages').mockResolvedValue(undefined);
        vi.spyOn(internal, 'startTypingIndicator').mockReturnValue(() => {});
      }
      const config = { defaultCwd: '/repo', cwdChoices: ['/repo'] };
      function enqueue(text: string) {
        internal.enqueue({ text, chatId: 'chat', chatType: 'dm', userId: 'user', messageId: 'mid', images: [] }, config);
      }
      return { db, internal, session, sessions, replies, enqueue, finish, execute };
    }
    it('answers status and aborts while a prompt is blocked, cancelling pending messages without resetting history', async () => {
      const { db, session, sessions, replies, enqueue, finish } = setup();
      try {
        enqueue('first');
        await vi.waitFor(() => expect(session.prompt).toHaveBeenCalledOnce());
        enqueue('second');
        enqueue('/status');
        await vi.waitFor(() => expect(replies.some((reply) => reply.includes('Execution: running') && reply.includes('Pending messages: 1'))).toBe(true));
        enqueue('/abort');
        await vi.waitFor(() => expect(session.abort).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(replies.some((reply) => reply.includes('停止'))).toBe(true));
        expect(session.prompt).toHaveBeenCalledOnce();
        expect(sessions.disposeSession).not.toHaveBeenCalled();
      } finally { finish(); await new Promise((resolve) => setTimeout(resolve, 0)); db.close(); }
    });
    it('does not prompt after stop arrives during session preparation', async () => {
      const { db, internal, session, enqueue, finish } = setup();
      let prepared!: () => void;
      const preparing = new Promise<void>((resolve) => { prepared = resolve; });
      internal.ensureSession.mockImplementation(async () => { await preparing; return session; });
      try {
        enqueue('first');
        await vi.waitFor(() => expect(internal.ensureSession).toHaveBeenCalled());
        enqueue('/stop');
        await vi.waitFor(() => expect(session.abort).toHaveBeenCalled());
        prepared();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(session.prompt).not.toHaveBeenCalled();
      } finally { prepared(); finish(); await new Promise((resolve) => setTimeout(resolve, 0)); db.close(); }
    });
    it('dispatches task controls without waiting for or stopping the active chat', async () => {
      const { db, session, replies, enqueue, finish, execute } = setup();
      try {
        enqueue('first');
        await vi.waitFor(() => expect(session.prompt).toHaveBeenCalledOnce());
        for (const command of ['/task list', '/task status 1', '/task result 1', '/task stop 1']) enqueue(command);
        await vi.waitFor(() => expect(replies.filter((reply) => reply === 'task result')).toHaveLength(4));
        expect(execute).toHaveBeenCalledWith({ action: 'stop_task', index: 1 }, expect.any(Object), clientId);
        expect(session.abort).not.toHaveBeenCalled();
        expect(session.prompt).toHaveBeenCalledOnce();
      } finally { finish(); await new Promise((resolve) => setTimeout(resolve, 0)); db.close(); }
    });
    it('reports idle when no chat execution exists', async () => {
      const { db, internal, replies } = setup();
      try {
        await internal.handleCommand(clientId, { text: '/status', messageId: 'mid', userId: 'user', chatId: 'chat' }, {}, {});
        expect(replies[0]).toContain('Execution: idle');
      } finally { db.close(); }
    });
  });
}
