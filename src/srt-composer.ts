import { None, type Option, Some } from "rusting-js/enums";

function makeLegalContent(content: string): string {
  if (
    content.length > 0 &&
    content[0] !== "\n" &&
    content.indexOf("\n\n") === -1
  ) {
    return content;
  }

  const legalContent = content.trim().replaceAll("\n\n", "\n");
  // eslint-disable-next-line no-console
  console.info(`Legalized content ${content} to ${legalContent}`);
  return legalContent;
}

const MICROSECONDS_TO_MILLISECOND = 1000;
const MICROSECONDS_TO_SECOND = MICROSECONDS_TO_MILLISECOND * 1000;
const MICROSECONDS_TO_MINUTE = MICROSECONDS_TO_SECOND * 60;
const MICROSECONDS_TO_HOUR = MICROSECONDS_TO_MINUTE * 60;
function timeString(microseconds: number): string {
  const hrs = Math.floor(microseconds / MICROSECONDS_TO_HOUR);
  const mins = Math.floor(microseconds / MICROSECONDS_TO_MINUTE) % 60;
  const secs = Math.floor(microseconds / MICROSECONDS_TO_SECOND) % 60;
  const msecs = Math.floor(microseconds / MICROSECONDS_TO_MILLISECOND) % 1000;

  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${msecs.toString().padStart(3, "0")}`;
}

export class Subtitle {
  constructor(
    public index: number,
    public start: number,
    public end: number,
    public content: string,
  ) {}

  eq(other: unknown): boolean {
    if (!(other instanceof Subtitle)) {
      return false;
    }

    for (const key in this) {
      if (this[key as keyof Subtitle] !== other[key as keyof Subtitle]) {
        return false;
      }
    }

    return true;
  }

  lt(other: unknown): boolean {
    if (!(other instanceof Subtitle)) {
      return false;
    }

    return (
      [this.start, this.end, this.index] < [other.start, other.end, other.index]
    );
  }

  clone(): Subtitle {
    return new Subtitle(this.index, this.start, this.end, this.content);
  }

  toString(eol: string = "\n"): string {
    let outputContent = makeLegalContent(this.content);
    if (eol !== "\n") {
      outputContent = outputContent.replaceAll("\n", eol);
    }

    return `${this.index}${eol}${timeString(this.start)} --> ${timeString(this.end)}${eol}${outputContent}${eol}${eol}`;
  }
}

function shouldSkipSub(subtitle: Subtitle): Option<string> {
  if (subtitle.content.trim().length === 0) {
    return Some("No content");
  }
  if (subtitle.start < 0) {
    return Some("Start time < 0 seconds");
  }
  if (subtitle.start >= subtitle.end) {
    return Some("Subtitle start time >= end time");
  }

  return None();
}

interface SortAndReindexProps {
  subtitles: Iterable<Subtitle>;
  startIndex?: number;
  inPlace?: boolean;
  skip?: boolean;
}

export function* sortAndReindex({
  subtitles,
  startIndex = 1,
  inPlace = false,
  skip = true,
}: SortAndReindexProps): Generator<Subtitle, void> {
  let skippedSubs = 0;

  const orderedSubs = Array.from(subtitles).sort((a, b) =>
    a.lt(b) ? -1 : a.eq(b) ? 0 : 1,
  );
  for (let i = 0, subNum = startIndex; i < orderedSubs.length; ++i, ++subNum) {
    let subtitle = orderedSubs[i]!;
    if (!inPlace) {
      subtitle = subtitle.clone();
    }

    checkSkip: if (skip) {
      const opt = shouldSkipSub(subtitle);
      if (opt.isNone()) {
        break checkSkip;
      }

      // eslint-disable-next-line no-console
      console.info(
        `Skipped subtitle at index ${subtitle.index}: ${opt.unwrap()}`,
      );

      ++skippedSubs;
      continue;
    }

    subtitle.index = subNum - skippedSubs;

    yield subtitle;
  }
}

export interface ComposeProps {
  subtitles: Iterable<Subtitle>;
  reindex?: boolean;
  startIndex?: number;
  eol?: string;
  inPlace?: boolean;
}

export function compose({
  subtitles,
  reindex = true,
  startIndex = 1,
  eol,
  inPlace = false,
}: ComposeProps): string {
  if (reindex) {
    subtitles = sortAndReindex({
      subtitles,
      startIndex,
      inPlace,
    });
  }

  return Array.from(subtitles)
    .map((subtitle) => subtitle.toString(eol))
    .join();
}
