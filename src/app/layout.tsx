import type { Metadata } from "next";
import "@/styles/globals.css";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  keywords: ['DPMPTSP', 'Lampung', 'pelayanan terpadu', 'OSS', 'UMKM', 'investasi'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
