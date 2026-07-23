import type { Metadata } from "next";
import { Montserrat, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Shared ecosystem type: Montserrat sans/display + IBM Plex Mono for data/labels.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Transpira · Aequus Worldwide Logistics",
  description:
    "One place to see and run the whole operation. Built for Aequus Worldwide Logistics: it sits on top of the tools Aequus already uses, unifies road, air, and ocean freight plus customs into one feed the team can search, monitor, and act from, and runs AI agents that take repetitive work off the team's plate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${ibmPlexMono.variable} h-full`}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
