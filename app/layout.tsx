import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "A Fake Artist Goes to New York",
  description: "Online multiplayer drawing and deduction game",
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
