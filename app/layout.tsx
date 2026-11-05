import type { Metadata } from "next";
import "./globals.css";
import "./community.css";
import "./themes.css";
import "./article-reader.css";
import { themeBootstrap } from "./theme";
import "katex/dist/katex.min.css";
export const metadata: Metadata = {
  title: "Heruo OJ",
  description: "Heruo OJ",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }}/></head><body>{children}</body></html>;
}
