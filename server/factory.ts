import {z} from 'zod/v4';
import {QueueStatus, type FactoryStatus} from '../app/src/factory';
import type {GatewayConfig} from './gateway';
import {verificationQueueStatus} from './verification';

type FactoryConfig = Pick<z.infer<typeof GatewayConfig>, 'url' | 'tokens' | 'verification' | 'projects'>;
export type {FactoryStatus};

export async function inspectFactory(config: FactoryConfig, principal: string): Promise<FactoryStatus> {
  const [runtime, queue] = await Promise.all([
    fetch(config.url + '/health', {redirect: 'error', signal: AbortSignal.timeout(4000)})
      .then(async response => response.ok && z.object({status: z.literal('ready')}).safeParse(await response.json()).success)
      .catch(() => false),
    config.verification ? verificationQueueStatus(config.verification, principal).then(data => QueueStatus.parse(data)).catch(() => null) : null,
  ]);
  if (queue?.conversationId) {
    const response = await fetch(config.url + '/conversations/' + queue.conversationId, {
      headers: {Authorization: 'Bearer ' + config.tokens[principal]}, redirect: 'error', signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    await response?.body?.cancel();
    if (!response?.ok) queue.conversationId = null;
  }
  return {
    checkedAt: new Date().toISOString(), gateway: 'online', runtime: runtime ? 'ready' : 'unavailable',
    verification: queue ? 'installed' : config.verification ? 'unavailable' : 'unconfigured', queue,
  };
}
