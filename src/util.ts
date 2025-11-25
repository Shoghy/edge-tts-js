import { Communicate } from "./communicate.ts";
import type { Hertz, Percentage } from "./types.ts";

export interface RunTTSArgs {
  text: string;
  voice?: string;
  rate?: Percentage;
  volume?: Percentage;
  pitch?: Hertz;
}

export async function runTTS({ text, voice, ...args }: RunTTSArgs) {
  const _communicate = new Communicate(text, voice, args);
}
