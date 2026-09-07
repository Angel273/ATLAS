/**
 * @file apps/web/app/app/accounts/[accountId]/layout.tsx
 * @description Layout contenedor para el espacio de trabajo de una cuenta operacional en ATLAS.
 * Asegura la sincronización de la sesión con el accountId de la ruta mediante rotación segura de tokens,
 * e inyecta la cabecera AppHeader adaptada a la cuenta activa.
 */

'use client';
import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { sessionSchema, type Session } from '@atlas/contracts';
import { AppHeader } from '../../../../components/app-header';
import { api } from '../../../../lib/api';

interface AccountLayoutProps {
  params: Promise<{ accountId: string }>;
  children: React.ReactNode;
}

export default function AccountLayout({ params, children }: AccountLayoutProps) {
  const resolvedParams = use(params);
  const accountId = resolvedParams.accountId;
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function syncSession() {
      try {
        setLoading(true);
        setError('');
        let currentSession = await api('/auth/session', sessionSchema);

        // Si la sesión activa en cookie no coincide con el accountId de la URL, sincronizamos
        if (currentSession.accountId !== accountId) {
          currentSession = await api('/auth/switch-account', sessionSchema, {
            method: 'POST',
            body: JSON.stringify({ accountId }),
          });
        }

        if (active) {
          setSession(currentSession);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Acceso denegado a la cuenta.');
          setLoading(false);
          // Redirigir al portal en caso de cuenta no encontrada o acceso denegado
          setTimeout(() => {
            router.replace('/portal/accounts');
          }, 1500);
        }
      }
    }

    void syncSession();

    return () => {
      active = false;
    };
  }, [accountId, router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--canvas)', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p className="secondary" style={{ fontSize: '14px' }}>Sincronizando contexto de la cuenta…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--canvas)', display: 'grid', placeItems: 'center' }}>
        <div className="panel" style={{ padding: '30px', maxWidth: '440px', textAlign: 'center', borderRadius: '4px' }}>
          <h3 style={{ color: 'var(--negative)', marginBottom: '8px' }}>Error de Acceso</h3>
          <p className="secondary" style={{ fontSize: '13px', marginBottom: '16px' }}>{error}</p>
          <p style={{ fontSize: '12px', color: 'var(--secondary)' }}>Redirigiendo al Portal de Cuentas…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
      {children}
    </div>
  );
}
