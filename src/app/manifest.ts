import type { MetadataRoute } from "next";

/**
 * Web app manifest. Added 2026-08-13 with the vet402 brand assets: the
 * maskable icon is the only shipped asset that has no other way to be used
 * (Android applies its own mask to anything else and clips the dashed box).
 *
 * Deliberately `display: "browser"` — this is a document, not an app shell.
 * Claiming standalone would strip the URL bar from a site whose whole promise
 * is that you can check where a claim came from.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "vet402 — Independent Verification of the x402 Agent-Payment Economy",
    short_name: "vet402",
    description:
      "vet402 buys what x402 endpoints actually sell, verifies fulfillment against the seller's own declaration, and publishes the results with evidence.",
    start_url: "/",
    display: "browser",
    background_color: "#eef0f3",
    theme_color: "#233456",
    icons: [
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
