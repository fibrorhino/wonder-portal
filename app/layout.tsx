import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WONDER Portal — CDC WONDER explorer",
  description:
    "Query, analyze, and visualize CDC WONDER Underlying Cause of Death (Single Race, 2018–2024) data with customizable tables, figures, and statistics.",
};

// Cloudflare Web Analytics: cookieless page-view stats (visitors, referrers,
// countries, browsers). Enabled only when CF_ANALYTICS_TOKEN is set, so the
// site runs unchanged without it — see .env.example.
//
// This layout is statically prerendered, so the token is read at BUILD time:
// set it in .env.local and then `npm run build`. Changing it without a rebuild
// has no effect.
//
// The beacon token is not a secret — it is public by design and visible in the
// page source. It identifies the site, it does not grant access to anything.
const cfAnalyticsToken = process.env.CF_ANALYTICS_TOKEN;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {cfAnalyticsToken && (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            strategy="afterInteractive"
            data-cf-beacon={JSON.stringify({ token: cfAnalyticsToken })}
          />
        )}
      </body>
    </html>
  );
}
