/**
 * @file apps/web/app/portal/accounts/page.tsx
 * @description Portal central de Cuentas y Campañas Operacionales de ATLAS.
 * Permite seleccionar una cuenta para entrar a su espacio de trabajo aislado,
 * consultar métricas clave (datasets, KPIs, dashboards, semana activa, roster),
 * y para administradores: crear, editar, archivar, reactivar y gestionar accesos de miembros.
 */

'use client';
import { useEffect, useState, useMemo, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  sessionSchema,
  accountListSchema,
  accountSchema,
  deleteAccountResultSchema,
  memberListSchema,
  accountMembersSchema,
  type Session,
  type Account,
  type Member,
} from '@atlas/contracts';
import {
  Briefcase,
  Building2,
  Calendar,
  Database,
  GitBranch,
  LayoutDashboard,
  Plus,
  Search,
  ShieldCheck,
  Users,
  ArrowRight,
  Archive,
  RotateCcw,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  UserCheck,
  Sparkles,
  SlidersHorizontal,
  Copy,
  Check,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Brand } from '../../../components/workspace';
import { ProfileDialog } from '../../../components/profile-dialog';
import { MembersPanel } from '../../../components/members-panel';
import { api } from '../../../lib/api';

export default function AccountPortalPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Filtering & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('active');

  // Modals
  const [profileOpen, setProfileOpen] = useState(false);
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [memberAssignAccount, setMemberAssignAccount] = useState<Account | null>(null);

  // Member assignment state
  const [orgMembers, setOrgMembers] = useState<Member[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form states
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // Load Session & Accounts
  async function loadData() {
    try {
      setLoading(true);
      setError('');
      const [sessionRes, accountsRes] = await Promise.allSettled([
        api('/auth/session', sessionSchema),
        api('/accounts?includeArchived=true', accountListSchema),
      ]);
      if (sessionRes.status === 'fulfilled') {
        setSession(sessionRes.value);
      }
      if (accountsRes.status === 'fulfilled') {
        setAccounts(accountsRes.value.items);
      } else {
        setError(accountsRes.reason instanceof Error ? accountsRes.reason.message : 'Error al cargar cuentas operativas.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al conectar con ATLAS.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const isAdmin = session?.role === 'admin' || session?.capabilities.includes('tenant.manage');
  const canManageUsers = session?.capabilities.includes('user.manage');

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      const matchesSearch = acc.name.toLowerCase().includes(search.toLowerCase()) ||
        acc.timezone.toLowerCase().includes(search.toLowerCase());
      const isArchived = Boolean(acc.archivedAt);
      if (statusFilter === 'active' && isArchived) return false;
      if (statusFilter === 'archived' && !isArchived) return false;
      return matchesSearch;
    });
  }, [accounts, search, statusFilter]);

  // Enter Account Workspace
  async function handleEnterAccount(accountId: string) {
    try {
      setSwitchingId(accountId);
      setError('');
      await api('/auth/switch-account', sessionSchema, {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      });
      router.push(`/app/accounts/${accountId}/datasets`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ingresar a la cuenta.');
      setSwitchingId(null);
    }
  }

  // Create Account
  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const timezone = String(form.get('timezone') ?? 'America/Guatemala');

    try {
      const created = await api('/accounts', accountSchema, {
        method: 'POST',
        body: JSON.stringify({ name, timezone }),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setAccounts(prev => [...prev.filter(a => a.id !== created.id), created]);
      setCreateModalOpen(false);
      setNotice(`Cuenta "${created.name}" creada exitosamente.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear la cuenta.');
    } finally {
      setSaving(false);
    }
  }

  // Update Account
  async function handleUpdateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingAccount) return;
    setSaving(true);
    setFormError('');
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const timezone = String(form.get('timezone') ?? 'America/Guatemala');

    try {
      const updated = await api(`/accounts/${editingAccount.id}`, accountSchema, {
        method: 'PATCH',
        body: JSON.stringify({ name, timezone }),
      });
      setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a));
      setEditingAccount(null);
      setNotice(`Cuenta "${updated.name}" actualizada.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al actualizar la cuenta.');
    } finally {
      setSaving(false);
    }
  }

  // Archive / Delete Account
  async function handleArchiveOrDelete() {
    if (!deletingAccount) return;
    setSaving(true);
    setFormError('');
    try {
      const res = await api(`/accounts/${deletingAccount.id}`, deleteAccountResultSchema, {
        method: 'DELETE',
      });
      if (res.deleted) {
        setAccounts(prev => prev.filter(a => a.id !== deletingAccount.id));
        setNotice(`Cuenta "${deletingAccount.name}" eliminada permanentemente.`);
      } else {
        setAccounts(prev => prev.map(a => a.id === deletingAccount.id ? { ...a, archivedAt: new Date().toISOString() } : a));
        setNotice(`Cuenta "${deletingAccount.name}" archivada.`);
      }
      setDeletingAccount(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al procesar la cuenta.');
    } finally {
      setSaving(false);
    }
  }

  // Unarchive Account
  async function handleUnarchive(account: Account) {
    try {
      setSaving(true);
      const res = await api(`/accounts/${account.id}/unarchive`, accountSchema, {
        method: 'POST',
      });
      setAccounts(prev => prev.map(a => a.id === res.id ? res : a));
      setNotice(`Cuenta "${res.name}" reactivada con éxito.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al reactivar la cuenta.');
    } finally {
      setSaving(false);
    }
  }

  // Open Member Assignment Dialog
  async function handleOpenMemberAssign(account: Account) {
    setMemberAssignAccount(account);
    setMemberError('');
    setLoadingMembers(true);
    try {
      const [membersRes, accountMembersRes] = await Promise.all([
        api('/users', memberListSchema),
        api(`/accounts/${account.id}/members`, accountMembersSchema),
      ]);
      setOrgMembers(membersRes.items);
      setSelectedMemberIds(accountMembersRes.membershipIds);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Error al cargar miembros de la organización.');
    } finally {
      setLoadingMembers(false);
    }
  }

  // Save Member Assignment
  async function handleSaveMemberAssign() {
    if (!memberAssignAccount) return;
    setSavingMembers(true);
    setMemberError('');
    try {
      await fetch(`/api/v1/accounts/${memberAssignAccount.id}/members`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIds: selectedMemberIds }),
      });
      setAccounts(prev =>
        prev.map(a => (a.id === memberAssignAccount.id ? { ...a, memberCount: selectedMemberIds.length } : a))
      );
      setNotice(`Accesos actualizados exitosamente para "${memberAssignAccount.name}".`);
      setMemberAssignAccount(null);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Error al guardar asignaciones de miembros.');
    } finally {
      setSavingMembers(false);
    }
  }

  // Copy Account ID
  async function handleCopyAccountId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignorar fallback
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      router.replace('/login');
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
      {/* Top Header */}
      <header className="header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Brand />
          <div className="header-context">
            <span className="eyebrow secondary">Portal de Operaciones</span>
            <span className="badge positive" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Building2 size={12} />
              {session?.organization ?? 'Organización'}
            </span>
          </div>
        </div>

        <div className="header-actions">
          {session && (
            <>
              {canManageUsers && (
                <button
                  className="button"
                  onClick={() => setMembersModalOpen(true)}
                  style={{ height: '32px', fontSize: '12px', padding: '0 10px', gap: '6px' }}
                >
                  <Users size={14} />
                  <span>Usuarios</span>
                </button>
              )}

              <button
                className="button"
                onClick={() => setProfileOpen(true)}
                style={{ height: '32px', fontSize: '12px', padding: '0 10px', gap: '6px' }}
              >
                <ShieldCheck size={13} style={{ color: 'var(--accent)' }} />
                <span>{session.name || session.email}</span>
              </button>

              <button
                className="button"
                onClick={() => { void handleLogout(); }}
                style={{ height: '32px', fontSize: '12px', padding: '0 10px', gap: '6px' }}
              >
                Salir
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="workspace" id="main" style={{ paddingTop: '32px', paddingBottom: '60px' }}>
        {/* Banner / Title Row */}
        <div className="title-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <Briefcase size={14} />
              <span>Multi-Tenant Operacional</span>
            </div>
            <h1 style={{ margin: '0 0 8px' }}>Portal de Cuentas</h1>
            <p className="secondary" style={{ maxWidth: '640px', fontSize: '15px' }}>
              Selecciona una cuenta operativa o campaña para acceder a sus datasets, modelos de KPIs, dashboards y roster semanal.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px' }}>
            {isAdmin && (
              <button
                className="button primary"
                onClick={() => { setFormError(''); setCreateModalOpen(true); }}
                style={{ height: '38px', padding: '0 16px', gap: '8px' }}
              >
                <Plus size={16} />
                <span>Nueva Cuenta</span>
              </button>
            )}
          </div>
        </div>

        {/* Notices and Alerts */}
        {error && (
          <div role="alert" className="form-error" style={{ margin: '16px 0' }}>
            <p>{error}</p>
          </div>
        )}

        {notice && (
          <div
            role="status"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--positive)',
              borderRadius: '4px',
              padding: '10px 16px',
              margin: '16px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--positive)',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            margin: '24px 0 20px',
            padding: '12px 16px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 280px', maxWidth: '450px' }}>
            <Search size={16} style={{ color: 'var(--secondary)' }} />
            <input
              type="text"
              placeholder="Buscar por nombre o zona horaria..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: '13px',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                style={{
                  border: 'none',
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: statusFilter === 'active' ? 'var(--accent)' : 'transparent',
                  color: statusFilter === 'active' ? 'var(--on-accent)' : 'var(--ink)',
                  fontWeight: statusFilter === 'active' ? 600 : 400,
                }}
              >
                Activas ({accounts.filter(a => !a.archivedAt).length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('archived')}
                style={{
                  border: 'none',
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: statusFilter === 'archived' ? 'var(--accent)' : 'transparent',
                  color: statusFilter === 'archived' ? 'var(--on-accent)' : 'var(--ink)',
                  fontWeight: statusFilter === 'archived' ? 600 : 400,
                }}
              >
                Archivadas ({accounts.filter(a => Boolean(a.archivedAt)).length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                style={{
                  border: 'none',
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: statusFilter === 'all' ? 'var(--accent)' : 'transparent',
                  color: statusFilter === 'all' ? 'var(--on-accent)' : 'var(--ink)',
                  fontWeight: statusFilter === 'all' ? 600 : 400,
                }}
              >
                Todas ({accounts.length})
              </button>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <p className="secondary">Cargando cuentas operativas de tu organización…</p>
          </div>
        )}

        {/* Account Cards Grid */}
        {!loading && (
          <>
            {filteredAccounts.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '60px 20px',
                  background: 'var(--surface)',
                  border: '1px dashed var(--border-strong)',
                  borderRadius: '6px',
                }}
              >
                <Briefcase size={36} style={{ color: 'var(--secondary)', opacity: 0.5, margin: '0 auto 12px' }} />
                <h3 style={{ margin: '0 0 6px', fontSize: '18px' }}>
                  {search ? 'No se encontraron cuentas con ese criterio' : 'No hay cuentas operacionales registradas'}
                </h3>
                <p className="secondary" style={{ maxWidth: '400px', margin: '0 auto 16px', fontSize: '13px' }}>
                  {isAdmin
                    ? 'Crea tu primera cuenta o campaña operativa para comenzar a estructurar datasets y rosters.'
                    : 'Ponte en contacto con un administrador para que asigne tu usuario a una cuenta.'}
                </p>
                {isAdmin && !search && (
                  <button
                    className="button primary"
                    onClick={() => { setFormError(''); setCreateModalOpen(true); }}
                  >
                    <Plus size={15} />
                    <span>Crear cuenta inicial</span>
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
                  gap: '20px',
                }}
              >
                {filteredAccounts.map(acc => {
                  const isArchived = Boolean(acc.archivedAt);
                  const isEntering = switchingId === acc.id;

                  return (
                    <div
                      key={acc.id}
                      className="panel"
                      style={{
                        padding: '22px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        borderRadius: '4px',
                        border: isArchived ? '1px dashed var(--border-strong)' : '1px solid var(--border)',
                        background: isArchived ? 'var(--surface-muted)' : 'var(--surface)',
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                      }}
                    >
                      {/* Card Top: Title, Status, Timezone */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                          <div>
                            <span
                              style={{
                                fontSize: '10px',
                                fontFamily: 'ui-monospace, monospace',
                                color: 'var(--secondary)',
                                letterSpacing: '0.05em',
                              }}
                            >
                              CUENTA OPERACIONAL
                            </span>
                            <h2 style={{ fontSize: '20px', margin: '2px 0 6px', wordBreak: 'break-word' }}>
                              {acc.name}
                            </h2>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                            <span
                              className={`badge ${isArchived ? 'warning' : 'positive'}`}
                              style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                borderColor: isArchived ? 'var(--warning)' : 'var(--accent)',
                                color: isArchived ? 'var(--warning)' : 'var(--accent)',
                              }}
                            >
                              {isArchived ? 'Archivada' : 'Activa'}
                            </span>
                          </div>
                        </div>

                        {/* Details meta */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px', fontSize: '12px', color: 'var(--secondary)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} />
                            {acc.timezone}
                          </span>
                          <span>•</span>
                          <button
                            type="button"
                            onClick={() => { void handleCopyAccountId(acc.id); }}
                            className="text-button"
                            style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            title="Haz clic para copiar el UUID de la cuenta"
                          >
                            <span>ID: {acc.id.slice(0, 8)}</span>
                            {copiedId === acc.id ? <Check size={11} style={{ color: 'var(--positive)' }} /> : <Copy size={11} />}
                          </button>
                        </div>

                        {/* Operational Status Chips */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '8px',
                            margin: '16px 0',
                            padding: '10px',
                            background: 'var(--canvas)',
                            borderRadius: '3px',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                              Semana Operativa
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                              <Calendar size={13} style={{ color: 'var(--accent)' }} />
                              <span>{acc.activeWeekCode || 'Sin fijar'}</span>
                            </div>
                          </div>

                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                              Estado Roster
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                              <Users size={13} style={{ color: 'var(--accent)' }} />
                              <span>
                                {acc.rosterStatus === 'published'
                                  ? 'Publicado'
                                  : acc.rosterStatus === 'ready'
                                  ? 'Listo'
                                  : acc.rosterStatus === 'uploaded'
                                  ? 'Borrador'
                                  : 'Sin Roster'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Metrics summary */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: '6px',
                            borderTop: '1px solid var(--border)',
                            paddingTop: '12px',
                            marginTop: '12px',
                            fontSize: '11px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="Datasets">
                            <Database size={12} style={{ color: 'var(--secondary)' }} />
                            <span><strong>{acc.datasetCount ?? 0}</strong> Datasets</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="KPIs definidos">
                            <GitBranch size={12} style={{ color: 'var(--secondary)' }} />
                            <span><strong>{acc.kpiCount ?? 0}</strong> KPIs</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="Dashboards">
                            <LayoutDashboard size={12} style={{ color: 'var(--secondary)' }} />
                            <span><strong>{acc.dashboardCount ?? 0}</strong> Vistas</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="Miembros asignados">
                            <Users size={12} style={{ color: 'var(--secondary)' }} />
                            <span><strong>{acc.memberCount ?? 0}</strong> Miembros</span>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom: Primary action & admin controls */}
                      <div style={{ marginTop: '20px' }}>
                        {!isArchived ? (
                          <button
                            type="button"
                            className="button primary"
                            onClick={() => { void handleEnterAccount(acc.id); }}
                            disabled={isEntering}
                            style={{
                              width: '100%',
                              height: '38px',
                              fontWeight: 600,
                              fontSize: '13px',
                              justifyContent: 'center',
                            }}
                          >
                            <span>{isEntering ? 'Entrando…' : 'Entrar a la cuenta'}</span>
                            <ArrowRight size={15} />
                          </button>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {isAdmin && (
                              <button
                                type="button"
                                className="button"
                                onClick={() => { void handleUnarchive(acc); }}
                                disabled={saving}
                                style={{
                                  width: '100%',
                                  height: '36px',
                                  fontSize: '12px',
                                  borderColor: 'var(--accent)',
                                  color: 'var(--accent)',
                                  justifyContent: 'center',
                                }}
                              >
                                <RotateCcw size={13} />
                                <span>Reactivar cuenta</span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Admin secondary actions */}
                        {isAdmin && (
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              gap: '6px',
                              marginTop: '10px',
                              paddingTop: '8px',
                              borderTop: '1px solid var(--border)',
                            }}
                          >
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                setEditingAccount(acc);
                                setFormError('');
                              }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                            >
                              <Pencil size={11} />
                              <span>Editar</span>
                            </button>

                            <span style={{ color: 'var(--border-strong)' }}>|</span>

                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                void handleOpenMemberAssign(acc);
                              }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
                              title="Gestionar qué miembros pueden operar esta cuenta"
                            >
                              <UserCheck size={11} />
                              <span>Accesos</span>
                            </button>

                            <span style={{ color: 'var(--border-strong)' }}>|</span>

                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                setDeletingAccount(acc);
                                setFormError('');
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '11px',
                                color: isArchived ? 'var(--negative)' : 'var(--secondary)',
                              }}
                            >
                              {isArchived ? (
                                <>
                                  <Trash2 size={11} />
                                  <span>Eliminar</span>
                                </>
                              ) : (
                                <>
                                  <Archive size={11} />
                                  <span>Archivar</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {/* Dialog: Crear Cuenta */}
      <Dialog.Root open={createModalOpen} onOpenChange={open => { if (!saving) setCreateModalOpen(open); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '460px' }}>
            <Dialog.Title className="dialog-title">Nueva Cuenta / Campaña</Dialog.Title>
            <Dialog.Description className="secondary">
              Crea un espacio de trabajo aislado para una línea de negocio, cliente o campaña de call center.
            </Dialog.Description>
            <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar" disabled={saving}>
              <X />
            </Dialog.Close>

            <form onSubmit={event => { void handleCreateAccount(event); }} style={{ marginTop: '18px' }} aria-busy={saving}>
              <div className="field" style={{ marginBottom: '14px' }}>
                <label htmlFor="create-account-name" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Nombre de la Cuenta u Operación
                </label>
                <input
                  id="create-account-name"
                  name="name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Ej: Claro Móvil, Soporte Latam, Ventas Inbound"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)' }}
                  autoComplete="off"
                />
              </div>

              <div className="field" style={{ marginBottom: '18px' }}>
                <label htmlFor="create-account-tz" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Zona Horaria Operativa
                </label>
                <select
                  id="create-account-tz"
                  name="timezone"
                  defaultValue="America/Guatemala"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                >
                  <option value="America/Guatemala">Guatemala (UTC-6)</option>
                  <option value="America/Mexico_City">Ciudad de México (UTC-6)</option>
                  <option value="America/Bogota">Bogotá / Lima (UTC-5)</option>
                  <option value="America/New_York">Nueva York / Miami (UTC-5/UTC-4)</option>
                  <option value="UTC">Tiempo Universal Coordinado (UTC)</option>
                </select>
              </div>

              {formError && <p className="form-error" role="alert" style={{ marginBottom: '14px' }}>{formError}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={saving}
                >
                  {saving ? 'Guardando…' : 'Crear Cuenta'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dialog: Editar Cuenta */}
      <Dialog.Root open={editingAccount !== null} onOpenChange={open => { if (!open && !saving) setEditingAccount(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '460px' }}>
            <Dialog.Title className="dialog-title">Editar Cuenta</Dialog.Title>
            <Dialog.Description className="secondary">
              Modifica la denominación o la zona horaria de la cuenta operacional.
            </Dialog.Description>
            <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar" disabled={saving}>
              <X />
            </Dialog.Close>

            {editingAccount && (
              <form onSubmit={event => { void handleUpdateAccount(event); }} style={{ marginTop: '18px' }} aria-busy={saving}>
                <div className="field" style={{ marginBottom: '14px' }}>
                  <label htmlFor="edit-account-name" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Nombre de la Cuenta
                  </label>
                  <input
                    id="edit-account-name"
                    name="name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={editingAccount.name}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)' }}
                    autoComplete="off"
                  />
                </div>

                <div className="field" style={{ marginBottom: '18px' }}>
                  <label htmlFor="edit-account-tz" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Zona Horaria Operativa
                  </label>
                  <select
                    id="edit-account-tz"
                    name="timezone"
                    defaultValue={editingAccount.timezone}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                  >
                    <option value="America/Guatemala">Guatemala (UTC-6)</option>
                    <option value="America/Mexico_City">Ciudad de México (UTC-6)</option>
                    <option value="America/Bogota">Bogotá / Lima (UTC-5)</option>
                    <option value="America/New_York">Nueva York / Miami (UTC-5/UTC-4)</option>
                    <option value="UTC">Tiempo Universal Coordinado (UTC)</option>
                  </select>
                </div>

                {formError && <p className="form-error" role="alert" style={{ marginBottom: '14px' }}>{formError}</p>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setEditingAccount(null)}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={saving}
                  >
                    {saving ? 'Guardando…' : 'Guardar Cambios'}
                  </button>
                </div>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dialog: Archivar / Eliminar Cuenta */}
      <Dialog.Root open={deletingAccount !== null} onOpenChange={open => { if (!open && !saving) setDeletingAccount(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '480px', padding: '26px' }}>
            <Dialog.Title className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--negative)' }}>
              <AlertTriangle size={22} />
              <span>{deletingAccount?.archivedAt ? 'Eliminar cuenta definitivamente' : 'Archivar cuenta operativa'}</span>
            </Dialog.Title>

            <Dialog.Description className="secondary" style={{ margin: '14px 0 18px', fontSize: '13px', lineHeight: 1.6 }}>
              {deletingAccount?.archivedAt ? (
                <>
                  ¿Confirmas la eliminación física definitiva de la cuenta <strong>{deletingAccount.name}</strong>?
                  Esta operación solo es posible si la cuenta no posee datos operacionales publicados ni referencias en dashboards.
                </>
              ) : (
                <>
                  ¿Deseas archivar la cuenta <strong>{deletingAccount?.name}</strong>?
                  Los datos históricos y datasets se conservarán de forma inmutable, pero la cuenta no aparecerá activa en el portal.
                </>
              )}
            </Dialog.Description>

            {formError && <p className="form-error" role="alert" style={{ marginBottom: '14px' }}>{formError}</p>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="button"
                onClick={() => setDeletingAccount(null)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="button"
                style={{
                  background: 'var(--negative)',
                  color: '#fff',
                  borderColor: 'var(--negative)',
                }}
                disabled={saving}
                onClick={() => { void handleArchiveOrDelete(); }}
              >
                {saving ? 'Procesando…' : deletingAccount?.archivedAt ? 'Confirmar Eliminación' : 'Confirmar Archivo'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dialog: Gestión de Miembros y Permisos de la Organización */}
      <Dialog.Root open={membersModalOpen} onOpenChange={setMembersModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            style={{
              maxWidth: '920px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px 30px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <Dialog.Title className="dialog-title" style={{ margin: 0, fontSize: '24px' }}>
                  Usuarios y Membresías de la Organización
                </Dialog.Title>
                <Dialog.Description className="secondary" style={{ fontSize: '13px', marginTop: '4px' }}>
                  Administra las invitaciones, roles de usuario y permisos de acceso para las cuentas de tu organización.
                </Dialog.Description>
              </div>
              <Dialog.Close className="icon-button" aria-label="Cerrar">
                <X />
              </Dialog.Close>
            </div>

            {session && <MembersPanel currentUserId={session.userId} />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dialog: Asignar Miembros a la Cuenta */}
      <Dialog.Root open={memberAssignAccount !== null} onOpenChange={open => { if (!open && !savingMembers) setMemberAssignAccount(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '520px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <Dialog.Title className="dialog-title" style={{ fontSize: '18px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <UserCheck size={18} style={{ color: 'var(--accent)' }} />
                  <span>Accesos a {memberAssignAccount?.name}</span>
                </Dialog.Title>
                <Dialog.Description className="secondary" style={{ fontSize: '12px', marginTop: '4px' }}>
                  Selecciona los supervisores, analistas o managers de la organización que tendrán acceso a los datos y vistas de esta cuenta.
                </Dialog.Description>
              </div>
              <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar" disabled={savingMembers}>
                <X />
              </Dialog.Close>
            </div>

            <div
              style={{
                background: 'var(--surface-muted)',
                padding: '10px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                color: 'var(--secondary)',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <ShieldCheck size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>
                Los administradores de la organización tienen acceso global automático a todas las cuentas operacionales.
              </span>
            </div>

            {loadingMembers ? (
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <p className="secondary">Cargando directorio de miembros…</p>
              </div>
            ) : (
              <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px 12px' }}>
                {orgMembers.filter(m => m.role !== 'admin').length === 0 ? (
                  <p className="secondary" style={{ fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>
                    No hay miembros operativos adicionales en la organización. Invita supervisores o agentes desde el panel de Usuarios.
                  </p>
                ) : (
                  orgMembers
                    .filter(m => m.role !== 'admin')
                    .map(m => {
                      const isSelected = selectedMemberIds.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 6px',
                            borderBottom: '1px solid var(--border-subtle)',
                            cursor: 'pointer',
                            fontSize: '13px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedMemberIds(prev => [...prev, m.id]);
                                } else {
                                  setSelectedMemberIds(prev => prev.filter(id => id !== m.id));
                                }
                              }}
                            />
                            <div>
                              <div style={{ fontWeight: 500 }}>{m.name || m.email}</div>
                              <div style={{ fontSize: '11px', color: 'var(--secondary)' }}>{m.email}</div>
                            </div>
                          </div>
                          <span className="badge" style={{ fontSize: '10px', textTransform: 'capitalize' }}>
                            {m.role}
                          </span>
                        </label>
                      );
                    })
                )}
              </div>
            )}

            {memberError && <p className="form-error" role="alert" style={{ marginTop: '12px' }}>{memberError}</p>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button
                type="button"
                className="button"
                onClick={() => setMemberAssignAccount(null)}
                disabled={savingMembers}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => { void handleSaveMemberAssign(); }}
                disabled={savingMembers || loadingMembers}
              >
                {savingMembers ? 'Guardando…' : 'Guardar Accesos'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Profile Dialog */}
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        session={session}
        onProfileUpdated={updated => {
          setSession(prev => prev ? { ...prev, name: updated.name || prev.name, email: updated.email || prev.email } : prev);
        }}
      />
    </div>
  );
}
