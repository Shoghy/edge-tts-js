import type { Option } from "rusting-js/enums";

export class Subtitle {
  constructor(
    public index: Option<number>,
    public start: number,
    public end: number,
    public content: string,
  ) {}

  eq(other: unknown) {
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
}
