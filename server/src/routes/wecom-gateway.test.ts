import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { wecomGatewayRoutes } from './wecom-gateway.js';

describe('wecomGatewayRoutes', () => {
  it('serves callback verification and encrypted XML callbacks as plain text', async () => {
    const service = {
      handleVerification: vi.fn(() => 'verified-challenge'),
      handleCallback: vi.fn(() => 'success'),
      status: vi.fn(() => ({ configured: true })),
    } as any;
    const app = Fastify();
    await app.register(wecomGatewayRoutes, { service });

    const verification = await app.inject({
      method: 'GET',
      url: '/callback?msg_signature=sig&timestamp=1&nonce=2&echostr=cipher',
    });
    expect(verification.statusCode).toBe(200);
    expect(verification.body).toBe('verified-challenge');
    expect(verification.headers['content-type']).toContain('text/plain');

    const callback = await app.inject({
      method: 'POST',
      url: '/callback?msg_signature=sig&timestamp=1&nonce=2',
      headers: { 'content-type': 'application/xml' },
      payload: '<xml><Encrypt>cipher</Encrypt></xml>',
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toBe('success');
    expect(service.handleCallback).toHaveBeenCalledWith(
      { msg_signature: 'sig', timestamp: '1', nonce: '2' },
      '<xml><Encrypt>cipher</Encrypt></xml>',
    );
  });

  it('exposes redacted setup, test, and disconnect operations', async () => {
    const status = { configured: true, managedBy: 'database' };
    const service = {
      handleVerification: vi.fn(),
      handleCallback: vi.fn(),
      status: vi.fn(() => status),
      saveConfiguration: vi.fn(() => ({ status, callbackToken: 'token', encodingAesKey: 'aes-key' })),
      testConnection: vi.fn(async () => status),
      disconnect: vi.fn(() => undefined),
      regenerateCallbackSecrets: vi.fn(() => ({ status, callbackToken: 'new-token', encodingAesKey: 'new-key' })),
    } as any;
    const app = Fastify();
    await app.register(wecomGatewayRoutes, { service });

    expect((await app.inject({ method: 'GET', url: '/status' })).json()).toEqual({ status });
    expect((await app.inject({ method: 'PUT', url: '/configuration', payload: { corpId: 'corp', corpSecret: 'secret', agentId: '1', allowedUsers: ['u1'] } })).json())
      .toEqual({ status, callbackToken: 'token', encodingAesKey: 'aes-key' });
    expect((await app.inject({ method: 'POST', url: '/test' })).json()).toEqual({ status });
    expect((await app.inject({ method: 'POST', url: '/callback-secrets' })).json())
      .toEqual({ status, callbackToken: 'new-token', encodingAesKey: 'new-key' });
    expect((await app.inject({ method: 'DELETE', url: '/configuration' })).json()).toEqual({ status });
    expect(service.disconnect).toHaveBeenCalledOnce();
  });
});
