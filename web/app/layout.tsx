import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aircraft Document Processing | EVE",
  description: "A workspace for aircraft-utilization document processing.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
