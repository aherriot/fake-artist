import type { Metadata } from "next";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ConnectionBanner } from "@/lib/ui/ConnectionBanner";

// Serif for wall labels, grotesque for controls, mono for catalogue numbers.
// Each has a job; none is decoration.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "A Fake Artist Goes to New York",
  description: "Online multiplayer drawing and deduction game",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${plexMono.variable}`}
    >
      <body className="min-h-screen bg-wall-800 text-label-100 antialiased">
        <ConnectionBanner />
        {children}
      </body>
    </html>
  );
}
