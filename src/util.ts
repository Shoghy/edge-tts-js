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

export interface RunTTSReturn {
  chunks: Uint8Array[];
  subtitles: string;
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

  return Ok({ chunks, subtitles: submaker.toString() });
}
