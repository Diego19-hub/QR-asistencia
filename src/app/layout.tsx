import type { Metadata } from "next";
import type { ReactNode } from "react";

import { HelpAssistant } from "@/components/help/help-assistant";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asistencia QR",
  description: "Control de asistencia laboral",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-MX">
      <body>{children}<HelpAssistant /></body>
    </html>
  );
}
