import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";
import "@/lib/localStorage-polyfill";
import ClientComponents from "@/components/ClientComponents";

export const metadata: Metadata = {
  title: "ExamForge - AI-Powered Exam Generation",
  description: "Create professional exams in minutes with AI-powered question generation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* <ErrorReporter /> */}
        <Script
          src="https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/object/public/scripts//route-messenger.js"
          strategy="afterInteractive"
          data-target-origin="*"
          data-message-type="ROUTE_CHANGE"
          data-include-search-params="true"
          data-only-in-iframe="true"
          data-debug="true"
          data-custom-data='{"appName": "YourApp", "version": "1.0.0", "greeting": "hi"}'
        />
        {children}
        <ClientComponents />
      </body>
    </html>
  );
}
