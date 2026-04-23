import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Electron + Next.js Boilerplate",
  description: "A starter desktop application powered by Electron and Next.js."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
