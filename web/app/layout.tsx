import type { Metadata } from "next";
import { Crimson_Pro, Crimson_Text, Inconsolata } from "next/font/google";
import "./globals.css";
import { AppFooter } from "@/components/AppFooter";
import { AppNavbar } from "@/components/AppNavbar";
import { WalletContextProvider } from "@/components/WalletContextProvider";
import { ThemeProvider } from "next-themes";
import { VercelAnalytics } from "@/components/VercelAnalytics";
import Script from "next/script";
import { buildDefaultMetadata } from "@/lib/seo";

const inconsolata = Inconsolata({
  subsets: ["latin"],
  variable: "--font-inconsolata",
});

const crimsonText = Crimson_Text({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-crimson-text",
});

// Reading serif for long-form articles (variable weight). Scoped to the blog
// via the .font-article class in globals.css.
const crimsonPro = Crimson_Pro({
  subsets: ["latin"],
  variable: "--font-crimson-pro",
});

export const metadata: Metadata = buildDefaultMetadata();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-EKFE31B4TJ"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-EKFE31B4TJ');
          `}
        </Script>
      </head>
      <body
        className={`${inconsolata.variable} ${crimsonText.variable} ${crimsonPro.variable} font-mono`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
        >
          <WalletContextProvider>
            <AppNavbar />
            {children}
            <AppFooter />
          </WalletContextProvider>
        </ThemeProvider>
        <VercelAnalytics />
      </body>
    </html>
  );
}
