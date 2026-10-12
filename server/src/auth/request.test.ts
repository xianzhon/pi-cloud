import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { getRequestContext } from './request';

function request(headers: Record<string, string | string[]>): FastifyRequest {
  return { headers, ip: '10.0.0.1' } as unknown as FastifyRequest;
}

describe('getRequestContext', () => {
  it('ignores forwarded headers unless a trusted proxy is configured', () => {
    expect(getRequestContext(request({ 'x-forwarded-for': '1.2.3.4' }), false).ip).toBe('10.0.0.1');
  });

  it('uses the hop appended by the trusted proxy, not client-supplied entries', () => {
    expect(getRequestContext(request({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }), true).ip).toBe('1.2.3.4');
    expect(getRequestContext(request({ 'x-forwarded-for': ['6.6.6.6', '1.2.3.4'] }), true).ip).toBe('1.2.3.4');
  });

  it('falls back to the socket address without a forwarded header', () => {
    expect(getRequestContext(request({}), true).ip).toBe('10.0.0.1');
  });
});
