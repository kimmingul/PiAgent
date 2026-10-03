export const MAX_FRAME_BYTES = 1_048_576;

export function encodeFrame(value: unknown): Buffer {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Frame must contain JSON');
  const body = Buffer.from(json, 'utf8');
  if (body.length === 0 || body.length > MAX_FRAME_BYTES) throw new Error('Invalid frame length');
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32LE(body.length);
  body.copy(frame, 4);
  return frame;
}

/** Fixed header and one bounded body allocation; handles split/coalesced reads. */
export class FrameDecoder {
  private readonly header = Buffer.alloc(4);
  private headerUsed = 0;
  private body: Buffer | undefined;
  private bodyUsed = 0;

  get partial(): boolean { return this.headerUsed !== 0 || this.body !== undefined; }

  push(chunk: Buffer, onFrame: (body: Buffer) => void): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.body === undefined) {
        const count = Math.min(4 - this.headerUsed, chunk.length - offset);
        chunk.copy(this.header, this.headerUsed, offset, offset + count);
        this.headerUsed += count;
        offset += count;
        if (this.headerUsed !== 4) continue;
        const length = this.header.readUInt32LE();
        if (length === 0 || length > MAX_FRAME_BYTES) throw new Error('Invalid frame length');
        this.body = Buffer.allocUnsafe(length);
        this.bodyUsed = 0;
      }
      const count = Math.min(this.body.length - this.bodyUsed, chunk.length - offset);
      chunk.copy(this.body, this.bodyUsed, offset, offset + count);
      this.bodyUsed += count;
      offset += count;
      if (this.bodyUsed === this.body.length) {
        const body = this.body;
        this.headerUsed = 0;
        this.body = undefined;
        this.bodyUsed = 0;
        onFrame(body);
      }
    }
  }

  end(): void {
    if (this.partial) throw new Error('Truncated frame');
  }
}
