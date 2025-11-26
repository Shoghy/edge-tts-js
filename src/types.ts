export type Hertz = `${"+" | "-"}${number}Hz`;
export type Percentage = `${"+" | "-"}${number}%`;
export type Boundary = "WordBoundary" | "SentenceBoundary";

interface TTSChunkProps {
  type: Boundary | "audio";
  data?: Uint8Array;
  duration?: number;
  offset?: number;
  text?: string;
}

export class TTSChunk implements TTSChunkProps {
  type: Boundary | "audio";
  data?: Uint8Array<ArrayBufferLike>;
  duration?: number;
  offset?: number;
  text?: string;

  constructor(props: TTSChunkProps) {
    this.type = props.type;
    this.data = props.data;
    this.duration = props.duration;
    this.offset = props.offset;
    this.text = props.text;
  }
}

export class Bytes extends Uint8Array {
  findMultiple(search: string | Uint8Array): number {
    const needle =
      typeof search === "string" ? new TextEncoder().encode(search) : search;

    if (needle.length === 0) return -1;
    if (needle.length > this.length) return -1;

    const lengthDiff = this.length - needle.length;
    for (let i = 0; i <= lengthDiff; ++i) {
      let matched = true;
      for (let j = 0; j < needle.length; ++j) {
        if (this[i + j] !== needle[j]) {
          matched = false;
          break;
        }
      }

      if (matched) return i;
    }

    return -1;
  }

  split(search: string | Uint8Array, limit?: number) {
    if (limit === 0) return [];
    if (limit !== undefined) {
      if (limit < 0) {
        limit = undefined;
      } else {
        limit = Math.round(limit);
      }
    }

    const needle =
      typeof search === "string" ? new TextEncoder().encode(search) : search;

    if (needle.length === 0) {
      const arr: Bytes[] = [];
      limit = limit !== undefined ? Math.min(this.length, limit) : this.length;
      for (let i = 0; i < limit; ++i) {
        arr.push(new Bytes(this.buffer, i, 1));
      }
      return arr;
    }

    if (needle.length > this.length) {
      return [this];
    }

    if (limit === undefined) {
      limit = Infinity;
    }

    const lengthDiff = this.length - needle.length;
    for (let i = 0; i < lengthDiff) { }
  }
}
