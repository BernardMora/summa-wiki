import "./globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import Masthead from "@/components/Masthead.tsx";
import SideNav from "@/components/SideNav.tsx";
import Resizer from "@/components/Resizer.tsx";
import TabsProvider, { TabBar } from "@/components/Tabs.tsx";

export const metadata: Metadata = {
  title: "Berni's Wiki — La enciclopedia personal",
  description: "Lector y editor local de la base de conocimiento del AIOS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('wiki.theme');" +
              "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}",
          }}
        />
      </head>
      <body>
        <Suspense fallback={null}>
        <TabsProvider>
          <Masthead />
          <div className="shell">
            <SideNav />
            <Resizer />
            <div className="content">
              <TabBar />
              {children}
            </div>
          </div>
        </TabsProvider>
        </Suspense>
      </body>
    </html>
  );
}
