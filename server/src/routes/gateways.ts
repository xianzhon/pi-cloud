import type { FastifyInstance, FastifyReply } from 'fastify';
import type { GatewaySettingsStore } from '../services/gateway-settings-store.js';
import type { WeixinGatewayService } from '../services/weixin-gateway.js';

interface GatewayRouteOptions {
  settings: GatewaySettingsStore;
  weixin?: WeixinGatewayService;
}

export async function gatewayRoutes(app: FastifyInstance, options: GatewayRouteOptions) {
  app.get('/settings', async () => ({ settings: options.settings.get() }));
  app.get('/weixin/status', async () => ({ status: options.weixin?.status() || { enabled: false, running: false } }));
  app.get('/weixin/pairing', async () => ({ pairing: options.weixin?.getPairing() || { status: 'idle' } }));

  app.post('/weixin/pairing', async (_req, reply) => {
    try {
      if (!options.weixin) throw new Error('WeChat gateway is unavailable');
      return { pairing: await options.weixin.beginPairing() };
    } catch (error) {
      return sendGatewayError(reply, error);
    }
  });

  app.post('/settings', async (req, reply) => {
    try {
      const body = (req.body || {}) as { cwds?: unknown; defaultProfile?: unknown; defaultSkillset?: unknown; defaultModelProvider?: unknown; defaultModelId?: unknown };
      return { settings: options.settings.save(body) };
    } catch (error) {
      return sendGatewayError(reply, error);
    }
  });
}

function sendGatewayError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'Gateway settings request failed';
  return reply.status(400).send({ error: message });
}
