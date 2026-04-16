import "./styles.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Preload Bravura so the clef glyph is available before first paint */}
        <link
          rel="preload"
          href="/fonts/BravuraText.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
