import "./globals.css";
import type { Metadata } from "next";
import Masthead from "@/components/Masthead.tsx";
import SideNav from "@/components/SideNav.tsx";
import Resizer from "@/components/Resizer.tsx";

export const metadata: Metadata = {
  title: "Berni's Wiki — La enciclopedia personal",
  description: "Lector y editor local de la base de conocimiento del AIOS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Masthead />
        <div className="shell">
          <SideNav />
          <Resizer />
          <div className="content">{children}</div>
        </div>
      </body>
    </html>
  );
}
