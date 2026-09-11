import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./redesign.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://dongbu-application.qkrwlgns5.workers.dev",
  ),
  title: "동부교육지원청 학교스포츠클럽대회 참가 신청",
  description: "동부학교스포츠클럽대회 참가 종목과 종별을 학교별로 신청하는 페이지입니다.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "동부교육지원청 학교스포츠클럽대회 참가 신청",
    description: "학교별 참가 종목·종별·팀 수를 온라인으로 신청합니다.",
    type: "website",
    locale: "ko_KR",
    images: [{ url: "/og-application.png", width: 1734, height: 907, alt: "동부학교스포츠클럽 참가 신청" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "동부학교스포츠클럽 참가 신청",
    description: "학교별 참가 종목·종별·팀 수 온라인 신청",
    images: ["/og-application.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
