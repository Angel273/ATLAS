'use client';
import { useState, useEffect, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  userProfileSchema, updateProfileSchema, changePasswordSchema,
  changePasswordResultSchema, roleLabels, type UserProfile, type Session,
} from '@atlas/contracts';
import { User, ShieldCheck, Key, X, Check, AlertCircle, Shield, Lock } from 'lucide-react';
import { api } from '../lib/api';

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
  onProfileUpdated?: (updated: { name: string; email: string }) => void;
}

export function ProfileDialog({ open, onOpenChange, session, onProfileUpdated }: ProfileDialogProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'info' | 'security' | 'permissions'>('info');

  // Personal info form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [infoNotice, setInfoNotice] = useState('');

  // Password change form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setInfoError('');
    setInfoNotice('');
    setPasswordError('');
    setPasswordNotice('');

    api('/users/me', userProfileSchema)
      .then(data => {
        if (!cancelled) {
          setProfile(data);
          setName(data.name);
          setEmail(data.email);
        }
      })
      .catch(() => {
        // Fallback to session details if endpoint fails
        if (!cancelled && session) {
          setName(session.name || '');
          setEmail(session.email || '');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, session]);

  async function handleSaveInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingInfo(true);
    setInfoError('');
    setInfoNotice('');

    try {
      const payload = updateProfileSchema.parse({
        name: name.trim(),
        email: email.trim(),
      });

      const updated = await api('/users/me', userProfileSchema, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setProfile(updated);
      setName(updated.name);
      setEmail(updated.email);
      setInfoNotice('Perfil actualizado correctamente.');
      if (onProfileUpdated) {
        onProfileUpdated({ name: updated.name, email: updated.email });
      }
    } catch (error) {
      setInfoError(error instanceof Error ? error.message : 'No se pudo actualizar el perfil.');
    } finally {
      setSavingInfo(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');
    setPasswordNotice('');

    if (newPassword !== confirmPassword) {
      setPasswordError('La nueva contraseña y la confirmación no coinciden.');
      return;
    }

    if (newPassword.length < 14) {
      setPasswordError('La nueva contraseña debe tener al menos 14 caracteres.');
      return;
    }

    setSavingPassword(true);
    try {
      const payload = changePasswordSchema.parse({
        currentPassword,
        newPassword,
      });

      await api('/users/me/password', changePasswordResultSchema, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setPasswordNotice('Contraseña actualizada exitosamente.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setSavingPassword(false);
    }
  }

  const roleLabel = profile?.roleLabel || (session ? roleLabels[session.role] : 'Usuario');

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" style={{ maxWidth: '580px', padding: '28px' }}>
          <Dialog.Title className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <User size={24} style={{ color: 'var(--accent)' }} />
            <span>Mi perfil</span>
          </Dialog.Title>
          <Dialog.Description className="secondary" style={{ marginBottom: '18px' }}>
            Administra tus datos personales, credenciales de acceso y revisa tus permisos.
          </Dialog.Description>
          <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar">
            <X />
          </Dialog.Close>

          {/* Tab Navigation */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '20px' }}>
            <button
              type="button"
              className={`button ${tab === 'info' ? 'primary' : ''}`}
              style={{ height: '32px', fontSize: '12px', padding: '0 12px' }}
              onClick={() => setTab('info')}
            >
              <User size={13} />
              <span>Datos personales</span>
            </button>
            <button
              type="button"
              className={`button ${tab === 'security' ? 'primary' : ''}`}
              style={{ height: '32px', fontSize: '12px', padding: '0 12px' }}
              onClick={() => setTab('security')}
            >
              <Lock size={13} />
              <span>Seguridad & Clave</span>
            </button>
            <button
              type="button"
              className={`button ${tab === 'permissions' ? 'primary' : ''}`}
              style={{ height: '32px', fontSize: '12px', padding: '0 12px' }}
              onClick={() => setTab('permissions')}
            >
              <Shield size={13} />
              <span>Permisos y rol</span>
            </button>
          </div>

          {loading ? (
            <p className="secondary" role="status">Cargando datos del perfil…</p>
          ) : (
            <>
              {/* Tab 1: Personal Info */}
              {tab === 'info' && (
                <form onSubmit={event => { void handleSaveInfo(event); }} aria-busy={savingInfo}>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '18px', padding: '12px', background: 'var(--surface-muted)', borderRadius: '3px' }}>
                    <div style={{ flex: 1 }}>
                      <span className="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Organización</span>
                      <div style={{ fontSize: '14px', fontWeight: 500, marginTop: '2px' }}>{profile?.organization || session?.organization}</div>
                    </div>
                    <div>
                      <span className="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Rol activo</span>
                      <div style={{ marginTop: '2px' }}>
                        <span className="badge positive" style={{ fontSize: '11px' }}>
                          <ShieldCheck size={12} />
                          {roleLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="profile-name">Nombre completo</label>
                    <input
                      id="profile-name"
                      name="name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Ej. Mauricio López"
                      maxLength={120}
                      autoComplete="name"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="profile-email">Correo electrónico</label>
                    <input
                      id="profile-email"
                      name="email"
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="usuario@empresa.com"
                      maxLength={254}
                      autoComplete="email"
                    />
                  </div>

                  <div style={{ margin: '14px 0', fontSize: '12px', color: 'var(--secondary)' }}>
                    <span>Estado MFA: </span>
                    {profile?.mfaEnabled ? (
                      <span style={{ color: 'var(--positive)', fontWeight: 600 }}>MFA Activado (TOTP)</span>
                    ) : (
                      <span>No configurado</span>
                    )}
                  </div>

                  {infoError && <p className="form-error" role="alert">{infoError}</p>}
                  {infoNotice && (
                    <p style={{ color: 'var(--positive)', fontSize: '13px', margin: '10px 0', display: 'flex', alignItems: 'center', gap: '6px' }} role="status">
                      <Check size={15} />
                      {infoNotice}
                    </p>
                  )}

                  <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button type="submit" className="button primary" disabled={savingInfo}>
                      {savingInfo ? 'Guardando cambios…' : 'Guardar datos'}
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 2: Security & Password */}
              {tab === 'security' && (
                <form onSubmit={event => { void handleChangePassword(event); }} aria-busy={savingPassword}>
                  <p className="secondary" style={{ fontSize: '13px', marginBottom: '16px' }}>
                    Por seguridad, las contraseñas en ATLAS deben tener al menos <strong>14 caracteres</strong>.
                  </p>

                  <div className="field">
                    <label htmlFor="current-password">Contraseña actual</label>
                    <input
                      id="current-password"
                      name="currentPassword"
                      type="password"
                      required
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="new-password">Nueva contraseña</label>
                    <input
                      id="new-password"
                      name="newPassword"
                      type="password"
                      required
                      minLength={14}
                      maxLength={128}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Mínimo 14 caracteres"
                    />
                    <small className="secondary" style={{ fontSize: '11px' }}>
                      Longitud: {newPassword.length} / 14 caracteres mínimos {newPassword.length >= 14 && '✓'}
                    </small>
                  </div>

                  <div className="field">
                    <label htmlFor="confirm-password">Confirmar nueva contraseña</label>
                    <input
                      id="confirm-password"
                      name="confirmPassword"
                      type="password"
                      required
                      minLength={14}
                      maxLength={128}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>

                  {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
                  {passwordNotice && (
                    <p style={{ color: 'var(--positive)', fontSize: '13px', margin: '10px 0', display: 'flex', alignItems: 'center', gap: '6px' }} role="status">
                      <Check size={15} />
                      {passwordNotice}
                    </p>
                  )}

                  <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button type="submit" className="button primary" disabled={savingPassword || newPassword.length < 14}>
                      {savingPassword ? 'Actualizando contraseña…' : 'Actualizar contraseña'}
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 3: Permissions & Capabilities */}
              {tab === 'permissions' && (
                <div>
                  <div style={{ marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '15px', marginBottom: '6px' }}>Rol asignado: {roleLabel}</h3>
                    <p className="secondary" style={{ fontSize: '13px' }}>
                      Los permisos son determinados por la política de control de acceso de la organización.
                      Solo un Administrador puede modificar los roles asignados.
                    </p>
                  </div>

                  <div style={{ border: '1px solid var(--border)', borderRadius: '3px', padding: '14px', background: 'var(--surface-muted)' }}>
                    <span className="secondary" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                      Capacidades autorizadas en tu sesión:
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                      {(profile?.capabilities || session?.capabilities || []).map(cap => (
                        <span key={cap} className="badge" style={{ background: 'var(--surface)', fontSize: '11px', fontFamily: 'ui-monospace, monospace' }}>
                          <Check size={11} style={{ color: 'var(--positive)' }} />
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
