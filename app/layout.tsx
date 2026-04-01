import type { Metadata } from "next";
import { execSync } from "node:child_process";
import { Geist, Geist_Mono } from "next/font/google";
import packageJson from "../package.json";
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

function getGitCommitShortHash() {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      cwd: process.cwd(),
    }).trim();
  } catch {
    return "43bs32";
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appVersion = `v.${packageJson.version}`;
  const repoVersion = process.env.NEXT_PUBLIC_GITHUB_VERSION ?? `#${getGitCommitShortHash()}`;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border bg-background/90 px-4 py-3 text-center text-xs text-muted-foreground backdrop-blur">
          Snapflare ©2026 {appVersion} dev {repoVersion}
        </footer>
      </body>
    </html>
  );
}
