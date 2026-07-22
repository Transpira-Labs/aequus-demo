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
    "A demo built for Aequus Worldwide Logistics. It sits between Aequus Ops and the partner network across road, air, and ocean, watches the traffic between them, and catches problems as they happen.",
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
