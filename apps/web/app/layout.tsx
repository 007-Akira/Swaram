import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "സ്വരം",
  description: "സ്വകാര്യ മലയാളം പാട്ടുപരിശീലനം",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ml">
      <body>{children}</body>
    </html>
  );
}
