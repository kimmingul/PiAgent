import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { failure, isObject, success } from '@piagent/protocol';
import type { RpcId, RpcResponse } from '@piagent/protocol';

export function authProof(token: string, role: 'server' | 'client', pipe: string, client: string, server: string): string {
  return createHmac('sha256', Buffer.from(token, 'hex')).update(`piagent.${role}.v1\n${pipe}\n${client}\n${server}`).digest('hex');
}
export function equalProof(left: unknown, right: string): boolean {
  return typeof left === 'string' && /^[a-f0-9]{64}$/.test(left) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
/** One-use, connection-bound challenge. Credential possession, not executable attestation. */
export class Authentication {
  private client = '';
  private server = '';
  private expires = 0;
  private attempted = false;
  ready = false;
  constructor(private readonly token: string, private readonly pipe: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid authentication configuration');
  }
  handle(id: RpcId, method: string, params: unknown): RpcResponse {
    if (this.ready) return failure(id, -32020, 'Authentication already completed');
    if (this.attempted) return failure(id, -32020, 'Authentication failed');
    if (method === 'core.auth.challenge' && !this.server && isObject(params)
      && Object.keys(params).length === 1 && typeof params['clientNonce'] === 'string' && /^[a-f0-9]{64}$/.test(params['clientNonce'])) {
      this.client = params['clientNonce']; this.server = randomBytes(32).toString('hex'); this.expires = Date.now() + 30_000;
      return success(id, { scheme: 'hmac-sha256.v1', serverNonce: this.server,
        serverProof: authProof(this.token, 'server', this.pipe, this.client, this.server) });
    }
    if (method === 'adapter.auth') {
      this.attempted = true;
      if (this.server && Date.now() < this.expires && isObject(params) && Object.keys(params).length === 1
        && equalProof(params['proof'], authProof(this.token, 'client', this.pipe, this.client, this.server))) {
        this.ready = true; this.server = ''; this.client = ''; return success(id, { authenticated: true });
      }
      return failure(id, -32020, 'Authentication failed');
    }
    return failure(id, -32020, 'Authentication required');
  }
}
