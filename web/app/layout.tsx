import type { Metadata } from "next";
import "./globals.css";
import "./cinematic-intro.css";

export const metadata: Metadata = {
  title: "Aircraft Document Processing | EVE",
  description: "A workspace for aircraft-utilization document processing.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="grant-thornton"><body>{children}</body></html>;
}
