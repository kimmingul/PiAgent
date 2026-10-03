import { MAX_FRAME_BYTES } from '@piagent/protocol';

/** Physical JSONL frame limit, independent of pipe length-prefixed framing. */
export class JsonlDecoder {
  private readonly line = Buffer.allocUnsafe(MAX_FRAME_BYTES);
  private used = 0;

  push(chunk: Buffer, onLine: (line: Buffer) => void): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const length = end - offset;
      if (this.used + length > MAX_FRAME_BYTES) throw new Error('OMP JSONL frame exceeds limit');
      chunk.copy(this.line, this.used, offset, end);
      this.used += length;
      offset = end;
      if (newline < 0) break;
      offset++;
      const lengthWithoutCR = this.used > 0 && this.line[this.used - 1] === 13 ? this.used - 1 : this.used;
      if (lengthWithoutCR > 0) onLine(Buffer.from(this.line.subarray(0, lengthWithoutCR)));
      this.used = 0;
    }
  }

  end(): void {
    if (this.used !== 0) throw new Error('Truncated OMP JSONL frame');
  }
}
