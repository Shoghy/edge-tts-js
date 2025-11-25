import { None, type Option } from "rusting-js/enums";
import type { Subtitle } from "./srt-composer";

export class SubMaker {
  cues: Subtitle[] = [];
  type: Option<string> = None();
  constructor() {}
}
