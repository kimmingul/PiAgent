export { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } from './framing.js';
export const PROTOCOL_VERSION = 1;
export const CORE_VERSION = '0.1.0';
export type RpcId = string | number;
export interface RpcResponse {
  jsonrpc: '2.0';
  id: RpcId | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function validId(value: unknown): value is RpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
}
export function success(id: RpcId, result: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, result };
}
export function failure(id: RpcId | null, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
