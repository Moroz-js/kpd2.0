import { describe, expect, it } from "vitest";
import {
  isLoginRateLimited,
  loginRateLimitKeys,
} from "@/lib/login-rate-limit";

const now = new Date("2026-09-03T10:00:00.000Z");

describe("login rate limit", () => {
  it("блокирует учётную запись после пяти ошибок в окне 15 минут", () => {
    expect(isLoginRateLimited({
      attempts: 5,
      windowStartedAt: new Date("2026-09-03T09:50:00.000Z"),
      lockedUntil: null,
    }, 5, now)).toBe(true);
  });

  it("снимает лимит после истечения окна или блокировки", () => {
    expect(isLoginRateLimited({
      attempts: 5,
      windowStartedAt: new Date("2026-09-03T09:44:59.000Z"),
      lockedUntil: null,
    }, 5, now)).toBe(false);
    expect(isLoginRateLimited({
      attempts: 5,
      windowStartedAt: new Date("2026-09-03T09:50:00.000Z"),
      lockedUntil: new Date("2026-09-03T09:59:59.000Z"),
    }, 5, now)).toBe(true);
    expect(isLoginRateLimited({
      attempts: 5,
      windowStartedAt: new Date("2026-09-03T09:44:59.000Z"),
      lockedUntil: new Date("2026-09-03T09:59:59.000Z"),
    }, 5, now)).toBe(false);
  });

  it("не сохраняет email и IP в открытом виде", () => {
    const keys = loginRateLimitKeys(
      "user@example.com",
      new Request("https://kpd.example/api/auth", {
        headers: { "x-forwarded-for": "203.0.113.1" },
      }),
    );

    expect(keys).toHaveLength(2);
    expect(keys.map(({ key }) => key)).not.toContain("user@example.com");
    expect(keys.map(({ key }) => key)).not.toContain("203.0.113.1");
  });
});
