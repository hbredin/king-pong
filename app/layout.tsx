import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ping — Tournois de tennis de table',
  description: 'Organisez les tournois hebdomadaires de votre club et suivez le classement Elo, directement dans votre navigateur.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
