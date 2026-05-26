import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope, JetBrains_Mono } from "next/font/google";
import { Nav } from "./_components/Nav";
import "./globals.css";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
});

const body = Manrope({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Aesthetic — quote videos for the feed",
  description: "Turn a song, a quote, and a vibe into a TikTok-ready video.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="bg-bg text-ink font-body antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
