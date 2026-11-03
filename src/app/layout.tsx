import type { Metadata, Viewport } from "next";
import { Cinzel, Inter } from "next/font/google";
import { siteConfig } from "@/config/site";
import "./globals.css";

const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"], weight: ["500", "700"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  description: siteConfig.description,
};

export const viewport: Viewport = {
  themeColor: "#07060a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${cinzel.variable} ${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
