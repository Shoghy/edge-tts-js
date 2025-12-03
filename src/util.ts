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

export async function runTTS({
  text,
  voice,
  ...args
}: RunTTSArgs): Promise<Result<RunTTSReturn, Error>> {
  const communicate = new Communicate(text, voice, args);
  const submaker = new SubMaker();

  let data = new Uint8Array();

  for await (const chunkResult of communicate.stream()) {
    if (chunkResult.isErr()) {
      return Err(chunkResult.unwrapErr());
    }

    const chunk = chunkResult.unwrap();

    chunk.match({
      Audio({ data: mp3Bytes }) {
        data = Buffer.concat([data, mp3Bytes]);
      },
      Sub(sub) {
        submaker.feed(sub);
      },
    });
  }

  return Ok(new RunTTSReturn(data, submaker.toString()));
}
