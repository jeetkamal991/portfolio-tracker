import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jbmono",
});

export const metadata: Metadata = {
  title: "Nifty Pulse",
  description: "Private Nifty market dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jbMono.variable}`}>
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes to <body> before React hydrates. */}
      <body className="bg-[var(--bg)] font-sans text-[var(--text)] antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
