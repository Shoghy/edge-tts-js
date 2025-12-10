import { randomUUID } from "crypto";
import { promiseWithResolvers } from "rusting-js";
import {
  ControlFlow,
  Err,
  None,
  Ok,
  type Option,
  type Result,
} from "rusting-js/enums";
import {
  DEFAULT_VOICE,
  SEC_MS_GEC_VERSION,
  WSS_HEADERS,
  WSS_URL,
} from "./constants.ts";
import {
  Bytes,
  TTSChunk,
  type Boundary,
  type Hertz,
  type Percentage,
  type TTSChunkSub,
} from "./types.ts";
import { generateSecMsGec } from "./drm.ts";

const SPECIAL_CHARS_ASCII = {
  "\n": 10,
  "\r": 13,
  " ": 32,
  "&": 38,
  ";": 59,
} as const;

function connectId(): string {
  return randomUUID().replaceAll("-", "");
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

function* splitTextByByteLength(
  text: string,
  byteLength: number,
): Generator<Bytes, void> {
  if (byteLength <= 0) {
    throw new Error("byteLength must be greater than 0");
  }

  let value = Bytes.fromString(text);

  byteLength = Math.round(byteLength);

  while (value.length > byteLength) {
    let splitAt = findLastNewlineOrSpaceWithinLimit(value, byteLength);
    if (splitAt < 0) {
      splitAt = findSafeUtf8SplitPoint(value);
    }

    splitAt = adjustSplitPointForXmlEntity(value, splitAt);
    if (splitAt < 0) {
      throw new Error(
        "Maximum byte length is too small or invalid text structure near '&' or invalid UTF-8",
      );
    }

    const chunk = value.slice(0, splitAt).trim();
    if (chunk.length > 0) {
      yield chunk;
    }

    value = value.slice(splitAt > 0 ? splitAt : 1);
  }

  const remainingChunk = value.trim();
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

function mkssml(tc: TTSConfig, escapedText: string | Uint8Array): string {
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

function dateToString(): string {
  return (
    new Date().toUTCString().replace(",", "") +
    "+0000 (Coordinated Universal Time)"
  );
}

interface Header<Path extends string> {
  "X-RequestId": string;
  "Content-Type": string;
  Path: Path;
}

interface TurnStartHeaderData {
  headers: Header<"turn.start">;
  data: {
    context: {
      serviceTag: string;
    };
  };
}

interface ResponseHeaderData {
  headers: Header<"response">;
  data: {
    context: {
      serviceTag: string;
      audio: {
        type: string;
        streamId: string;
      };
    };
  };
}

interface AudioMetadataHeaderData {
  headers: Header<"audio.metadata">;
  data: {
    Metadata: {
      Type: Boundary;
      Data: {
        Offset: number;
        Duration: number;
        text: {
          Text: string;
          Length: number;
          BoundaryType: Boundary;
        };
      };
    }[];
  };
}

interface TurnEndHeaderData {
  headers: Header<"turn.end">;
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  data: {};
}

type StringHeaderData =
  | TurnStartHeaderData
  | ResponseHeaderData
  | AudioMetadataHeaderData
  | TurnEndHeaderData;

function getHeadersAndDataString(
  data: string,
  headerLength: number,
): StringHeaderData {
  const lines = data.slice(0, headerLength).split("\r\n");
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const lineSplit = line.split(":");
    const key = lineSplit.shift();
    const value = lineSplit.join(":");

    headers[key!] = value!;
  }

  return {
    headers,
    data: JSON.parse(data.slice(headerLength + 2)),
  } as unknown as StringHeaderData;
}

interface ByteHeaderData {
  headers: Record<string, string>;
  data: Bytes;
}

function getHeadersAndDataBytes(
  data: Bytes,
  headerLength: number,
): ByteHeaderData {
  const lines = data.slice(2, headerLength).toString().split("\r\n");
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const splitted = line.split(":");
    const key = splitted.shift();
    headers[key!.toString()] = splitted.join(":");
  }

  return {
    headers,
    data: data.slice(headerLength + 2),
  };
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
  ws: Option<WebSocket> = None();

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

  async *stream(): AsyncGenerator<Result<TTSChunk, Error>, void> {
    if (this.state.streamWasCalled) {
      yield Err(new Error("stream can only be called once"));
    }

    this.state.streamWasCalled = true;
    for (this.state.partialText of this.texts) {
      for await (const message of this.#stream()) {
        yield message;
      }
    }
  }

  async *#stream(): AsyncGenerator<Result<TTSChunk, Error>, void> {
    let audioWasReceived = false;

    const ws = new WebSocket(
      `${WSS_URL}&ConnectionId=${connectId()}&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`,
      {
        headers: WSS_HEADERS,
      },
    );

    const sendCommandRequest = (): void => {
      const wordBoundary = this.ttsConfig.boundary === "WordBoundary";
      const wd = wordBoundary.toString();
      const sq = (!wordBoundary).toString();

      return ws.send(
        `X-Timestamp:${dateToString()}\r
Content-Type:application/json; charset=utf-8\r
Path:speech.config\r\n\r
{"context":{"synthesis":{"audio":{"metadataoptions":{\
"sentenceBoundaryEnabled":"${sq}","wordBoundaryEnabled":"${wd}"\
},\
"outputFormat":"audio-24khz-48kbitrate-mono-mp3"\
}}}}\r\n`,
      );
    };

    const sendSsmlRequest = (): void =>
      ws.send(
        ssmlHeadersPlusData(
          connectId(),
          dateToString(),
          mkssml(this.ttsConfig, this.state.partialText),
        ),
      );

    ws.onopen = (): void => {
      sendCommandRequest();
      sendSsmlRequest();
    };

    let promise =
      promiseWithResolvers<ControlFlow<void, Result<TTSChunk, Error>>>();

    ws.onmessage = async (event): Promise<void> => {
      const data = event.data;

      if (typeof data === "string") {
        const serializedData = getHeadersAndDataString(
          data,
          data.indexOf("\r\n\r\n"),
        );

        switch (serializedData.headers.Path) {
          case "audio.metadata": {
            const parsedMetadata = this.#parseMetadata(
              serializedData.data as AudioMetadataHeaderData["data"],
            );

            promise.resolve(
              ControlFlow.Continue(Ok(TTSChunk.Sub(parsedMetadata))),
            );

            this.state.lastDurationOffset =
              parsedMetadata.offset! + parsedMetadata.duration!;

            break;
          }
          case "turn.end":
            this.state.offsetCompensation = this.state.lastDurationOffset;
            this.state.offsetCompensation += 8_750_000;

            promise.resolve(ControlFlow.Break(undefined));

            ws.close();
            break;
          case "turn.start":
          case "response":
            break;
          default:
            promise.resolve(
              ControlFlow.Continue(
                Err(
                  new Error(
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    `Unknown path '${serializedData.headers.Path}' received`,
                  ),
                ),
              ),
            );
        }
      } else if (data instanceof Buffer) {
        if (data.length < 2) {
          promise.resolve(
            ControlFlow.Continue(
              Err(
                new Error(
                  "We received a binary message, but it is missing the header length.",
                ),
              ),
            ),
          );

          return;
        }

        const headerLength = data.readUint16BE(0);
        if (headerLength > data.length) {
          promise.resolve(
            ControlFlow.Continue(
              Err(
                new Error(
                  "The header length is greater than the length of the data.",
                ),
              ),
            ),
          );

          return;
        }

        const bytes = new Bytes(data);

        const serializedData = getHeadersAndDataBytes(bytes, headerLength);
        if (serializedData.headers.Path !== "audio") {
          promise.resolve(
            ControlFlow.Continue(
              Err(
                new Error(
                  "Received binary message, but the path is not audio.",
                ),
              ),
            ),
          );

          return;
        }

        const contentType = serializedData.headers["Content-Type"];
        if (contentType !== undefined && contentType !== "audio/mpeg") {
          promise.resolve(
            ControlFlow.Continue(
              Err(
                new Error(
                  "Received binary message, but with an unexpected Content-Type.",
                ),
              ),
            ),
          );

          return;
        }

        if (contentType === undefined) {
          if (serializedData.data.length === 0) {
            return;
          }

          promise.resolve(
            ControlFlow.Continue(
              Err(
                new Error(
                  "Received binary message with no Content-Type, but with data.",
                ),
              ),
            ),
          );

          return;
        }

        if (serializedData.data.length === 0) {
          promise.resolve(
            ControlFlow.Continue(
              Err(
                new Error(
                  "Received binary message, but it is missing the audio data.",
                ),
              ),
            ),
          );

          return;
        }

        promise.resolve(
          ControlFlow.Continue(
            Ok(TTSChunk.Audio({ data: serializedData.data })),
          ),
        );

        audioWasReceived = true;
      }
    };

    ws.onclose = async (): Promise<void> => {
      promise.resolve(ControlFlow.Break(undefined));
    };

    ws.onerror = async (_): Promise<void> => {
      promise.resolve(ControlFlow.Continue(Err(new Error("Unknown error"))));
    };

    while (true) {
      const control = await promise.promise;
      promise = promiseWithResolvers();

      if (control.isBreak()) {
        ws.close();

        if (!audioWasReceived) {
          yield Err(
            new Error(
              "No audio was received. Please verify that your parameters are correct.",
            ),
          );
        }
        return;
      }

      const result = control.unwrapContinue();
      if (result.isErr()) {
        ws.close();

        yield result;
        return;
      }

      yield result;
    }
  }

  #parseMetadata(data: AudioMetadataHeaderData["data"]): TTSChunkSub {
    for (const metadata of data.Metadata) {
      if (
        metadata.Type === "SentenceBoundary" ||
        metadata.Type === "WordBoundary"
      ) {
        return {
          type: metadata.Type,
          offset: metadata.Data.Offset + this.state.offsetCompensation,
          duration: metadata.Data.Duration,
          text: metadata.Data.text.Text,
        } satisfies TTSChunkSub;
      }
      if (metadata.Type === "SessionEnd") {
        continue;
      }
      throw new Error(`Unknown metadata type: ${metadata.Type}`);
    }
    throw new Error(`No Boundary metadata found`);
  }
}
