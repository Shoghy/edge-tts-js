import { z } from "zod/v4";
import { expect, test } from "bun:test";
import { listVoices } from "../src/index.ts";

const voicesZod = z.strictObject({
  Name: z.string(),
  ShortName: z.string(),
  Gender: z.enum(["Male", "Female"]),
  Locale: z.string(),
  SuggestedCodec: z.string(),
  FriendlyName: z.string(),
  Status: z.enum(["GA", "Preview", "Deprecated"]),
  VoiceTag: z.strictObject({
    ContentCategories: z.array(
      z.enum([
        "General",
        "News",
        "Novel",
        " Novel", //Microsoft has a typo in the voice Microsoft Yunjian Online (Natural) - Chinese (Mainland) XDXDXDXD
        "Cartoon",
        "Sports",
        "Dialect",
        "Conversation",
        "Copilot",
      ]),
    ),
    VoicePersonalities: z.array(
      z.enum([
        "Friendly",
        "Positive",
        "Warm",
        "Lively",
        "Passion",
        "Cute",
        "Humorous",
        "Professional",
        "Reliable",
        "Expressive",
        "Caring",
        "Pleasant",
        "Confident",
        "Authentic",
        "Honest",
        "Rational",
        "Considerate",
        "Comfort",
        "Cheerful",
        "Clear",
        "Conversational",
        "Authority",
        "Approachable",
        "Casual",
        "Sincere",
        "Bright",
        "Sunshine",
      ]),
    ),
  }),
});

test("Validate voice data", async () => {
  const voices = (await listVoices()).unwrap();
  const validation = z.array(voicesZod).safeParse(voices);
  expect(validation.error).toBe(undefined);
});
