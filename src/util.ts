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
}

export async function runTTS({
  text,
  voice,
  ...args
}: RunTTSArgs): Promise<Result<RunTTSReturn, Error>> {
  const communicate = new Communicate(text, voice, args);
  const submaker = new SubMaker();

  const chunks: Uint8Array[] = [];

  for await (const chunkResult of communicate.stream()) {
    if (chunkResult.isErr()) {
      return Err(chunkResult.unwrapErr());
    }

    const chunk = chunkResult.unwrap();

    chunk.match({
      Audio({ data }) {
        chunks.push(data);
      },
      Sub(data) {
        submaker.feed(data);
      },
    });
  }

  const data = new Uint8Array(
    chunks.reduce(
      (accumulator, currentValue) => accumulator + currentValue.length,
      0,
    ),
  );

  for (let i = 0, accumulator = 0; i < chunks.length; ++i) {
    const chunk = chunks[i]!;
    data.set(chunks[i]!, accumulator);
    accumulator += chunk.length;
  }

  return Ok(new RunTTSReturn(data, submaker.toString()));
}
