import type { Metadata } from "next";
import { SurveyApp } from "../survey-app-client";

export const metadata: Metadata = {
  title: "관리자 · 동부학교스포츠클럽 참가 신청",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <SurveyApp initialView="admin" />;
}
