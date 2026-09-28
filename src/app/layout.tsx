import type { Metadata } from "next";
import { connection } from "next/server";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Police auto-hebergee au build par next/font -> servie depuis 'self',
// compatible avec la CSP stricte (font-src 'self') et le fonctionnement hors ligne.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mon espace de stockage",
  description: "Stockage de fichiers personnel",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Rendu dynamique obligatoire : le nonce CSP (pose par le proxy) change a
  // chaque requete et doit etre injecte dans les scripts de Next.js.
  await connection();
  return (
    <html lang="fr" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
