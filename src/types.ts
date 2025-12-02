import { Arm, Class, Enum } from "rusting-js/enums";

export type Hertz = `${"+" | "-"}${number}Hz`;
export type Percentage = `${"+" | "-"}${number}%`;
export type Boundary = "WordBoundary" | "SentenceBoundary";

export interface TTSChunkAudio {
  data: Uint8Array;
}

export interface TTSChunkSub {
  type: Boundary;
  duration: number;
  offset: number;
  text: string;
}

export class TTSChunk extends Enum({
  __classType__: Class<TTSChunk>(),
  Audio: Arm<TTSChunkAudio>(),
  Sub: Arm<TTSChunkSub>(),
}) {}

function isWhiteSpace(byte: number): boolean {
  return (
    byte === 0x09 || // \t
    byte === 0x0a || // \n
    byte === 0x0b || // \v
    byte === 0x0c || // \f
    byte === 0x0d || // \r
    byte === 0x20 // space
  );
}

export class Bytes extends Uint8Array {
  findMultiple(search: string | Uint8Array): number {
    const needle =
      typeof search === "string" ? new TextEncoder().encode(search) : search;

    if (needle.length === 0) return -1;
    if (needle.length > this.length) return -1;

    let i = 0,
      j = 1,
      k = 0;
    let p = 1;

    while (j + k < needle.length) {
      const a = needle[i + k]!;
      const b = needle[j + k]!;
      if (a === b) {
        if (++k === needle.length) break;
      } else if (a < b) {
        j = j + k + 1;
        k = 0;
        p = j - i;
      } else {
        i = j;
        j = i + 1;
        k = 0;
        p = 1;
      }
    }

    const ms = i;
    const period = p;

    let pos = 0;
    while (pos + needle.length <= this.length) {
      let k2 = ms;
      while (k2 < needle.length && needle[k2] === this[pos + k2]) k2++;
      if (k2 < needle.length) {
        pos += k2 - ms + 1;
        continue;
      }

      k2 = ms - 1;
      while (k2 >= 0 && needle[k2] === this[pos + k2]) k2--;
      if (k2 >= 0) {
        pos += period;
        continue;
      }

      return pos;
    }

    return -1;
  }

  static fromString(value: string): Bytes {
    const v = new TextEncoder().encode(value);
    return new Bytes(v.buffer);
  }

  split(search: string | Uint8Array, limit?: number): Bytes[] {
    if (limit !== undefined) {
      if (limit < 0) {
        limit = undefined;
      } else {
        limit = Math.floor(limit);
      }
    }

    if (limit === 0) return [];

    const needle =
      typeof search === "string" ? new TextEncoder().encode(search) : search;

    if (needle.length === 0) {
      const out: Bytes[] = [];
      const count =
        limit !== undefined ? Math.min(this.length, limit) : this.length;
      for (let i = 0; i < count; i++) {
        out.push(this.slice(i, i + 1));
      }
      return out;
    }

    if (needle.length > this.length) return [this];

    if (limit === undefined) limit = Infinity;

    const out: Bytes[] = [];

    let i = 0,
      j = 1,
      k = 0;
    let p = 1;
    while (j + k < needle.length) {
      const a = needle[i + k]!;
      const b = needle[j + k]!;
      if (a === b) {
        if (k + 1 === needle.length) break;
        k++;
      } else if (a < b) {
        j += k + 1;
        k = 0;
        p = j - i;
      } else {
        i = j;
        j = i + 1;
        k = 0;
        p = 1;
      }
    }
    const ms = i;
    const period = p;

    let pos = 0;
    let start = 0;

    while (pos + needle.length <= this.length) {
      let k2 = ms;
      while (k2 < needle.length && needle[k2] === this[pos + k2]) k2++;
      if (k2 < needle.length) {
        pos += k2 - ms + 1;
        continue;
      }

      k2 = ms - 1;
      while (k2 >= 0 && needle[k2] === this[pos + k2]) k2--;
      if (k2 >= 0) {
        pos += period;
        continue;
      }

      out.push(this.slice(start, pos));
      if (out.length >= limit) return out;

      pos += needle.length;
      start = pos;
    }

    out.push(this.slice(start));

    return out;
  }

  trimStart(): Bytes {
    let i = 0;
    for (; i < this.length; ++i) {
      if (!isWhiteSpace(this[i]!)) {
        break;
      }
    }

    return this.slice(i);
  }

  trimEnd(): Bytes {
    let i = this.length - 1;
    for (; i >= 0; --i) {
      if (!isWhiteSpace(this[i]!)) {
        break;
      }
    }

    return this.slice(0, i + 1);
  }

  trim(): Bytes {
    return this.trimStart().trimEnd();
  }

  override slice(start?: number, end?: number): Bytes {
    return new Bytes(super.slice(start, end).buffer);
  }

  override toString(): string {
    return new TextDecoder().decode(this);
  }

  equals(bytes: Uint8Array): boolean {
    if (this.length !== bytes.length) return false;
    if (this.length === 0) return true;

    for (let i = 0; i < this.length; ++i) {
      if (this[i] !== bytes[i]) {
        return false;
      }
    }
    return true;
  }
}
