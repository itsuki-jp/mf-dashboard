import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn<(url: URL) => string>(() => "jwks"),
  jwtVerify:
    vi.fn<
      (
        token: string,
        jwks: string,
        options: { audience: string; issuer: string },
      ) => Promise<{ payload: Record<string, never> }>
    >(),
}));

vi.mock("jose", () => mocks);

const { hasValidDashboardAccess } = await import("./dashboard-access");

function request(headers: Record<string, string> = {}, url = "https://dashboard.example.com/api") {
  return new Request(url, { headers });
}

describe("hasValidDashboardAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("AUTH_MODE", "cloudflare");
    vi.stubEnv("CLOUDFLARE_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com");
    vi.stubEnv("CLOUDFLARE_ACCESS_AUD", "application-audience");
    mocks.jwtVerify.mockResolvedValue({ payload: {} });
  });

  it("cloudflare modeでAccess JWTを検証する", async () => {
    await expect(
      hasValidDashboardAccess(request({ "cf-access-jwt-assertion": "access-token" })),
    ).resolves.toBe(true);

    expect(mocks.jwtVerify).toHaveBeenCalledWith("access-token", "jwks", {
      audience: "application-audience",
      issuer: "https://team.cloudflareaccess.com",
    });
  });

  it("cloudflare modeは設定・assertion不足または無効JWTでfail closedする", async () => {
    await expect(hasValidDashboardAccess(request())).resolves.toBe(false);

    vi.stubEnv("CLOUDFLARE_ACCESS_AUD", "");
    await expect(
      hasValidDashboardAccess(request({ "cf-access-jwt-assertion": "access-token" })),
    ).resolves.toBe(false);
    expect(mocks.jwtVerify).not.toHaveBeenCalled();

    vi.stubEnv("CLOUDFLARE_ACCESS_AUD", "application-audience");
    mocks.jwtVerify.mockRejectedValue(new Error("expired"));
    await expect(
      hasValidDashboardAccess(request({ "cf-access-jwt-assertion": "access-token" })),
    ).resolves.toBe(false);
  });

  it("tailscale modeでServeが付与した本人のloginだけを許可する", async () => {
    vi.stubEnv("AUTH_MODE", "tailscale");
    vi.stubEnv("TAILSCALE_ALLOWED_LOGIN", "user-a@example.com");

    await expect(
      hasValidDashboardAccess(request({ "tailscale-user-login": "user-a@example.com" })),
    ).resolves.toBe(true);
    await expect(
      hasValidDashboardAccess(request({ "tailscale-user-login": "user-b@example.com" })),
    ).resolves.toBe(false);
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
  });

  it("tailscale modeは設定またはidentity headerが欠けるとfail closedする", async () => {
    vi.stubEnv("AUTH_MODE", "tailscale");
    vi.stubEnv("TAILSCALE_ALLOWED_LOGIN", "");

    await expect(
      hasValidDashboardAccess(request({ "tailscale-user-login": "user-a@example.com" })),
    ).resolves.toBe(false);

    vi.stubEnv("TAILSCALE_ALLOWED_LOGIN", "user-a@example.com");
    await expect(hasValidDashboardAccess(request())).resolves.toBe(false);
  });

  it("development modeは明示opt-inしたloopback開発環境だけを許可する", async () => {
    vi.stubEnv("AUTH_MODE", "development");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_AUTH_BYPASS", "true");

    await expect(hasValidDashboardAccess(request({}, "http://127.0.0.1:3000/api"))).resolves.toBe(
      true,
    );
    await expect(hasValidDashboardAccess(request({}, "http://192.0.2.10:3000/api"))).resolves.toBe(
      false,
    );

    vi.stubEnv("NODE_ENV", "production");
    await expect(hasValidDashboardAccess(request({}, "http://127.0.0.1:3000/api"))).resolves.toBe(
      false,
    );
  });

  it("未指定modeはCloudflare互換、未知modeはfail closedする", async () => {
    vi.stubEnv("AUTH_MODE", "");
    await expect(
      hasValidDashboardAccess(request({ "cf-access-jwt-assertion": "access-token" })),
    ).resolves.toBe(true);

    vi.stubEnv("AUTH_MODE", "unknown");
    await expect(
      hasValidDashboardAccess(request({ "cf-access-jwt-assertion": "access-token" })),
    ).resolves.toBe(false);
  });

  it("demo data modeは外部認証を要求しない", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(hasValidDashboardAccess(request())).resolves.toBe(true);
  });
});
