import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FeishuGatewayService } from '../services/feishu-gateway.js';

interface FeishuGatewayRouteOptions {
  service: FeishuGatewayService;
}

export async function feishuGatewayRoutes(app: FastifyInstance, options: FeishuGatewayRouteOptions) {
  app.post('/events', async (req, reply) => {
    try {
      return await options.service.handleCallback(req.body);
    } catch (error) {
      return sendFeishuGatewayError(reply, error);
    }
  });
}

function sendFeishuGatewayError(reply: FastifyReply, error: unknown) {
  const maybeStatusCode = (error as { statusCode?: unknown })?.statusCode;
  const statusCode = typeof maybeStatusCode === 'number' ? maybeStatusCode : 500;
  const message = error instanceof Error ? error.message : 'Feishu gateway request failed';
  return reply.status(statusCode).send({ error: message });
}
