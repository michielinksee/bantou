import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KanseiLink Cockpit — 税理士事務所の AI 作業共有 layer",
  description:
    "税理士向け自動仕訳 automation を 5 分で install + チーム共有 + 顧問先 view。 freee + Money Forward 横断、 Claude / GPT / Codex どれでも動く。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
