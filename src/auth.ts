import { randomBytes, timingSafeEqual } from "crypto";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function validateToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(provided, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}
