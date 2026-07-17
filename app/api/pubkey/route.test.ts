import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { _resetRateLimiter } from "@/lib/rate-limit";
import { GET } from "@/app/api/pubkey/route";

const ENV_KEYS = ["RF_SIGNING_PUBLIC_KEY", "RF_SIGNING_KEY_ID"] as const;

function saveEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

function injectTestPublicKey(keyId = "test-ed25519-1"): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env.RF_SIGNING_PUBLIC_KEY = Buffer.from(pem, "utf8").toString("base64");
  process.env.RF_SIGNING_KEY_ID = keyId;
  return pem;
}

function req(ip = "203.0.113.50"): Request {
  return new Request("http://localhost/api/pubkey", {
    method: "GET",
    headers: { "x-real-ip": ip },
  });
}

let envSnap: Record<string, string | undefined>;

beforeEach(() => {
  envSnap = saveEnv();
  _resetRateLimiter();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  restoreEnv(envSnap);
  _resetRateLimiter();
});

describe("GET /api/pubkey", () => {
  it("returns 200 with key_id, alg, and SPKI PEM when configured", async () => {
    const expectedPem = injectTestPublicKey("unit-c-key");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key_id).toBe("unit-c-key");
    expect(body.alg).toBe("ed25519");
    expect(body.public_key_pem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(body.public_key_pem).toContain("-----END PUBLIC KEY-----");
    // Round-trip: re-exported SPKI should match the injected PEM.
    expect(body.public_key_pem).toBe(expectedPem);
    expect(typeof body.note).toBe("string");
    expect(body.note.toLowerCase()).toContain("blind oracle");
  });

  it("returns signing_not_configured when RF_SIGNING_PUBLIC_KEY is unset", async () => {
    const res = await GET(req());
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("signing_not_configured");
    expect(typeof body.guidance).toBe("string");
    expect(body.public_key_pem).toBeUndefined();
  });

  it("rate-limits after 60 hits per IP with Retry-After", async () => {
    injectTestPublicKey();
    const ip = "198.51.100.42";
    for (let i = 0; i < 60; i++) {
      const res = await GET(req(ip));
      expect(res.status).toBe(200);
    }
    const limited = await GET(req(ip));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await limited.json()).toEqual({ error: "rate_limited" });
  });
});
