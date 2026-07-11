import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants";
import { ToastProvider } from "@/components/Toast";
import OfflineBanner from "@/components/OfflineBanner";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  keywords: ['DPMPTSP', 'Lampung', 'pelayanan terpadu', 'OSS', 'UMKM', 'investasi'],
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>
        <a href="#main-content" className="skip-link">
          Lewati ke konten utama
        </a>
        <OfflineBanner />
        <ToastProvider>
          <main id="main-content">{children}</main>
        </ToastProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
