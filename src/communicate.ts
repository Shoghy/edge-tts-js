import { randomUUID } from "crypto";
import { WebSocket } from "ws";
import { ca } from "./certifi.ts";
import {
  DEFAULT_VOICE,
  SEC_MS_GEC_VERSION,
  WSS_HEADERS,
  WSS_URL,
} from "./constants.ts";
import type { Boundary, Hertz, Percentage } from "./types.ts";
import { generateSecMsGec } from "./drm.ts";

const SPECIAL_CHARS_ASCII = {
  "\n": 10,
  " ": 32,
  "&": 38,
  ";": 59,
} as const;

function connectId() {
  return randomUUID().replace("-", "");
}

function isWhiteSpace(byte: number) {
  return (
    byte === 0x09 || // \t
    byte === 0x0a || // \n
    byte === 0x0b || // \v
    byte === 0x0c || // \f
    byte === 0x0d || // \r
    byte === 0x20 // space
  );
}

function removeIncompatibleCharacters(value: string | Uint8Array): string {
  if (value instanceof Uint8Array) {
    const decoder = new TextDecoder();
    value = decoder.decode(value);
  }

  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (
      (code >= 0 && code <= 8) ||
      (code >= 11 && code <= 12) ||
      (code >= 14 && code <= 31)
    ) {
      result += " ";
    } else {
      result += char;
    }
  }

  return result;
}

function findLastNewlineOrSpaceWithinLimit(
  text: Uint8Array,
  limit: number,
): number {
  const slice = text.slice(0, limit);
  let splitAt = slice.findLastIndex((b) => b === SPECIAL_CHARS_ASCII["\n"]);
  if (splitAt < 0) {
    splitAt = slice.findLastIndex((b) => b === SPECIAL_CHARS_ASCII[" "]);
  }
  return splitAt;
}

function findSafeUtf8SplitPoint(textSegmented: Uint8Array): number {
  let splitAt = textSegmented.length;

  const decoder = new TextDecoder("utf-8", { fatal: true });

  while (splitAt > 0) {
    try {
      const prefix = textSegmented.slice(0, splitAt);
      decoder.decode(prefix);
      return splitAt;
    } catch (_) {
      splitAt--;
    }
  }

  return 0;
}

function adjustSplitPointForXmlEntity(
  text: Uint8Array,
  splitAt: number,
): number {
  let slice = text.slice(0, splitAt);
  let ampersandIndex: number;
  while (
    splitAt > 0 &&
    (ampersandIndex = slice.findLastIndex(
      (b) => b === SPECIAL_CHARS_ASCII["&"],
    )) > -1
  ) {
    if (
      text
        .slice(ampersandIndex, splitAt)
        .findIndex((b) => b === SPECIAL_CHARS_ASCII[";"]) > -1
    ) {
      break;
    }

    splitAt = ampersandIndex;
    slice = text.slice(0, splitAt);
  }

  return splitAt;
}

function* splitTextByByteLength(text: string | Uint8Array, byteLength: number) {
  if (typeof text === "string") {
    const encoder = new TextEncoder();
    text = encoder.encode(text);
  }

  if (byteLength <= 0) {
    throw new Error("byteLength must be greater than 0");
  }

  byteLength = Math.round(byteLength);

  while (text.length > byteLength) {
    let splitAt = findLastNewlineOrSpaceWithinLimit(text, byteLength);
    if (splitAt < 0) {
      splitAt = findSafeUtf8SplitPoint(text);
    }

    splitAt = adjustSplitPointForXmlEntity(text, splitAt);
    if (splitAt < 0) {
      throw new Error(
        "Maximum byte length is too small or invalid text structure near '&' or invalid UTF-8",
      );
    }

    const chunk = text.slice(0, splitAt).filter((b) => !isWhiteSpace(b));
    if (chunk.length > 0) {
      yield chunk;
    }

    text = text.slice(splitAt > 0 ? splitAt : 1);
  }

  const remainingChunk = text.filter((b) => !isWhiteSpace(b));
  if (remainingChunk.length > 0) {
    yield remainingChunk;
  }
}

function ssmlHeadersPlusData(
  requestId: string,
  timestamp: string,
  ssml: string,
): string {
  return `X-RequestId:${requestId}\r
Content-Type:application/ssml+xml\r
X-Timestamp:${timestamp}Z\r
Path:ssml\r\n\r
${ssml}`;
}

function mkssml(tc: TTSConfig, escapedText: string | Uint8Array) {
  if (escapedText instanceof Uint8Array) {
    const decoder = new TextDecoder();
    escapedText = decoder.decode(escapedText);
  }

  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
<voice name='${tc.voice}'>\
<prosody pitch='${tc.pitch}' rate='${tc.rate}' volume='${tc.volume}'>\
${escapedText}\
</prosody>\
</voice>\
</speak>`;
}

class CommunicateState {
  constructor(
    public partialText: Uint8Array,
    public offsetCompensation: number,
    public lastDurationOffset: number,
    public streamWasCalled: boolean,
  ) {}
}

class TTSConfig {
  constructor(
    public voice: string,
    public rate: string,
    public volume: string,
    public pitch: string,
    public boundary: Boundary,
  ) {}
}

interface CommunicateOptions {
  rate?: Percentage;
  volume?: Percentage;
  pitch?: Hertz;
  boundary?: Boundary;
  connectTimeout?: number;
  receiveTimeout?: number;
}

export class Communicate {
  texts: Generator<Uint8Array<ArrayBuffer>, void, unknown>;
  state = new CommunicateState(new Uint8Array(), 0, 0, false);
  ttsConfig: TTSConfig;

  constructor(
    text: string,
    voice: string = DEFAULT_VOICE,
    {
      rate = "+0%",
      volume = "+0%",
      pitch = "+0Hz",
      boundary = "SentenceBoundary",
    }: CommunicateOptions = {},
  ) {
    this.ttsConfig = new TTSConfig(voice, rate, volume, pitch, boundary);

    this.texts = splitTextByByteLength(
      removeIncompatibleCharacters(text)
        .replace("&", "&amp;")
        .replace(">", "&gt;")
        .replace("<", "&lt;"),
      4096,
    );
  }

  async stream() {
    if (this.state.streamWasCalled) {
      throw new Error("stream can only be called once");
    }

    this.state.streamWasCalled = true;
    for (this.state.partialText of this.texts) {
      this.#stream();
    }
  }

  async #stream() {
    const _audioWasReceived = false;

    const ws = new WebSocket(
      `${WSS_URL}&ConnectionId=${connectId()}&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`,
      {
        headers: WSS_HEADERS,
        ca,
      },
    );

    const sendCommandRequest = () => {
      const wordBoundary = this.ttsConfig.boundary === "WordBoundary";
      const wd = wordBoundary.toString();
      const sq = (!wordBoundary).toString();

      return new Promise<void>((rsv, rjc) => {
        ws.send(
          `X-Timestamp:${new Date().toString()}\r
Content-Type:application/json; charset=utf-8\r
Path:speech.config\r\n\r
{"context":{"synthesis":{"audio":{"metadataoptions":{\
"sentenceBoundaryEnabled":"${sq}","wordBoundaryEnabled":"${wd}"\
},\
"outputFormat":"audio-24khz-48kbitrate-mono-mp3"\
}}}}\r\n`,
          (error) => {
            if (error === undefined) {
              rsv();
            } else {
              rjc(error);
            }
          },
        );
      });
    };

    const sendSsmlRequest = () =>
      new Promise<void>((rsv, rjc) =>
        ws.send(
          ssmlHeadersPlusData(
            connectId(),
            new Date().toString(),
            mkssml(this.ttsConfig, this.state.partialText),
          ),
          (error) => {
            if (error === undefined) {
              rsv();
            } else {
              rjc(error);
            }
          },
        ),
      );

    ws.onopen = async () => {
      await sendCommandRequest();
      await sendSsmlRequest();
    };

    ws.onmessage = () => {};
  }
}
