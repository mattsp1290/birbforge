import {dirname, resolve} from 'node:path';
import {workspace} from './workspace';
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { type Server } from 'node:http';
import { GatewayConfig, gateway, privateGateway } from './gateway';
import { loadProxyConfig } from './access';

async function main() {
  const path = process.env.BIRBFORGE_CLIENT_CONFIG;
  if (!path) throw new Error('Client configuration is required');
  const config = GatewayConfig.parse(JSON.parse(readFileSync(path, 'utf8')));
  const port = Number(process.env.BIRBFORGE_PORT ?? 8787);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const proxy = process.env.BIRBFORGE_PROXY_CONFIG ? loadProxyConfig(process.env.BIRBFORGE_PROXY_CONFIG) : null;
  const services = workspace(config, {
    ownerPrincipal: config.projects?.owner_principal ?? (proxy?.authentication?.kind === 'private-single-owner' ? proxy.authentication.principal : 'owner'),
    directory: resolve(process.env.BIRBFORGE_WORKSPACE_DIR ?? resolve(dirname(path), 'workspace')),
    hub: process.env.BIRBFORGE_BEANS_HUB, python: process.env.BIRBFORGE_CHAT_PYTHON,
    attestation: process.env.BIRBFORGE_CHAT_ATTESTATION,
  });
  const listeners: {server: Server; address: string; port: number}[] = [
    {server: gateway(config, 'dist', services), address: '127.0.0.1', port},
  ];
  if (proxy) listeners.push({
    server: privateGateway(config, proxy, 'dist', services),
    address: '127.0.0.1', port: proxy.port,
  });
  const shutdown = () => listeners.forEach(({server}) => {server.close(() => {}); server.closeAllConnections();});
  let stopping = false;
  process.on('SIGTERM', () => {stopping = true; shutdown();});
  try {
    for (const listener of listeners) {
      if (stopping) return shutdown();
      await new Promise<void>((resolve, reject) => {
        const startupError = (error: Error) => reject(error);
        listener.server.once('error', startupError);
        listener.server.listen(listener.port, listener.address, () => {
          listener.server.off('error', startupError);
          listener.server.on('error', () => {
            shutdown();
            process.stderr.write('Forge listener failed.\n');
            process.exitCode = 1;
          });
          resolve();
        });
      });
    }
    if (stopping) return shutdown();
    const ready = process.env.BIRBFORGE_READY_FILE;
    if (ready) {
      const pending = `${ready}.${process.pid}.pending`;
      writeFileSync(pending, JSON.stringify({port, proxyOrigin: proxy?.origin ?? null}), {mode: 0o600, flag: 'wx'});
      try { linkSync(pending, ready); }
      finally { unlinkSync(pending); }
    }
    process.stdout.write('Forge loopback gateway ready.\n');
    if (proxy) process.stdout.write('Loopback proxy backend ready with exact HTTPS authority checks.\n');
  } catch (error) { shutdown(); throw error; }
}
void main().catch(() => {
  process.stderr.write('Forge startup failed. Check private configuration or listener availability.\n');
  process.exitCode = 1;
});
