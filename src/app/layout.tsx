import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdaptQuiz",
  description: "Upload notes. Quiz to mastery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-[#3D5A80] antialiased">
        <div
          className="min-h-screen"
          style={{ background: "linear-gradient(180deg, #4D95FF 0%, #d4e6ff 30%, #FFFFFF 55%)" }}
        >
          <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
