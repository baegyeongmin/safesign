import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SafeSign",
  description: "PDF 계약서 분석 서비스",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
