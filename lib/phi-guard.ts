// Runtime PHI defence (PH-2). Ported from the plugin's phi_screener.py pattern set.
//
// ABSOLUTE RULE (PH-3): a matched value — or any fragment of it — is NEVER logged
// or echoed back. Detection returns only the rule id that fired. Callers must not
// log the scanned payload on any code path.

// Korean Resident Registration Number: 6 digits + gender/century digit (1-4) + 6.
const RRN_RE = /(?<!\d)(\d{6})[- ]?([1-4]\d{6})(?!\d)/g;
// Korean mobile phone: 010/011/016/017/018/019.
const PHONE_RE = /(?<!\d)01[016789][- ]?\d{3,4}[- ]?\d{4}(?!\d)/;
// Email.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Validate the 13-digit RRN check digit (reduces false positives). */
function rrnChecksumValid(digits: string): boolean {
  if (digits.length !== 13 || !/^\d{13}$/.test(digits)) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(digits[i]) * weights[i];
  const check = (11 - (total % 11)) % 10;
  return check === Number(digits[12]);
}

function hitRrn(text: string): boolean {
  RRN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RRN_RE.exec(text)) !== null) {
    if (rrnChecksumValid(m[1] + m[2])) return true;
  }
  return false;
}

export type PhiRule = "krn_rrn" | "phone_kr" | "email";

/**
 * Scan an arbitrary tool input for PHI patterns. The value is JSON.stringify'd
 * and scanned as a single blob. Returns the first rule that fires, or null.
 * Never returns or logs the matched substring.
 */
export function scanForPhi(input: unknown): PhiRule | null {
  let blob: string;
  try {
    blob = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    // Unserialisable input can't be safely screened — treat as clean; the zod
    // schema already restricts shape (PH-1 structural defence).
    return null;
  }
  if (!blob) return null;
  if (hitRrn(blob)) return "krn_rrn";
  if (PHONE_RE.test(blob)) return "phone_kr";
  if (EMAIL_RE.test(blob)) return "email";
  return null;
}

/** Standard tool-result payload for a PHI rejection (PH-2). Not an MCP error —
 *  a normal result the client LLM reads and acts on. Carries NO matched value. */
export function phiRejection(rule: PhiRule) {
  return {
    error: "phi_detected",
    rule,
    guidance:
      "입력에서 개인식별정보(PHI) 패턴이 감지되어 요청을 처리하지 않았습니다. " +
      "요청 본문은 어디에도 저장되지 않았습니다. 로컬 phi_screener로 스크리닝한 뒤 " +
      "비식별 파생물(PICO·키워드·집계값)만 보내세요.",
  };
}
