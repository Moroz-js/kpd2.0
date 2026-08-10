import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "КПД — Система управления проектами",
  description: "Система управления проектами КПД",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${geist.variable} antialiased`} style={{ height: "100%", overflow: "hidden" }}>
      <body
        suppressHydrationWarning
        className="font-sans"
        style={{ height: "100%", overflow: "hidden", maxHeight: "100vh" }}
      >
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
