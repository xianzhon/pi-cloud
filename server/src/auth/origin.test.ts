import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './origin';

describe('isAllowedOrigin', () => {
  it('allows requests without an Origin header', () => {
    expect(isAllowedOrigin(undefined, 'localhost:3000')).toBe(true);
  });

  it('allows an exact host and port match', () => {
    expect(isAllowedOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173', '127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:3000', '[::1]:3000')).toBe(true);
    expect(isAllowedOrigin('https://pi.example.com', 'pi.example.com')).toBe(true);
  });

  it('rejects other local ports because cookies are shared across ports', () => {
    expect(isAllowedOrigin('http://localhost:8080', 'localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:5173', 'localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://localhost:8080', 'localhost')).toBe(false);
  });

  it('rejects different hosts and malformed values', () => {
    expect(isAllowedOrigin('https://evil.example', 'localhost:3000')).toBe(false);
    expect(isAllowedOrigin('not a url', 'localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://localhost:3000', undefined)).toBe(false);
  });

  it('treats explicit default ports like implicit ones', () => {
    expect(isAllowedOrigin('http://pi.example.com', 'pi.example.com:80')).toBe(true);
    expect(isAllowedOrigin('https://pi.example.com', 'pi.example.com:443')).toBe(true);
  });

  it('tolerates proxies that strip the port only when a trusted proxy is configured', () => {
    expect(isAllowedOrigin('https://pi.example.com:8443', 'pi.example.com')).toBe(false);
    expect(isAllowedOrigin('https://pi.example.com:8443', 'pi.example.com', true)).toBe(true);
    expect(isAllowedOrigin('https://other.example.com:8443', 'pi.example.com', true)).toBe(false);
  });
});
