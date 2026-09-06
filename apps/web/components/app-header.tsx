'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldCheck, LogOut, Database, GitBranch, LayoutDashboard, Building2, Users, Sparkles, User } from 'lucide-react';
import { Brand } from './workspace';
import { ProfileDialog } from './profile-dialog';
import type { Session } from '@atlas/contracts';

interface AppHeaderProps {
  session: Session | null;
  onLogout?: () => void;
}

export function AppHeader({ session, onLogout }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    if (session) {
      setUserName(session.name || session.email || '');
    }
  }, [session]);

  async function handleLogout() {
    if (onLogout) {
      onLogout();
      return;
    }
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
      router.replace('/login');
    } catch {
      router.replace('/login');
    }
  }

  const displayName = userName || (session?.email ? session.email.replace(/^(.).*@/, '$1***@') : '');

  return (
    <>
      <header className="header">
        <Brand />
        <nav className="header-context" aria-label="Navegación del espacio de trabajo" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Link
            href="/app"
            className={`button ${pathname === '/app' ? 'primary' : ''}`}
            style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
          >
            <Building2 size={14} />
            <span>Organización</span>
          </Link>
          <Link
            href="/app/datasets"
            className={`button ${pathname.startsWith('/app/datasets') ? 'primary' : ''}`}
            style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
          >
            <Database size={14} />
            <span>Datasets</span>
          </Link>
          <Link
            href="/app/kpis"
            className={`button ${pathname.startsWith('/app/kpis') ? 'primary' : ''}`}
            style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
          >
            <GitBranch size={14} />
            <span>KPIs & Semántica</span>
          </Link>
          <Link
            href="/app/dashboards"
            className={`button ${pathname.startsWith('/app/dashboards') ? 'primary' : ''}`}
            style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
          >
            <LayoutDashboard size={14} />
            <span>Dashboards</span>
          </Link>
          <Link
            href="/app/workforce"
            className={`button ${pathname.startsWith('/app/workforce') ? 'primary' : ''}`}
            style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
          >
            <Users size={14} />
            <span>Workforce</span>
          </Link>
          <Link
            href="/app/chat"
            className={`button ${pathname.startsWith('/app/chat') ? 'primary' : ''}`}
            style={{ height: '32px', fontSize: '13px', padding: '0 10px', gap: '6px' }}
          >
            <Sparkles size={14} />
            <span>Asistente IA</span>
          </Link>
        </nav>
        <div className="header-actions">
          {session && (
            <>
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
