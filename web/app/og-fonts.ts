import type { ImageResponse } from "next/og";

type SatoriFont = NonNullable<
  ConstructorParameters<typeof ImageResponse>[1]
>["fonts"];

// Load the brand fonts as ArrayBuffers for next/og (Satori). The files are
// colocated in ./fonts and referenced via import.meta.url so the bundler
// traces and ships them. Satori only understands TTF/OTF/WOFF (not WOFF2),
// so these are static TTF instances of the Google Fonts used in the app:
//   Crimson Text  — display serif (titles, wordmark)
//   Inconsolata   — load-bearing mono (eyebrows, labels, URLs)
export async function loadOgFonts(): Promise<SatoriFont> {
  const [crimsonRegular, crimsonSemiBold, inconsolataRegular, inconsolataBold] =
    await Promise.all([
      fetch(new URL("./fonts/CrimsonText-Regular.ttf", import.meta.url)).then(
        (res) => res.arrayBuffer()
      ),
      fetch(new URL("./fonts/CrimsonText-SemiBold.ttf", import.meta.url)).then(
        (res) => res.arrayBuffer()
      ),
      fetch(new URL("./fonts/Inconsolata-Regular.ttf", import.meta.url)).then(
        (res) => res.arrayBuffer()
      ),
      fetch(new URL("./fonts/Inconsolata-Bold.ttf", import.meta.url)).then(
        (res) => res.arrayBuffer()
      ),
    ]);

  return [
    {
      name: "Crimson Text",
      data: crimsonRegular,
      weight: 400,
      style: "normal",
    },
    {
      name: "Crimson Text",
      data: crimsonSemiBold,
      weight: 600,
      style: "normal",
    },
    {
      name: "Inconsolata",
      data: inconsolataRegular,
      weight: 400,
      style: "normal",
    },
    {
      name: "Inconsolata",
      data: inconsolataBold,
      weight: 700,
      style: "normal",
    },
  ];
}
