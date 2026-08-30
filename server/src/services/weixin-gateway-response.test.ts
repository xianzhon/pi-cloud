import { describe, expect, it } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { GatewaySettingsStore } from './gateway-settings-store.js';
import { extractLastAssistantText, WeixinGatewayService } from './weixin-gateway.js';

describe('WeixinGatewayService', () => {
  it('removes a saved pairing', async () => {
    const db = openPiCloudDatabase(':memory:');
    db.prepare(`
      INSERT INTO weixin_gateway_credentials (id, account_id, token, base_url, updated_at)
      VALUES (1, 'bot-123', 'secret-token', 'https://ilinkai.weixin.qq.com', '2026-01-01T00:00:00.000Z')
    `).run();
    const service = new WeixinGatewayService(db, new GatewaySettingsStore(db), {} as never);

    expect(service.status().paired).toBe(true);
    await service.unpair();

    expect(service.status().paired).toBe(false);
    expect(service.getPairing()).toEqual({ status: 'idle' });
    db.close();
  });
});

describe('extractLastAssistantText', () => {
  it('extracts text content from the latest assistant message', () => {
    expect(extractLastAssistantText([
      { role: 'assistant', content: [{ type: 'text', text: 'older response' }] },
      { role: 'user', content: 'Please inspect the image.' },
      { role: 'assistant', content: [{ type: 'text', text: 'latest response' }] },
    ])).toBe('latest response');
  });

  it('falls back to content fields in assistant message parts', () => {
    expect(extractLastAssistantText([
      { role: 'assistant', content: [{ type: 'text', content: 'fallback response' }] },
    ])).toBe('fallback response');
  });
});
