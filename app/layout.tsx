import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Multiplayer POC",
  description: "Lobby / sync / reconnect harness for Next.js + Neon + Pusher",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          margin: 0,
          padding: 24,
          lineHeight: 1.5,
          background: "#111",
          color: "#eee",
        }}
      >
        {children}
      </body>
    </html>
  );
}
