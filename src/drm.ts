import { TRUSTED_CLIENT_TOKEN } from "./constants.ts";

const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const isBrowser = typeof window !== "undefined";

export function generateSecMsGec() {
  let ticks = Date.now() / 1000;

  ticks += WIN_EPOCH;

  ticks -= ticks % 300;

  ticks *= S_TO_NS / 100;

  ticks = Math.round(ticks);

  const strToHash = `${ticks}${TRUSTED_CLIENT_TOKEN}`;

  return encryptSecMsGec(strToHash);
}

async function encryptSecMsGec(value: string) {
  if (isBrowser) {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    const hashBytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", data),
    );

    let hash = "";
    for (const b of hashBytes) {
      hash += b.toString(16).padStart(2, "0");
    }

    return hash.toUpperCase();
  }

  const { createHash } = await import("crypto");

  return createHash("sha256")
    .update(value, "ascii")
    .digest("hex")
    .toUpperCase();
}
