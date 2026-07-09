import { describe, it, expect } from "vitest";
import { scanForPhi, phiRejection } from "@/lib/phi-guard";

// Build a checksum-valid Korean RRN so the check-digit guard accepts it.
function validRrn(first12: string): string {
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(first12[i]) * w[i];
  return first12 + String(((11 - (s % 11)) % 10));
}

describe("scanForPhi", () => {
  it("detects a checksum-valid RRN", () => {
    const rrn = validRrn("900101123456");
    expect(scanForPhi({ note: `환자 주민번호 ${rrn.slice(0, 6)}-${rrn.slice(6)}` })).toBe("krn_rrn");
  });

  it("detects a Korean mobile number", () => {
    expect(scanForPhi({ pico: { population: "010-1234-5678" } })).toBe("phone_kr");
  });

  it("detects an email", () => {
    expect(scanForPhi("contact kim.cs@hospital.kr")).toBe("email");
  });

  it("returns null for de-identified structured input", () => {
    expect(scanForPhi({ pico: { population: "adults with sepsis", outcome: "28-day mortality" } })).toBeNull();
  });

  it("does not fire on a random 13-digit number with an invalid checksum", () => {
    // arbitrary digits unlikely to satisfy the RRN check digit
    expect(scanForPhi("1111111111111")).toBeNull();
  });
});

describe("phiRejection (PH-3 no-leak)", () => {
  it("carries the rule id but never the matched value", () => {
    const rrn = validRrn("900101123456");
    const rule = scanForPhi(rrn)!;
    const payload = phiRejection(rule);
    const blob = JSON.stringify(payload);
    expect(payload.error).toBe("phi_detected");
    expect(payload.rule).toBe("krn_rrn");
    expect(blob).not.toContain(rrn); // the value must never appear in the response
  });
});
