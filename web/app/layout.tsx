import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RemitRail: compliant remittances on Stellar",
  description: "Hackathon prototype: instant, sub-cent cross-border transfers with automated INR off-ramp.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
