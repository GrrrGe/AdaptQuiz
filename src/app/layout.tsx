import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdaptQuiz",
  description: "Adaptive quizzer grounded in your lecture notes (RAG).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
