import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chronicle BI",
  description: "Chronicle BI desktop workspace for projects, connections, and catalog metadata.",
  icons: {
    icon: "/assets/icons/desktop_app_icon_pack/app_icon_windows.ico"
  }
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
