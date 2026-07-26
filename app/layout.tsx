import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Berni's Wiki",
  description: "Local reader and editor for the AIOS knowledge base",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
