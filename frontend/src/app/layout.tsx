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
      <head>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @media (max-width: 768px) {
            .result-layout { flex-direction: column !important; }
            .right-panel { position: static !important; }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
