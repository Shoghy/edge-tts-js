import fs from "fs";
import { Err, Ok, type Result } from "rusting-js/enums";
import { Communicate } from "./communicate.ts";
import type { Hertz, Percentage } from "./types.ts";
import { SubMaker } from "./submaker.ts";

export interface RunTTSArgs {
  text: string;
  voice?: string;
  rate?: Percentage;
  volume?: Percentage;
  pitch?: Hertz;
}

export class RunTTSReturn {
  constructor(
    public data: Uint8Array,
    public subtitles: string,
  ) {}

  writeMp3(path: string): Promise<Result<void, ErrnoException>> {
    return new Promise((resolve) =>
      fs.writeFile(path, this.data, (e) => resolve(e === null ? Ok() : Err(e))),
    );
  }

  writeSubtitles(path: string): Promise<Result<void, ErrnoException>> {
    return new Promise((resolve) =>
      fs.writeFile(path, this.subtitles, (e) =>
        resolve(e === null ? Ok() : Err(e)),
      ),
    );
  }
}

const DATA_GROW = 14400;

export async function runTTS({
  text,
  voice,
  ...args
}: RunTTSArgs): Promise<Result<RunTTSReturn, Error>> {
  const communicate = new Communicate(text, voice, args);
  const submaker = new SubMaker();

  let data = new Uint8Array(DATA_GROW);
  let length = 0;

  function addData(bytes: Uint8Array): void {
    length += bytes.length;
    if (length >= data.length) {
      const grow = Math.max(length, data.length + DATA_GROW);
      const temp = new Uint8Array(grow);
      temp.set(data);
      data = temp;
    }

    data.set(bytes, length);
  }

  for await (const chunkResult of communicate.stream()) {
    if (chunkResult.isErr()) {
      return Err(chunkResult.unwrapErr());
    }

    const chunk = chunkResult.unwrap();

    chunk.match({
      Audio({ data: mp3Bytes }) {
        addData(mp3Bytes);
      },
      Sub(sub) {
        submaker.feed(sub);
      },
    });
  }

  return Ok(new RunTTSReturn(data.slice(0, length), submaker.toString()));
}
