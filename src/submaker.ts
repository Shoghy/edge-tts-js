import { Err, None, Ok, type Result, type Option } from "rusting-js/enums";
import { compose, Subtitle } from "./srt-composer.ts";
import type { Boundary, TTSChunkSub } from "./types";

export class SubMaker {
  cues: Subtitle[] = [];
  type: Option<Boundary> = None();

  feed(msg: TTSChunkSub): Result<void, Error> {
    let type: Boundary;

    if (this.type.isNone()) {
      this.type.insert(msg.type);
    } else if ((type = this.type.unwrap()) !== msg.type) {
      return Err(
        new Error(`Expected message type '${type}', but got '${msg.type}'.`),
      );
    }

    this.cues.push(
      new Subtitle(
        this.cues.length + 1,
        msg.offset / 10,
        (msg.offset + msg.duration) / 10,
        msg.text,
      ),
    );

    return Ok();
  }

  toString(): string {
    return compose({ subtitles: this.cues });
  }
}
