'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { loginResultSchema, mfaSetupSchema } from '@atlas/contracts';
import { Brand } from '../../components/workspace';
import { api } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<'login' | 'mfa_setup' | 'mfa_verify'>('login');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = stage === 'login'
        ? await api('/auth/login', loginResultSchema, { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })
        : await api('/auth/mfa/verify', loginResultSchema, { method: 'POST', body: JSON.stringify({ code: form.get('code') }) });
      if (result.stage === 'authenticated') { setSecret(''); router.replace('/app'); return; }
      if (result.stage === 'mfa_setup') {
        const setup = await api('/auth/mfa/setup', mfaSetupSchema); setSecret(setup.secret);
      }
      setStage(result.stage);
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo iniciar sesión.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-page" id="main"><section className="auth-card"><Brand /><span className="eyebrow secondary">Acceso a tu organización</span><h1>{stage === 'login' ? 'Bienvenido a ATLAS' : stage === 'mfa_setup' ? 'Protege tu acceso' : 'Verifica tu identidad'}</h1><p className="secondary">{stage === 'login' ? 'Ingresa con el correo y la contraseña de tu cuenta.' : 'Ingresa el código de seis dígitos de tu aplicación de autenticación.'}</p>
    {stage === 'mfa_setup' && <div><p>Agrega una cuenta en tu aplicación de autenticación. Elige una clave de configuración e introduce:</p><code className="formula" aria-label="Clave de configuración MFA">{secret}</code><p className="auth-foot">Tipo: basado en tiempo · 6 dígitos · 30 segundos. Conserva esta clave en tu gestor de contraseñas; permite recuperar tu autenticador.</p></div>}
    <form onSubmit={event => { void submit(event); }} key={stage} aria-busy={busy}>
      {stage === 'login' ? <><div className="field"><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} /></div><div className="field"><label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} /></div></> : <div className="field"><label htmlFor="code">Código de autenticación</label><input id="code" name="code" type="text" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required minLength={6} maxLength={6} /></div>}
      {error && <p className="form-error" role="alert">{error}</p>}<button className="button primary" disabled={busy} type="submit">{busy ? 'Verificando…' : stage === 'login' ? 'Continuar' : 'Verificar y entrar'}<ArrowRight size={15} /></button>
    </form><p className="auth-foot"><ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />MFA obligatorio para administradores.</p><Link href="/" className="text-button">Volver al espacio de ejemplo</Link></section></main>;
}
