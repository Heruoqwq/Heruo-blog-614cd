import type { Metadata } from "next";
import "./globals.css";
import "./community.css";
import "katex/dist/katex.min.css";
export const metadata: Metadata = {
  title: "Heruo OJ",
  description: "Heruo OJ",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
