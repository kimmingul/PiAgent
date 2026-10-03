import { TextDecoder } from 'node:util';
import { CORE_VERSION, PROTOCOL_VERSION, failure, isObject, success, validId } from '@piagent/protocol';
import type { RpcId, RpcResponse } from '@piagent/protocol';
import { ChatError, CHAT_CAPABILITY } from './chat.js';
import type { ChatSession } from './chat.js';
import { CONTEXT_CAPABILITY } from './context.js';
import { WORKSPACE_CAPABILITY } from './workspace.js';
import { Authentication } from './authentication.js';
export { Authentication, authProof, equalProof } from './authentication.js';
export { WorkspaceReader } from './workspace.js';
export { ChatSession } from './chat.js';

interface AdapterInfo {
  kind: string;
  version: string;
  ideVersion: string;
  instanceId: string;
  capabilities: string[];
}
function text(value: unknown, maxBytes = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= maxBytes;
}
function capabilities(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64
    && value.every((item: unknown) => text(item, 128) && /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(item))
    && new Set(value).size === value.length;
}

/** Connection-local, IDE-neutral state. Adapter kind is metadata, never dispatch logic. */
export class Session {
  private adapter: AdapterInfo | undefined;
  private negotiated: string[] = [];
  constructor(private readonly chat?: ChatSession, private readonly authentication?: Authentication) {}

  async handleAsync(body: Uint8Array): Promise<RpcResponse | undefined> {
    const fallback = this.handle(body);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown; }
    catch { return fallback; }
    if (!isObject(value) || typeof value['method'] !== 'string' || !['chat.open', 'chat.prompt', 'chat.cancel', 'chat.close'].includes(value['method'])
      || !('id' in value) || !validId(value['id']) || fallback?.error?.code !== -32601) return fallback;
    const id = value['id'];
    if (!this.ready) return failure(id, -32002, 'Handshake required');
    if (!this.chat || !this.negotiated.includes(CHAT_CAPABILITY)) return failure(id, -32005, 'Capability not negotiated');
    if (value['method'] === 'chat.prompt' && isObject(value['params']) && 'context' in value['params']
      && !this.negotiated.includes(CONTEXT_CAPABILITY)) return failure(id, -32005, 'Selection context capability not negotiated');
    if (!isObject(value['params'] ?? {})) return failure(id, -32602, 'Invalid params');
    try { return success(id, await this.chat.handle(value['method'], (value['params'] ?? {}) as Record<string, unknown>, this.negotiated.includes(WORKSPACE_CAPABILITY))); }
    catch (error) { return failure(id, error instanceof ChatError ? error.code : -32010,
      error instanceof Error ? error.message : 'Chat failed'); }
  }

  get ready(): boolean { return this.adapter !== undefined; }

  handle(body: Uint8Array): RpcResponse | undefined {
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)) as unknown;
    } catch {
      return failure(null, -32700, 'Parse error');
    }
    const id = isObject(value) && validId(value['id']) ? value['id'] : null;
    if (!isObject(value) || value['jsonrpc'] !== '2.0' || typeof value['method'] !== 'string'
      || ('id' in value && !validId(value['id']))
      || ('params' in value && !isObject(value['params']) && !Array.isArray(value['params']))
      || 'result' in value || 'error' in value) {
      return failure(id, -32600, 'Invalid Request');
    }
    if (!('id' in value)) return undefined; // Notifications never initialize state.
    if (id === null) return failure(null, -32600, 'Invalid Request');
    const params = value['params'] ?? {};
    if (this.authentication && (!this.authentication.ready || ['core.auth.challenge', 'adapter.auth'].includes(value['method'])))
      return this.authentication.handle(id, value['method'], params);
    switch (value['method']) {
      case 'adapter.hello': return this.hello(id, params);
      case 'core.ping': {
        if (!this.ready) return failure(id, -32002, 'Handshake required');
        if (!this.negotiated.includes('core.ping')) return failure(id, -32005, 'Capability not negotiated');
        if (!isObject(params) || Object.keys(params).some(key => key !== 'nonce')
          || ('nonce' in params && (typeof params['nonce'] !== 'string' || Buffer.byteLength(params['nonce']) > 1024))) {
          return failure(id, -32602, 'Invalid params');
        }
        return success(id, { pong: true, nonce: params['nonce'] ?? null });
      }
      default: return failure(id, -32601, 'Method not found');
    }
  }

  private hello(id: RpcId, params: unknown): RpcResponse {
    if (this.ready) return failure(id, -32003, 'Already initialized');
    if (!isObject(params) || !Array.isArray(params['protocolVersions'])
      || params['protocolVersions'].length < 1 || params['protocolVersions'].length > 16
      || !params['protocolVersions'].every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff)
      || !isObject(params['adapter'])) return failure(id, -32602, 'Invalid params');
    const adapter = params['adapter'];
    if (!['kind', 'version', 'ideVersion', 'instanceId'].every(key => text(adapter[key]))
      || !/^[a-z][a-z0-9-]*$/.test(String(adapter['kind']))) return failure(id, -32602, 'Invalid params');
    const offered = params['capabilities'] === undefined ? ['core.ping'] : params['capabilities'];
    const required = params['requiredCapabilities'] === undefined ? [] : params['requiredCapabilities'];
    const adapterOffers = adapter['capabilities'] === undefined ? [] : adapter['capabilities'];
    if (!capabilities(offered) || !capabilities(required) || !capabilities(adapterOffers)
      || required.some(capability => !offered.includes(capability))) return failure(id, -32602, 'Invalid params');
    if (!params['protocolVersions'].includes(PROTOCOL_VERSION)) {
      return failure(id, -32001, 'Unsupported protocol version', { supportedProtocolVersions: [PROTOCOL_VERSION] });
    }
    const negotiated: string[] = offered.filter(capability => capability === 'core.ping'
      || (this.chat && (capability === CHAT_CAPABILITY || (capability === CONTEXT_CAPABILITY && offered.includes(CHAT_CAPABILITY))
        || (capability === WORKSPACE_CAPABILITY && this.chat.supportsWorkspace && offered.includes(CHAT_CAPABILITY)))));
    const missing = required.filter(capability => !negotiated.includes(capability));
    if (missing.length > 0) return failure(id, -32004, 'Required capability unavailable', { missingCapabilities: missing });
    this.negotiated = negotiated;
    this.adapter = {
      kind: String(adapter['kind']), version: String(adapter['version']),
      ideVersion: String(adapter['ideVersion']), instanceId: String(adapter['instanceId']), capabilities: adapterOffers,
    };
    return success(id, {
      protocolVersion: PROTOCOL_VERSION,
      core: { name: 'PiAgent', version: CORE_VERSION },
      capabilities: negotiated,
      // Only recorded metadata; no adapter calls are enabled in this slice.
      adapterCapabilities: adapterOffers,
    });
  }
}
