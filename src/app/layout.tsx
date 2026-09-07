import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdaptQuiz",
  description: "Upload notes. Quiz to mastery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
