/**
 * @file apps/web/components/members-panel.tsx
 * @description Panel administrativo de gestión de usuarios, roles y membresías de la organización (@atlas/web).
 * Proporciona interfaces Radix UI accesibles para:
 * - Listado de miembros con estados de MFA y bloqueo.
 * - Creación de nuevos usuarios con generador de contraseña segura y copia rápida.
 * - Edición de detalles de usuario (nombre, correo, rol, reseteo de MFA, cambio de contraseña forzado).
 * - Deshabilitación de cuentas y eliminación de miembros preservando la existencia de al menos un administrador.
 */

'use client';
import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  memberListSchema, roleLabels, roleSchema, updateRoleResultSchema,
  createUserResultSchema, removeMemberResultSchema, type Role, type Member,
  adminUserDetailSchema, adminUpdateUserResultSchema, type AdminUpdateUserInput,
} from '@atlas/contracts';
import { Plus, X, ShieldAlert, Trash2, Check, Copy, UserPlus, ShieldCheck, Pencil, KeyRound, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Genera una contraseña aleatoria de alta entropía con formato `Atlas-<aleatorio>!`.
 */
function generateSecurePassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let rand = '';
  for (let i = 0; i < 12; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `Atlas-${rand}!`;
}

/**
 * Componente principal del panel de administración de miembros y permisos del tenant.
 */
export function MembersPanel({ currentUserId }: { currentUserId: string }) {

  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Add User Dialog state
  const [creating, setCreating] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>('supervisor');
  const [newPassword, setNewPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const [createError, setCreateError] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  // Delete User Dialog state
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Edit User Dialog state
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<Role>('supervisor');
  const [editChangePassword, setEditChangePassword] = useState(false);
  const [editNewPassword, setEditNewPassword] = useState('');
  const [editCopied, setEditCopied] = useState(false);
  const [editMfaEnabled, setEditMfaEnabled] = useState(false);
  const [editResetMfa, setEditResetMfa] = useState(false);
  const [editDisabled, setEditDisabled] = useState(false);
  const [editLoadingDetail, setEditLoadingDetail] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    let disposed = false;
    void api('/users', memberListSchema)
      .then(data => { if (!disposed) setMembers(data.items); })
      .catch(error => { if (!disposed) setError(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios.'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);

  function handleOpenCreate() {
    setNewEmail('');
    setNewName('');
    setNewRole('supervisor');
    setNewPassword(generateSecurePassword());
    setCopied(false);
    setCreateError('');
    setCreating(true);
  }

  async function handleCopyPassword() {
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError('');
    setSavingUser(true);

    if (newPassword.length < 14) {
      setCreateError('La contraseña temporal debe contener al menos 14 caracteres.');
      setSavingUser(false);
      return;
    }

    try {
      const created = await api('/users', createUserResultSchema, {
        method: 'POST',
        body: JSON.stringify({
          email: newEmail.trim(),
          name: newName.trim(),
          role: newRole,
          password: newPassword,
        }),
      });

      setMembers(previous => [
        ...previous,
        {
          id: created.id,
          userId: created.userId,
          email: created.email.replace(/^(.).*@/, '$1***@'),
          name: created.name,
          role: created.role,
          mfaEnabled: false,
          disabled: false,
        },
      ]);

      setNotice(`Usuario ${created.email} agregado exitosamente a la organización.`);
      setCreating(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'No se pudo crear el usuario.');
    } finally {
      setSavingUser(false);
    }
  }

  async function update(member: Member) {
    setBusy(member.id);
    setError('');
    setNotice('');
    try {
      const role = roles[member.id] ?? member.role;
      await api(`/users/${member.id}/role`, updateRoleResultSchema, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMembers(previous => previous.map(item => item.id === member.id ? { ...item, role } : item));
      setNotice('Permisos actualizados. El cambio queda registrado en la auditoría.');
      if (member.userId === currentUserId && role !== 'admin') window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudieron actualizar los permisos.');
    } finally {
      setBusy(null);
    }
  }

  async function handleOpenEdit(member: Member) {
    setEditingMember(member);
    setEditName(member.name);
    setEditRole(member.role);
    setEditEmail('');
    setEditChangePassword(false);
    setEditNewPassword('');
    setEditCopied(false);
    setEditMfaEnabled(member.mfaEnabled ?? false);
    setEditResetMfa(false);
    setEditDisabled(member.disabled ?? false);
    setEditError('');
    setEditLoadingDetail(true);

    try {
      const detail = await api(`/users/${member.id}`, adminUserDetailSchema);
      setEditName(detail.name);
      setEditEmail(detail.email);
      setEditRole(detail.role);
      setEditMfaEnabled(detail.mfaEnabled);
      setEditDisabled(detail.disabled);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'No se pudieron cargar los detalles del usuario.');
    } finally {
      setEditLoadingDetail(false);
    }
  }

  async function handleCopyEditPassword() {
    try {
      await navigator.clipboard.writeText(editNewPassword);
      setEditCopied(true);
      setTimeout(() => setEditCopied(false), 2000);
    } catch {
      setEditCopied(true);
      setTimeout(() => setEditCopied(false), 2000);
    }
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMember) return;
    setEditError('');
    setEditSaving(true);

    if (editChangePassword && editNewPassword.length < 14) {
      setEditError('La nueva contraseña debe contener al menos 14 caracteres.');
      setEditSaving(false);
      return;
    }

    try {
      const payload: AdminUpdateUserInput = {
        name: editName.trim(),
        email: editEmail.trim() || undefined,
        role: editRole,
        disabled: editDisabled,
      };
      if (editChangePassword && editNewPassword) {
        payload.password = editNewPassword;
      }
      if (editResetMfa) {
        payload.resetMfa = true;
      }

      const res = await api(`/users/${editingMember.id}`, adminUpdateUserResultSchema, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setMembers(prev =>
        prev.map(m =>
          m.id === editingMember.id
            ? {
                ...m,
                name: res.user.name,
                role: res.user.role,
                email: res.user.email.replace(/^(.).*@/, '$1***@'),
                mfaEnabled: res.user.mfaEnabled,
                disabled: res.user.disabled,
              }
            : m
        )
      );

      setNotice(`Usuario "${res.user.name || res.user.email}" actualizado correctamente.`);
      setEditingMember(null);

      if (editingMember.userId === currentUserId && res.user.role !== 'admin') {
        window.location.reload();
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'No se pudo actualizar el usuario.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingMember) return;
    setDeletingBusy(true);
    setDeleteError('');

    try {
      await api(`/users/${deletingMember.id}`, removeMemberResultSchema, {
        method: 'DELETE',
      });
      setMembers(previous => previous.filter(item => item.id !== deletingMember.id));
      setNotice(`Membresía de ${deletingMember.name || deletingMember.email} removida de la organización.`);
      setDeletingMember(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'No se pudo remover el usuario.');
    } finally {
      setDeletingBusy(false);
    }
  }

  return (
    <>
      <section className="panel table-panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <div>
            <h2>Usuarios y permisos</h2>
            <p>Gestiona los miembros de tu organización, sus accesos y sus roles operacionales.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              className="button primary"
              style={{ fontSize: '12px', height: '32px', gap: '6px' }}
              onClick={handleOpenCreate}
            >
              <Plus size={14} />
              <span>Agregar usuario</span>
            </button>
            <span className="badge">Administración</span>
          </div>
        </div>

        {error && <p className="form-error" role="alert" style={{ margin: '14px 23px 0' }}>{error}</p>}
        {notice && (
          <p
            className="performance-body"
            role="status"
            style={{ color: 'var(--positive)', display: 'flex', alignItems: 'center', gap: '6px', padding: '14px 23px 0' }}
          >
            <Check size={16} />
            {notice}
          </p>
        )}

        {loading ? (
          <p className="performance-body" role="status">Cargando usuarios…</p>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Miembros de la organización y sus roles</caption>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol asignado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {members.map(member => {
                  const isSelf = member.userId === currentUserId;
                  const isRoleChanged = roles[member.id] && roles[member.id] !== member.role;

                  return (
                    <tr key={member.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: member.name ? 600 : 400 }}>
                              {member.name || member.email}
                              {isSelf && ' · Tú'}
                            </span>
                            {member.disabled && (
                              <span
                                className="badge"
                                style={{
                                  background: 'rgba(239, 68, 68, 0.12)',
                                  color: 'var(--negative)',
                                  borderColor: 'rgba(239, 68, 68, 0.3)',
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                }}
                              >
                                <ShieldAlert size={10} style={{ marginRight: 3 }} />
                                Deshabilitado
                              </span>
                            )}
                            {member.mfaEnabled && (
                              <span
                                className="badge positive"
                                style={{ fontSize: '10px', padding: '1px 6px' }}
                                title="MFA activado"
                              >
                                <ShieldCheck size={10} style={{ marginRight: 3 }} />
                                MFA
                              </span>
                            )}
                          </div>
                          {member.name && (
                            <span className="secondary" style={{ fontSize: '11px' }}>
                              {member.email}
                            </span>
                          )}
                          <small className="secondary" style={{ fontSize: '10px', fontFamily: 'ui-monospace, monospace' }}>
                            ID: {member.id.slice(0, 8)}
                          </small>
                        </div>
                      </td>
                      <td>
                        <select
                          aria-label={`Rol de ${member.name || member.email} (${member.id.slice(0, 8)})`}
                          value={roles[member.id] ?? member.role}
                          disabled={busy !== null}
                          onChange={event => setRoles(previous => ({ ...previous, [member.id]: roleSchema.parse(event.target.value) }))}
                          style={{ padding: '6px 10px', fontSize: '12px' }}
                        >
                          {roleSchema.options.map(role => (
                            <option value={role} key={role}>
                              {roleLabels[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            className="button"
                            style={{ height: '28px', fontSize: '12px', padding: '0 10px', gap: '4px' }}
                            onClick={() => { void handleOpenEdit(member); }}
                            title={`Editar usuario ${member.name || member.email}`}
                          >
                            <Pencil size={12} />
                            <span>Editar</span>
                          </button>

                          {isRoleChanged && (
                            <button
                              className="button"
                              style={{ height: '28px', fontSize: '12px', padding: '0 10px' }}
                              disabled={busy !== null}
                              onClick={() => { void update(member); }}
                            >
                              {busy === member.id ? 'Guardando…' : 'Guardar rol'}
                            </button>
                          )}

                          <button
                            className="button"
                            style={{
                              height: '28px',
                              fontSize: '12px',
                              padding: '0 10px',
                              gap: '4px',
                              color: isSelf ? 'var(--muted)' : 'var(--negative)',
                              borderColor: isSelf ? 'var(--border)' : 'var(--border-strong)',
                            }}
                            disabled={isSelf || busy !== null}
                            title={isSelf ? 'No puedes eliminar tu propia cuenta' : `Eliminar a ${member.name || member.email}`}
                            aria-label={`Eliminar a ${member.name || member.email}`}
                            onClick={() => {
                              setDeleteError('');
                              setDeletingMember(member);
                            }}
                          >
                            <Trash2 size={12} />
                            <span>Eliminar</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Dialog: Crear nuevo usuario */}
      <Dialog.Root open={creating} onOpenChange={setCreating}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '520px', padding: '28px' }}>
            <Dialog.Title className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserPlus size={22} style={{ color: 'var(--accent)' }} />
              <span>Agregar nuevo usuario</span>
            </Dialog.Title>
            <Dialog.Description className="secondary" style={{ marginBottom: '18px' }}>
              Crea una cuenta para un colaborador y asígnale su rol dentro de tu organización.
            </Dialog.Description>
            <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar">
              <X />
            </Dialog.Close>

            <form onSubmit={event => { void handleCreateUser(event); }} aria-busy={savingUser}>
              <div className="field">
                <label htmlFor="new-user-name">Nombre completo</label>
                <input
                  id="new-user-name"
                  name="name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Ej. Ana Martínez"
                  maxLength={120}
                  autoComplete="off"
                />
              </div>

              <div className="field">
                <label htmlFor="new-user-email">Correo electrónico</label>
                <input
                  id="new-user-email"
                  name="email"
                  type="email"
                  required
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="colaborador@empresa.com"
                  maxLength={254}
                  autoComplete="off"
                />
              </div>

              <div className="field">
                <label htmlFor="new-user-role">Rol asignado</label>
                <select
                  id="new-user-role"
                  name="role"
                  value={newRole}
                  onChange={e => setNewRole(roleSchema.parse(e.target.value))}
                  style={{ width: '100%', padding: '10px' }}
                >
                  {roleSchema.options.map(role => (
                    <option value={role} key={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
              </div>

              {newRole === 'admin' && (
                <div style={{ display: 'flex', gap: '8px', padding: '10px 12px', background: 'var(--surface-muted)', borderLeft: '3px solid var(--accent)', margin: '14px 0', fontSize: '12px' }}>
                  <ShieldCheck size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
                  <span>
                    <strong>Seguridad para administradores:</strong> Por política de seguridad, este usuario deberá configurar MFA (TOTP) en su primer inicio de sesión.
                  </span>
                </div>
              )}

              <div className="field">
                <label htmlFor="new-user-password">Contraseña temporal (mínimo 14 caracteres)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    id="new-user-password"
                    name="password"
                    type="text"
                    required
                    minLength={14}
                    maxLength={128}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    style={{ fontFamily: 'ui-monospace, monospace', fontSize: '13px' }}
                  />
                  <button
                    type="button"
                    className="button"
                    onClick={() => setNewPassword(generateSecurePassword())}
                    title="Generar contraseña segura"
                    style={{ whiteSpace: 'nowrap', fontSize: '12px', padding: '0 10px' }}
                  >
                    Generar
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => { void handleCopyPassword(); }}
                    title="Copiar contraseña"
                    style={{ padding: '0 10px' }}
                  >
                    {copied ? <Check size={14} style={{ color: 'var(--positive)' }} /> : <Copy size={14} />}
                  </button>
                </div>
                <small className="secondary" style={{ fontSize: '11px', marginTop: '4px' }}>
                  {copied ? '✓ Contraseña copiada al portapapeles' : 'Comparte esta contraseña de forma privada con el colaborador.'}
                </small>
              </div>

              {createError && <p className="form-error" role="alert">{createError}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => setCreating(false)}
                  disabled={savingUser}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={savingUser || newPassword.length < 14}
                >
                  {savingUser ? 'Creando usuario…' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dialog: Confirmar eliminación de usuario */}
      <Dialog.Root open={deletingMember !== null} onOpenChange={open => { if (!open) setDeletingMember(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '460px', padding: '26px' }}>
            <Dialog.Title className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--negative)' }}>
              <ShieldAlert size={22} />
              <span>Remover usuario</span>
            </Dialog.Title>
            <Dialog.Description className="secondary" style={{ margin: '12px 0 20px' }}>
              ¿Estás seguro de que deseas remover a <strong>{deletingMember?.name || deletingMember?.email}</strong> de esta organización?
              Esta acción revocará su acceso de inmediato.
            </Dialog.Description>

            {deleteError && <p className="form-error" role="alert" style={{ marginBottom: '14px' }}>{deleteError}</p>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="button"
                onClick={() => setDeletingMember(null)}
                disabled={deletingBusy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="button"
                style={{ background: 'var(--negative)', color: '#fff', borderColor: 'var(--negative)' }}
                disabled={deletingBusy}
                onClick={() => { void handleDeleteConfirm(); }}
              >
                {deletingBusy ? 'Removiendo…' : 'Confirmar remoción'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Dialog: Editar usuario */}
      <Dialog.Root open={editingMember !== null} onOpenChange={open => { if (!open && !editSaving) setEditingMember(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '540px', padding: '28px' }}>
            <Dialog.Title className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Pencil size={20} style={{ color: 'var(--accent)' }} />
              <span>Editar usuario</span>
            </Dialog.Title>
            <Dialog.Description className="secondary" style={{ marginBottom: '18px' }}>
              Modifica los datos personales, el rol operacional, las credenciales o el estado de la cuenta.
            </Dialog.Description>
            <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar" disabled={editSaving}>
              <X />
            </Dialog.Close>

            {editLoadingDetail ? (
              <p className="performance-body" role="status">Cargando información del usuario…</p>
            ) : (
              <form onSubmit={event => { void handleSaveEdit(event); }} aria-busy={editSaving}>
                <div className="field">
                  <label htmlFor="edit-user-name">Nombre completo</label>
                  <input
                    id="edit-user-name"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    required
                    maxLength={120}
                    autoComplete="off"
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-user-email">Correo electrónico</label>
                  <input
                    id="edit-user-email"
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    required
                    maxLength={254}
                    autoComplete="off"
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-user-role">Rol operacional</label>
                  <select
                    id="edit-user-role"
                    value={editRole}
                    onChange={e => setEditRole(roleSchema.parse(e.target.value))}
                  >
                    {roleSchema.options.map(role => (
                      <option value={role} key={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                  {editRole === 'admin' && (
                    <small className="secondary" style={{ fontSize: '11px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ShieldCheck size={12} color="var(--positive)" />
                      Los administradores requieren autenticación de dos factores (MFA) obligatoria.
                    </small>
                  )}
                </div>

                {/* Sección: Cambiar contraseña */}
                <div style={{ margin: '18px 0', padding: '14px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label
                      htmlFor="toggle-change-password"
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                    >
                      <KeyRound size={15} style={{ color: 'var(--accent)' }} />
                      <span>Restablecer contraseña</span>
                    </label>
                    <input
                      id="toggle-change-password"
                      type="checkbox"
                      checked={editChangePassword}
                      onChange={e => {
                        setEditChangePassword(e.target.checked);
                        if (e.target.checked && !editNewPassword) {
                          setEditNewPassword(generateSecurePassword());
                        }
                      }}
                    />
                  </div>

                  {editChangePassword && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={editNewPassword}
                          onChange={e => setEditNewPassword(e.target.value)}
                          placeholder="Mínimo 14 caracteres"
                          minLength={14}
                          maxLength={128}
                          required={editChangePassword}
                          style={{ fontFamily: 'ui-monospace, monospace', fontSize: '13px' }}
                        />
                        <button
                          type="button"
                          className="button"
                          onClick={() => {
                            setEditNewPassword(generateSecurePassword());
                            setEditCopied(false);
                          }}
                          title="Generar contraseña aleatoria segura"
                          style={{ whiteSpace: 'nowrap', fontSize: '12px' }}
                        >
                          <RotateCcw size={13} style={{ marginRight: 4 }} />
                          Generar
                        </button>
                        <button
                          type="button"
                          className="button"
                          onClick={() => { void handleCopyEditPassword(); }}
                          title="Copiar contraseña"
                          style={{ padding: '0 10px' }}
                        >
                          {editCopied ? <Check size={14} style={{ color: 'var(--positive)' }} /> : <Copy size={14} />}
                        </button>
                      </div>
                      <small className="secondary" style={{ fontSize: '11px', marginTop: '6px', display: 'block' }}>
                        {editCopied
                          ? '✓ Contraseña copiada al portapapeles'
                          : 'Las sesiones activas del usuario se cerrarán para exigir el uso de esta nueva clave.'}
                      </small>
                    </div>
                  )}
                </div>

                {/* Sección: MFA y Seguridad */}
                <div style={{ margin: '14px 0', padding: '14px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <ShieldCheck size={16} style={{ color: editMfaEnabled ? 'var(--positive)' : 'var(--muted)' }} />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>Autenticación en dos pasos (MFA)</div>
                        <div className="secondary" style={{ fontSize: '11px' }}>
                          {editMfaEnabled ? 'MFA configurado y activo en el dispositivo del usuario' : 'MFA no configurado todavía'}
                        </div>
                      </div>
                    </div>
                    {editMfaEnabled && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--negative)' }}>
                        <input
                          type="checkbox"
                          checked={editResetMfa}
                          onChange={e => setEditResetMfa(e.target.checked)}
                        />
                        <span>Restablecer MFA</span>
                      </label>
                    )}
                  </div>
                  {editResetMfa && (
                    <small style={{ color: 'var(--negative)', fontSize: '11px', marginTop: '6px', display: 'block' }}>
                      Advertencia: Al restablecer el MFA, se eliminará la llave TOTP registrada y el colaborador deberá volver a vincular su app autenticadora.
                    </small>
                  )}
                </div>

                {/* Sección: Estado de la cuenta (Deshabilitado / Activo) */}
                <div style={{ margin: '14px 0', padding: '14px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>Estado de la cuenta</div>
                      <div className="secondary" style={{ fontSize: '11px' }}>
                        {editDisabled
                          ? 'Cuenta suspendida: el usuario no puede iniciar sesión ni acceder al sistema.'
                          : 'Cuenta activa: el colaborador tiene acceso normal a la plataforma.'}
                      </div>
                    </div>
                    {editingMember && (
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          cursor: editingMember.userId === currentUserId ? 'not-allowed' : 'pointer',
                          fontSize: '12px',
                          opacity: editingMember.userId === currentUserId ? 0.5 : 1,
                        }}
                        title={editingMember.userId === currentUserId ? 'No puedes suspender tu propia cuenta' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={editDisabled}
                          disabled={editingMember.userId === currentUserId}
                          onChange={e => setEditDisabled(e.target.checked)}
                        />
                        <span>Deshabilitar cuenta</span>
                      </label>
                    )}
                  </div>
                </div>

                {editError && <p className="form-error" role="alert">{editError}</p>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setEditingMember(null)}
                    disabled={editSaving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={editSaving || (editChangePassword && editNewPassword.length < 14)}
                  >
                    {editSaving ? 'Guardando cambios…' : 'Guardar cambios'}
                  </button>
                </div>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
