/**
 * @file apps/web/components/app-header.tsx
 * @description Barra de navegación superior persistente de la plataforma ATLAS (@atlas/web).
 * Muestra la marca, navegación por módulos adaptada a la cuenta activa (/app/accounts/:accountId/...),
 * selector rápido hacia el Portal de Cuentas, información de organización/rol, perfil y cierre de sesión.
 */

'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ShieldCheck,
  LogOut,
  Database,
  GitBranch,
  LayoutDashboard,
  Building2,
  Users,
  Sparkles,
  User,
  Briefcase,
  ChevronRight,
  ArrowLeftRight,
} from 'lucide-react';
import { Brand } from './workspace';
import { ProfileDialog } from './profile-dialog';
import type { Session } from '@atlas/contracts';

interface AppHeaderProps {
  session: Session | null;
  accountId?: string;
  onLogout?: () => void;
}

/**
 * Componente de encabezado de aplicación con navegación por módulos y gestión de sesión.
 */
export function AppHeader({ session, accountId: propAccountId, onLogout }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    if (session) {
      setUserName(session.name || session.email || '');
    }
  }, [session]);

  // Determine active account ID from props, session, or URL path
  const activeAccountId = useMemo(() => {
    if (propAccountId) return propAccountId;
    if (session?.accountId) return session.accountId;
    const match = pathname.match(/\/app\/accounts\/([a-f0-9-]+)/i);
    return match ? match[1] : undefined;
  }, [propAccountId, session?.accountId, pathname]);

  async function handleLogout() {
    if (onLogout) {
      onLogout();
      return;
    }
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      router.replace('/login');
    }
  }

  const displayName = userName || (session?.email ? session.email.replace(/^(.).*@/, '$1***@') : '');

  // Base URL prefix for current account modules
  const basePath = activeAccountId ? `/app/accounts/${activeAccountId}` : '/app';

  return (
    <>
      <header className="header">
        <Brand />
        <nav
          className="header-context"
          aria-label="Navegación del espacio de trabajo"
          style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
        >
          {/* Portal de Cuentas / CRUD */}
          <Link
            href="/portal/accounts"
            className={`button ${pathname.startsWith('/portal') ? 'primary' : ''}`}
            style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
            title="Administrar y seleccionar cuentas operacionales"
          >
            <Building2 size={14} />
            <span>Cuentas</span>
          </Link>

          {activeAccountId && (
            <>
              <Link
                href={`${basePath}/datasets`}
                className={`button ${pathname.includes('/datasets') ? 'primary' : ''}`}
                style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
              >
                <Database size={14} />
                <span>Datasets</span>
              </Link>
              <Link
                href={`${basePath}/kpis`}
                className={`button ${pathname.includes('/kpis') ? 'primary' : ''}`}
                style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
              >
                <GitBranch size={14} />
                <span>KPIs & Semántica</span>
              </Link>
              <Link
                href={`${basePath}/dashboards`}
                className={`button ${pathname.includes('/dashboards') ? 'primary' : ''}`}
                style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
              >
                <LayoutDashboard size={14} />
                <span>Dashboards</span>
              </Link>
              {/* Workforce module temporarily disabled for replanning */}
              <Link
                href={`${basePath}/chat`}
                className={`button ${pathname.includes('/chat') ? 'primary' : ''}`}
                style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
              >
                <Sparkles size={14} />
                <span>Asistente IA</span>
              </Link>
            </>
          )}
        </nav>

        <div className="header-actions">
          {session && (
            <>
              {/* Account badge with quick switch button */}
              {activeAccountId && (
                <Link
                  href="/portal/accounts"
                  className="badge"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                    background: 'var(--surface-muted)',
                    textDecoration: 'none',
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                  title="Haz clic para cambiar de cuenta o volver al portal"
                >
                  <Briefcase size={12} />
                  <span>{session.accountName || 'Cuenta Operativa'}</span>
                  <ArrowLeftRight size={10} style={{ marginLeft: 3, opacity: 0.7 }} />
                </Link>
              )}

              <button
                className="button"
                style={{ height: '32px', fontSize: '12px', padding: '0 10px', gap: '6px', cursor: 'pointer' }}
                onClick={() => setProfileOpen(true)}
                title="Abrir mi perfil y configuración de usuario"
              >
                <User size={13} style={{ color: 'var(--accent)' }} />
                <span>{displayName || 'Mi perfil'}</span>
              </button>

              <span className="badge positive" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <ShieldCheck size={12} />
                {session.organization} · {session.role === 'admin' ? 'Admin' : session.role}
              </span>

              <button className="button" onClick={() => { void handleLogout(); }}>
                <LogOut size={14} />
                <span>Salir</span>
              </button>
            </>
          )}
        </div>
      </header>

      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        session={session}
        onProfileUpdated={updated => {
          setUserName(updated.name || updated.email);
        }}
      />
    </>
  );
}
