import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ConfigProvider } from "@/components/ConfigProvider";

export const metadata: Metadata = {
  title: "HighMath · 高中数学题库工作台",
  description: "高中数学题库的选题、组卷与讲义生成工具",
};

/**
 * 主题初始化脚本：在首帧前同步读取 localStorage，
 * 避免刷新时出现浅色闪烁（FOUC）。
 */
const themeInit = `(function(){try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <ConfigProvider>{children}</ConfigProvider>
      </body>
    </html>
  );
}
