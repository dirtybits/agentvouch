import { ImageResponse } from "next/og";
import { SocialImageCard } from "@/components/SocialImageCard";
import { loadOgFonts } from "./og-fonts";

export const runtime = "edge";
export const alt = "AgentVouch social card";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function TwitterImage() {
  return new ImageResponse(<SocialImageCard />, {
    ...size,
    fonts: await loadOgFonts(),
  });
}
