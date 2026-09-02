import type { Metadata } from "next";

const DEMO_SITE_URL = "https://mf-dashboard-demo.vercel.app";
const LOCAL_SITE_URL = "http://localhost:3000";
const DASHBOARD_DESCRIPTION = "MoneyForward Me のデータを可視化するダッシュボード";

export function createMetadataBase(
  environment: Record<string, string | undefined> = process.env,
): URL {
  const siteUrl =
    environment.NEXT_PUBLIC_SITE_URL ??
    environment.DASHBOARD_URL ??
    environment.VERCEL_PROJECT_PRODUCTION_URL ??
    environment.VERCEL_URL;

  if (siteUrl) {
    return new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`);
  }

  if (environment.DEMO_MODE === "true") {
    return new URL(DEMO_SITE_URL);
  }

  if (environment.NODE_ENV === "production") {
    throw new Error("DASHBOARD_URL is required for production metadata");
  }

  return new URL(LOCAL_SITE_URL);
}

function createMetadataAssetUrl(
  environment: Record<string, string | undefined>,
  path: `/${string}`,
): string {
  const base = createMetadataBase(environment);
  const configuredBasePath = (environment.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
  const basePath =
    configuredBasePath &&
    (base.pathname === configuredBasePath || base.pathname.startsWith(`${configuredBasePath}/`))
      ? ""
      : configuredBasePath;
  const assetBase = new URL(base);
  assetBase.pathname = `${assetBase.pathname.replace(/\/+$/, "")}${basePath}/`;
  return new URL(path.slice(1), assetBase).toString();
}

export function createRootMetadata(
  environment: Record<string, string | undefined> = process.env,
): Metadata {
  const basePath = environment.NEXT_PUBLIC_BASE_PATH ?? "";
  const withBasePath = (path: `/${string}`) => `${basePath}${path}`;
  const metadataAssetUrl = (path: `/${string}`) => createMetadataAssetUrl(environment, path);

  return {
    metadataBase: createMetadataBase(environment),
    title: {
      template: "%s | MoneyForward Me Dashboard",
      default: "MoneyForward Me Dashboard",
    },
    description: DASHBOARD_DESCRIPTION,
    manifest: metadataAssetUrl("/manifest.webmanifest"),
    icons: {
      icon: metadataAssetUrl("/favicon.ico"),
      apple: metadataAssetUrl("/apple-touch-icon.png"),
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black",
      title: "MF Dashboard",
    },
    openGraph: {
      title: "MoneyForward Me Dashboard",
      description: DASHBOARD_DESCRIPTION,
      type: "website",
      locale: "ja_JP",
      images: [
        {
          url: withBasePath("/logo.png"),
          width: 758,
          height: 708,
          alt: "MoneyForward Me Dashboard",
        },
      ],
    },
    twitter: {
      card: "summary",
      title: "MoneyForward Me Dashboard",
      description: DASHBOARD_DESCRIPTION,
      images: [withBasePath("/logo.png")],
    },
  };
}
