import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Snapflare",
  description: "Photo project dashboard",
};

const GIT_SHORT_HASH = "e5d9c16";

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
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border bg-background/90 px-4 py-3 text-center text-xs text-muted-foreground backdrop-blur">
          Snapflare by filmstein.com · © 2026 · v1.0.1 beta · #{GIT_SHORT_HASH}
        </footer>
      </body>
    </html>
  );
}
