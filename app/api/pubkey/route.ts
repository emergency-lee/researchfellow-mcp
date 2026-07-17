// Public verification key endpoint — independent of /api/[transport].
// Serves the ed25519 public key so third parties can independently re-check
// verify_report signatures (existence + non-tamper only; blind oracle).

import { NextResponse } from "next/server";
import { keyId, loadPublicKeyFromEnv } from "@/lib/integrity";
import { checkRateLimit } from "@/lib/rate-limit";

// Prefer Vercel-set x-real-ip; fall back to x-forwarded-for leftmost hop.
function clientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

// In-memory buckets are per serverless instance (see lib/rate-limit.ts).
// SECOND line of defence only — edge WAF is the real perimeter.
const PUBKEY_RATE = { max: 60, windowMs: 60_000 } as const;
const PUBKEY_RETRY_AFTER_SEC = String(PUBKEY_RATE.windowMs / 1000);

export async function GET(req: Request) {
  if (!checkRateLimit(`pubkey:${clientIp(req)}`, PUBKEY_RATE)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": PUBKEY_RETRY_AFTER_SEC } },
    );
  }

  const publicKey = loadPublicKeyFromEnv();
  if (!publicKey) {
    return NextResponse.json(
      {
        error: "signing_not_configured",
        guidance:
          "서버 공개키(RF_SIGNING_PUBLIC_KEY)가 설정되지 않아 게시할 수 없습니다. " +
          "관리자가 서명 키 쌍을 프로비저닝한 뒤 다시 요청하세요.",
      },
      { status: 503 },
    );
  }

  const public_key_pem = publicKey.export({ type: "spki", format: "pem" }).toString();

  return NextResponse.json({
    key_id: keyId(),
    alg: "ed25519",
    public_key_pem,
    note:
      "이 공개키로 verify_report 결과(ed25519 서명)를 외부에서 독립 검증할 수 있다. " +
      "서명은 해당 manifest가 issued_at 시점에 존재했고 이후 변조되지 않았음만 증명한다(blind oracle). " +
      "주장 내용이나 발급 이전 이력은 검증하지 않는다.",
  });
}
