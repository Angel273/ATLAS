/**
 * @file page.tsx
 * @description Panel principal de administración de la organización en ATLAS.
 * Permite gestionar cuentas y campañas (crear, editar zona horaria, eliminar con borrado seguro),
 * administrar membresías de usuarios y cerrar sesiones individuales o globales.
 */

'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  sessionSchema, accountListSchema, accountSchema,
  deleteAccountResultSchema, type Session,
} from '@atlas/contracts';
import { ShieldCheck, Database, Plus, X, Pencil, Trash2, AlertTriangle, Check } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { AppHeader } from '../../components/app-header';
import { api } from '../../lib/api';
import { MembersPanel } from '../../components/members-panel';

type AccountItem = { id: string; name: string; timezone: string };

/**
 * Componente de página para la administración global de la organización y sus cuentas operativas.
 */
export default function OrganizationPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  // Create Account State
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const requestKey = useRef<{ body: string; key: string } | null>(null);

  // Edit Account State
  const [editingAccount, setEditingAccount] = useState<AccountItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editTimezone, setEditTimezone] = useState('America/Guatemala');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Delete Account State
  const [deletingAccount, setDeletingAccount] = useState<AccountItem | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const session = await api('/auth/session', sessionSchema);
        const data = await api('/accounts', accountListSchema);
        if (!cancelled) { setSession(session); setAccounts(data.items); }
      } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : 'No se pudo cargar la organización.'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load(); return () => { cancelled = true; };
  }, []);

  /** Cierra la sesión activa o revoca todas las sesiones del usuario. */
  async function logout(all = false) {
    try {
      const response = await fetch(`/api/v1/auth/${all ? 'revoke-all' : 'logout'}`, { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('No se pudo cerrar la sesión. Inténtalo de nuevo.');
      router.replace('/login');
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo cerrar la sesión.'); }
  }

  /** Crea una nueva cuenta o campaña operativa en la organización con clave de idempotencia. */
  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setCreateError('');
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ name: form.get('name'), timezone: form.get('timezone') });
    if (!requestKey.current || requestKey.current.body !== body) requestKey.current = { body, key: crypto.randomUUID() };
    try {
      const account = await api('/accounts', accountSchema, { method: 'POST', body, headers: { 'Idempotency-Key': requestKey.current.key } });
      setAccounts(previous => [...previous.filter(item => item.id !== account.id), account].sort((a, b) => a.name.localeCompare(b.name)));
      setCreating(false);
      setNotice('Cuenta creada en tu organización.');
      requestKey.current = null;
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'No se pudo crear la cuenta.');
    } finally {
      setSaving(false);
    }
  }

  /** Abre el diálogo modal de edición para la cuenta seleccionada. */
  function handleOpenEdit(account: AccountItem) {
    setEditingAccount(account);
    setEditName(account.name);
    setEditTimezone(account.timezone);
    setEditError('');
  }

  /** Guarda los cambios de nombre y zona horaria de la cuenta editada. */
  async function handleUpdateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingAccount) return;
    setEditSaving(true);
    setEditError('');

    try {
      const updated = await api(`/accounts/${editingAccount.id}`, accountSchema, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim(), timezone: editTimezone }),
      });
      setAccounts(previous => previous.map(item => item.id === updated.id ? updated : item).sort((a, b) => a.name.localeCompare(b.name)));
      setNotice(`Cuenta "${updated.name}" actualizada correctamente.`);
      setEditingAccount(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'No se pudo actualizar la cuenta.');
    } finally {
      setEditSaving(false);
    }
  }

  /** Ejecuta la eliminación de una cuenta tras la confirmación de seguridad. */
  async function handleDeleteAccount() {
    if (!deletingAccount) return;
    setDeleteSaving(true);
    setDeleteError('');

    try {
      await api(`/accounts/${deletingAccount.id}`, deleteAccountResultSchema, {
        method: 'DELETE',
      });
      setAccounts(previous => previous.filter(item => item.id !== deletingAccount.id));
      setNotice(`Cuenta "${deletingAccount.name}" eliminada de la organización.`);
      setDeletingAccount(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'No se pudo eliminar la cuenta.');
    } finally {
      setDeleteSaving(false);
    }
  }

  return (
    <>
      <AppHeader session={session} onLogout={() => void logout()} />
      <main className="workspace" id="main">
        <div className="breadcrumb">Espacio de trabajo / Organización</div>
        <div className="title-row">
          <div>
            <span className="eyebrow secondary">Tu operación</span>
            <h1>{session?.organization ?? 'Conectando con ATLAS'}</h1>
            <p>{loading ? 'Verificando tu sesión…' : 'Sesión verificada y contexto de organización activo.'}</p>
          </div>
          {session && (
            <span className="badge positive">
              <ShieldCheck size={12} />
              {session.role === 'admin' ? 'Administrador · MFA verificado' : 'Sesión verificada'}
            </span>
          )}
        </div>

        {error && (
          <div role="alert" className="form-error">
            <p>{error}</p>
            <a className="button" href="/login">Volver a iniciar sesión</a>
          </div>
        )}
        {loading && <p role="status">Cargando organización y cuentas…</p>}
        {notice && (
          <p
            role="status"
            style={{
              color: 'var(--positive)',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              margin: '12px 0',
            }}
          >
            <Check size={16} />
            {notice}
          </p>
        )}

        {session?.capabilities.includes('user.manage') && <MembersPanel currentUserId={session.userId} />}

        {session && (
          <>
            <section className="panel table-panel" style={{ marginTop: 24 }}>
              <div className="panel-header">
                <div>
                  <h2>Cuentas de la organización</h2>
                  <p>Campañas y operaciones disponibles en tu contexto.</p>
                </div>
                {session.capabilities.includes('tenant.manage') ? (
                  <button className="button primary" onClick={() => { setCreateError(''); setCreating(true); }}>
                    <Plus size={15} />
                    Crear cuenta
                  </button>
                ) : (
                  <Database size={20} />
                )}
              </div>

              {accounts.length > 0 ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Cuenta</th>
                        <th>Zona horaria</th>
                        {session.capabilities.includes('tenant.manage') && (
                          <th style={{ textAlign: 'right' }}>Acciones</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map(account => (
                        <tr key={account.id}>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 600 }}>{account.name}</span>
                              <small className="secondary" style={{ fontSize: '10px', fontFamily: 'ui-monospace, monospace' }}>
                                ID: {account.id.slice(0, 8)}
                              </small>
                            </div>
                          </td>
                          <td>{account.timezone}</td>
                          {session.capabilities.includes('tenant.manage') && (
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                                <button
                                  className="button"
                                  style={{ height: '28px', fontSize: '12px', padding: '0 10px', gap: '4px' }}
                                  onClick={() => handleOpenEdit(account)}
                                >
                                  <Pencil size={12} />
                                  <span>Editar</span>
                                </button>
                                <button
                                  className="button"
                                  style={{
                                    height: '28px',
                                    fontSize: '12px',
                                    padding: '0 10px',
                                    gap: '4px',
                                    color: 'var(--negative)',
                                    borderColor: 'var(--border-strong)',
                                  }}
                                  title={`Eliminar cuenta ${account.name}`}
                                  onClick={() => {
                                    setDeleteError('');
                                    setDeletingAccount(account);
                                  }}
                                >
                                  <Trash2 size={12} />
                                  <span>Eliminar</span>
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="performance-body">
                  <p>No hay cuentas registradas todavía.</p>
                </div>
              )}
            </section>

            <footer className="page-footer">
              <span>
                <ShieldCheck />
                Los datos se consultan dentro de tu organización.
              </span>
              <button className="text-button" onClick={() => { void logout(true); }}>
                Cerrar todas mis sesiones
              </button>
            </footer>
          </>
        )}
      </main>

      {/* Dialog: Crear cuenta */}
      <Dialog.Root open={creating} onOpenChange={open => { if (!saving) setCreating(open); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">Crear cuenta</Dialog.Title>
            <Dialog.Description className="secondary">Registra una campaña u operación en tu organización.</Dialog.Description>
            <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar" disabled={saving}>
              <X />
            </Dialog.Close>
            <form onSubmit={event => { void createAccount(event); }} aria-busy={saving}>
              <div className="field">
                <label htmlFor="account-name">Nombre de la cuenta</label>
                <input id="account-name" name="name" required minLength={2} maxLength={120} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="account-timezone">Zona horaria</label>
                <select id="account-timezone" name="timezone" defaultValue="America/Guatemala">
                  <option value="America/Guatemala">Guatemala</option>
                  <option value="America/Mexico_City">Ciudad de México</option>
                  <option value="America/Bogota">Bogotá</option>
                  <option value="America/New_York">Nueva York</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              {createError && <p className="form-error" role="alert">{createError}</p>}
              <button type="submit" className="button primary" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar cuenta'}
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dialog: Editar cuenta */}
      <Dialog.Root open={editingAccount !== null} onOpenChange={open => { if (!open && !editSaving) setEditingAccount(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title className="dialog-title">Editar cuenta</Dialog.Title>
            <Dialog.Description className="secondary">Modifica el nombre o la zona horaria de la cuenta.</Dialog.Description>
            <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar" disabled={editSaving}>
              <X />
            </Dialog.Close>
            <form onSubmit={event => { void handleUpdateAccount(event); }} aria-busy={editSaving}>
              <div className="field">
                <label htmlFor="edit-account-name">Nombre de la cuenta</label>
                <input
                  id="edit-account-name"
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="edit-account-timezone">Zona horaria</label>
                <select
                  id="edit-account-timezone"
                  name="timezone"
                  value={editTimezone}
                  onChange={e => setEditTimezone(e.target.value)}
                >
                  <option value="America/Guatemala">Guatemala</option>
                  <option value="America/Mexico_City">Ciudad de México</option>
                  <option value="America/Bogota">Bogotá</option>
                  <option value="America/New_York">Nueva York</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              {editError && <p className="form-error" role="alert">{editError}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="button" onClick={() => setEditingAccount(null)} disabled={editSaving}>
                  Cancelar
                </button>
                <button type="submit" className="button primary" disabled={editSaving}>
                  {editSaving ? 'Guardando cambios…' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dialog: Eliminar cuenta */}
      <Dialog.Root open={deletingAccount !== null} onOpenChange={open => { if (!open && !deleteSaving) setDeletingAccount(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '480px', padding: '28px' }}>
            <Dialog.Title className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--negative)' }}>
              <AlertTriangle size={22} />
              <span>Eliminar cuenta</span>
            </Dialog.Title>
            <Dialog.Description className="secondary" style={{ margin: '14px 0 20px' }}>
              ¿Estás seguro de que deseas eliminar la cuenta <strong>{deletingAccount?.name}</strong> de tu organización?
              Esta acción eliminará el registro de la cuenta.
            </Dialog.Description>
            {deleteError && <p className="form-error" role="alert" style={{ marginBottom: '14px' }}>{deleteError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="button"
                onClick={() => setDeletingAccount(null)}
                disabled={deleteSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="button"
                style={{ background: 'var(--negative)', color: '#fff', borderColor: 'var(--negative)' }}
                disabled={deleteSaving}
                onClick={() => { void handleDeleteAccount(); }}
              >
                {deleteSaving ? 'Eliminando…' : 'Confirmar eliminación'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
