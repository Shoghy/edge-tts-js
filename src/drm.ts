import { createHash, randomBytes } from "crypto";
import { TRUSTED_CLIENT_TOKEN } from "./constants.ts";

const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

function generateMuid(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

export function headersWithMuid({
  ...headers
}: Record<string, string>): Record<string, string> {
  if ("Cookie" in headers) {
    throw new Error("Header already has `Cookie`");
  }
  headers.Cookie = `muid=${generateMuid()}`;
  return headers;
}

export function generateSecMsGec(): string {
  let ticks = Date.now() / 1000;

  ticks += WIN_EPOCH;

  ticks -= ticks % 300;

  ticks *= S_TO_NS / 100;

  ticks = Math.round(ticks);

  const strToHash = `${ticks}${TRUSTED_CLIENT_TOKEN}`;

  return encryptSecMsGec(strToHash);
}

function encryptSecMsGec(value: string): string {
  return createHash("sha256")
    .update(value, "ascii")
    .digest("hex")
    .toUpperCase();
}
