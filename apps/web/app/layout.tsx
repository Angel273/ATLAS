/**
 * @file layout.tsx
 * @description Diseño raíz (Root Layout) para la aplicación Next.js de ATLAS.
 * Configura los metadatos globales, importa los estilos CSS del sistema de diseño
 * y proporciona accesibilidad mediante el enlace para saltar al contenido principal.
 */

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ATLAS · Inteligencia operacional',
  description: 'Datasets, indicadores y contexto para comprender tu operación.',
  robots: { index: false, follow: false },
};

/**
 * Componente de diseño raíz que envuelve todas las páginas del frontend.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><a className="skip-link" href="#main">Saltar al contenido</a>{children}</body></html>;
}
