import { catchUnwind, catchUnwindAsync, safeFetch } from "rusting-js";
import { Arm, Class, Enum, Err, Ok, type Result } from "rusting-js/enums";
import { SEC_MS_GEC_VERSION, VOICE_HEADERS, VOICE_LIST } from "./constants.ts";
import { generateSecMsGec } from "./drm.ts";

class ListVoiceError extends Enum({
  __classType__: Class<ListVoiceError>(),
  FetchThrow: Arm<Error>(),
  ReponseIsNotValidJSON: Arm<string>(),
  UnknownReponse: Arm<Error>(),
}) {}

interface Voice {
  Name: string;
  DisplayName: string;
  LocalName: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  LocaleName: string;
  SampleRateHertz: string;
  VoiceType: string;
  Status: string;
  VoiceTag?: Record<string, string[]>;
  WordsPerMinute: string;
}

export async function listVoices(): Promise<Result<Voice[], ListVoiceError>> {
  const responseResult = await safeFetch(
    `${VOICE_LIST}&Sec-MS-GEC=${await generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`,
    {
      headers: VOICE_HEADERS,
    },
  );

  if (responseResult.isErr()) {
    return Err(ListVoiceError.FetchThrow(responseResult.unwrapErr()));
  }

  const response = responseResult.unwrap();

  const responseTextResult = await catchUnwindAsync(() => response.text());
  if (responseTextResult.isErr()) {
    return Err(ListVoiceError.UnknownReponse(responseTextResult.unwrapErr()));
  }

  const responseText = responseTextResult.unwrap();
  const jsonResult = catchUnwind(() => JSON.parse(responseText));

  if (jsonResult.isErr()) {
    return Err(ListVoiceError.ReponseIsNotValidJSON(responseText));
  }

  const json = jsonResult.unwrap();

  return Ok(json as Voice[]);
}
