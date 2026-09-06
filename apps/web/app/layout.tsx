import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATLAS · Inteligencia operacional',
  description: 'Datasets, indicadores y contexto para comprender tu operación.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><a className="skip-link" href="#main">Saltar al contenido</a>{children}</body></html>;
}
