import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WecomGatewayService } from '../services/wecom-gateway.js';

interface WecomGatewayRouteOptions {
  service: WecomGatewayService;
}

export async function wecomGatewayRoutes(app: FastifyInstance, options: WecomGatewayRouteOptions) {
  app.addContentTypeParser(['application/xml', 'text/xml'], { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.get('/callback', async (req, reply) => {
    try {
      const challenge = options.service.handleVerification(req.query as Record<string, unknown>);
      return reply.type('text/plain; charset=utf-8').send(challenge);
    } catch (error) {
      return sendWecomError(reply, error);
    }
  });

  app.post('/callback', async (req, reply) => {
    try {
      const acknowledgement = options.service.handleCallback(
        req.query as Record<string, unknown>,
        typeof req.body === 'string' ? req.body : '',
      );
      return reply.type('text/plain; charset=utf-8').send(acknowledgement);
    } catch (error) {
      return sendWecomError(reply, error);
    }
  });

  app.get('/status', async () => ({ status: options.service.status() }));

  app.put('/configuration', async (req, reply) => {
    try {
      return options.service.saveConfiguration(req.body as any);
    } catch (error) {
      return sendWecomError(reply, error);
    }
  });

  app.delete('/configuration', async (_req, reply) => {
    try {
      options.service.disconnect();
      return { status: options.service.status() };
    } catch (error) {
      return sendWecomError(reply, error);
    }
  });

  app.post('/callback-secrets', async (_req, reply) => {
    try {
      return options.service.regenerateCallbackSecrets();
    } catch (error) {
      return sendWecomError(reply, error);
    }
  });

  app.post('/test', async (_req, reply) => {
    try {
      return { status: await options.service.testConnection() };
    } catch (error) {
      return sendWecomError(reply, error);
    }
  });
}

function sendWecomError(reply: FastifyReply, error: unknown) {
  const statusCode = Number((error as { statusCode?: unknown })?.statusCode) || 400;
  const message = error instanceof Error ? error.message : 'WeCom gateway request failed';
  return reply.status(statusCode).send({ error: message });
}
