import { describe, expect, it } from "vitest";
import { canResetUserPassword } from "@/lib/permissions";

const admin = { id: "admin", role: "admin", isSuperAdmin: false };
const superAdmin = { id: "super", role: "admin", isSuperAdmin: true };

describe("password reset permissions", () => {
  it("не разрешает обычному админу менять пароль super-admin", () => {
    expect(canResetUserPassword(admin, "super", true)).toBe(false);
  });

  it("разрешает super-admin менять пароль super-admin", () => {
    expect(canResetUserPassword(superAdmin, "other-super", true)).toBe(true);
  });

  it("сохраняет обычному админу право менять пароль другому обычному пользователю", () => {
    expect(canResetUserPassword(admin, "user", false)).toBe(true);
    expect(canResetUserPassword(admin, "admin", false)).toBe(false);
  });
});
