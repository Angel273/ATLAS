/**
 * @file apps/web/app/app/accounts/[accountId]/workforce/weeks/[weekId]/page.tsx
 * @description Vista operacional de Semana y Roster Versionado de ATLAS v3.
 * Muestra el estado de la semana ISO, las versiones del roster (v1, v2...),
 * la tabla inmutable de personal asignado (agentes, equipos, supervisores, waves),
 * la publicación de versiones y la clonación del roster hacia semanas futuras.
 */

'use client';
import { useEffect, useState, useMemo, use, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  sessionSchema,
  workforceWeekListSchema,
  rosterVersionListSchema,
  rosterEntryListSchema,
  rosterVersionSchema,
  type Session,
  type WorkforceWeek,
  type RosterVersion,
  type RosterEntry,
} from '@atlas/contracts';
import {
  Calendar,
  Users,
  Building2,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Search,
  Filter,
  Layers,
  Copy,
  UploadCloud,
  Check,
  ShieldCheck,
  AlertCircle,
  FileSpreadsheet,
  X,
  Sparkles,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { AppHeader } from '../../../../../../../components/app-header';
import { api } from '../../../../../../../lib/api';

interface WeekDetailPageProps {
  params: Promise<{ accountId: string; weekId: string }>;
}

export default function WeekDetailPage({ params }: WeekDetailPageProps) {
  const { accountId, weekId } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const user = await api('/auth/session', sessionSchema);
        setSession(user);
      } catch {
        // Handled
      }
    })();
  }, []);

  const WORKFORCE_MODULE_PAUSED = true;
  if (WORKFORCE_MODULE_PAUSED) {
    return (
      <div className="layout">
        <AppHeader session={session} accountId={accountId} />
        <main className="content" style={{ maxWidth: 720, margin: '60px auto', textAlign: 'center' }}>
          <div className="panel data-card" style={{ padding: '48px 32px' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'rgba(217, 83, 30, 0.12)',
                color: '#D9531E',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 20px auto',
              }}
            >
              <Users size={28} />
            </div>
            <span className="badge" style={{ marginBottom: 12, display: 'inline-block' }}>
              Módulo en Pausa / Rediseño
            </span>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, color: 'var(--ink)' }}>
              Módulo de Workforce
            </h1>
            <p className="secondary" style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 520, margin: '0 auto 28px auto' }}>
              El módulo de Workforce (Gestión de Personal, Jerarquías y Rosters Semanales) se encuentra temporalmente desactivado mientras se replantea y optimiza su arquitectura operacional.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <Link href={`/app/accounts/${accountId}/dashboards`} className="button primary">
                Ir a Dashboards
              </Link>
              <Link href={`/app/accounts/${accountId}/datasets`} className="button">
                Ir a Datasets
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }
  const [week, setWeek] = useState<WorkforceWeek | null>(null);
  const [allWeeks, setAllWeeks] = useState<WorkforceWeek[]>([]);
  const [versions, setVersions] = useState<RosterVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [entries, setEntries] = useState<RosterEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Filters for entries
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [supervisorFilter, setSupervisorFilter] = useState('all');

  // Clone Roster Modal
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneTargetWeekId, setCloneTargetWeekId] = useState('');
  const [cloneSaving, setCloneSaving] = useState(false);
  const [cloneError, setCloneError] = useState('');

  // Initial load
  useEffect(() => {
    let active = true;

    async function loadWeekData() {
      try {
        setLoading(true);
        setError('');
        const [sessionData, weeksData, versionsData] = await Promise.all([
          api('/auth/session', sessionSchema),
          api('/workforce/weeks', workforceWeekListSchema),
          api(`/workforce/weeks/${weekId}/rosters`, rosterVersionListSchema),
        ]);

        if (!active) return;
        setSession(sessionData);
        setAllWeeks(weeksData.items);

        const currentWeek = weeksData.items.find(w => w.id === weekId) ?? null;
        setWeek(currentWeek);
        setVersions(versionsData.items);

        if (versionsData.items.length > 0) {
          // Select published version first, or the newest version
          const published = versionsData.items.find(v => Boolean(v.publishedAt));
          const initialVersionId = published ? published.id : versionsData.items[0]!.id;
          setSelectedVersionId(initialVersionId);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error al cargar la semana operativa.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadWeekData();
    return () => { active = false; };
  }, [weekId]);

  // Load entries when selectedVersionId changes
  useEffect(() => {
    if (!selectedVersionId) {
      setEntries([]);
      return;
    }

    let active = true;
    async function loadEntries() {
      try {
        setEntriesLoading(true);
        const data = await api(`/workforce/roster-versions/${selectedVersionId}/entries`, rosterEntryListSchema);
        if (active) setEntries(data.items);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error al cargar personal del roster.');
      } finally {
        if (active) setEntriesLoading(false);
      }
    }

    void loadEntries();
    return () => { active = false; };
  }, [selectedVersionId]);

  const activeVersion = useMemo(() => {
    return versions.find(v => v.id === selectedVersionId) ?? null;
  }, [versions, selectedVersionId]);

  // Unique teams & supervisors for filter dropdowns
  const availableTeams = useMemo(() => {
    const set = new Set<string>();
    entries.forEach(e => { if (e.teamName) set.add(e.teamName); });
    return Array.from(set).sort();
  }, [entries]);

  const availableSupervisors = useMemo(() => {
    const set = new Set<string>();
    entries.forEach(e => { if (e.supervisorName) set.add(e.supervisorName); });
    return Array.from(set).sort();
  }, [entries]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const matchSearch =
        e.employeeCode.toLowerCase().includes(search.toLowerCase()) ||
        (e.bmsId && e.bmsId.toLowerCase().includes(search.toLowerCase())) ||
        (e.wave && e.wave.toLowerCase().includes(search.toLowerCase())) ||
        (e.teamName && e.teamName.toLowerCase().includes(search.toLowerCase())) ||
        (e.supervisorName && e.supervisorName.toLowerCase().includes(search.toLowerCase()));

      const matchTeam = teamFilter === 'all' || e.teamName === teamFilter;
      const matchSupervisor = supervisorFilter === 'all' || e.supervisorName === supervisorFilter;

      return matchSearch && matchTeam && matchSupervisor;
    });
  }, [entries, search, teamFilter, supervisorFilter]);

  // Publish Roster Version
  async function handlePublishVersion() {
    if (!activeVersion) return;
    try {
      setBusy(true);
      setError('');
      const published = await api(`/workforce/roster-versions/${activeVersion.id}/publish`, rosterVersionSchema, {
        method: 'POST',
      });
      setVersions(prev => prev.map(v => v.id === published.id ? published : v));
      setNotice(`Versión v${published.versionNumber} del roster publicada exitosamente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo publicar la versión del roster.');
    } finally {
      setBusy(false);
    }
  }

  // Clone Roster to Target Week
  async function handleCloneRoster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cloneTargetWeekId) return;
    try {
      setCloneSaving(true);
      setCloneError('');
      const res = await api(`/workforce/weeks/${weekId}/clone-roster`, rosterVersionSchema, {
        method: 'POST',
        body: JSON.stringify({ sourceWeekId: weekId, targetWeekId: cloneTargetWeekId }),
      });
      setCloneModalOpen(false);
      setNotice(`Roster clonado exitosamente a la semana destino (nueva versión v${res.versionNumber}).`);
      // Navegar a la semana destino
      router.push(`/app/accounts/${accountId}/workforce/weeks/${cloneTargetWeekId}`);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : 'Error al clonar el roster.');
    } finally {
      setCloneSaving(false);
    }
  }

  const canManage = session?.capabilities.includes('workforce.manage');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
      <AppHeader session={session} accountId={accountId} />

      <main className="workspace" id="main" style={{ paddingTop: '24px', paddingBottom: '60px' }}>
        {/* Navigation Breadcrumb */}
        <div className="breadcrumb" style={{ marginBottom: '16px' }}>
          <Link href={`/app/accounts/${accountId}/workforce`} className="text-button" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <ArrowLeft size={13} />
            <span>Volver al Directorio de Workforce</span>
          </Link>
          <span style={{ color: 'var(--secondary)' }}>/</span>
          <span>Semana {week?.weekCode || weekId.slice(0, 8)}</span>
        </div>

        {/* Header Title Row */}
        <div className="title-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div className="eyebrow secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Calendar size={14} />
              <span>Semana Operacional ISO</span>
            </div>
            <h1 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span>{week?.weekCode ?? 'Cargando semana…'}</span>
              {week && (
                <span
                  className={`badge ${week.status === 'current' ? 'positive' : ''}`}
                  style={{
                    fontSize: '12px',
                    borderColor: week.status === 'current' ? 'var(--accent)' : 'var(--border)',
                    color: week.status === 'current' ? 'var(--accent)' : 'inherit',
                  }}
                >
                  {week.status === 'current' ? '● Semana Actual' : week.status === 'open' ? 'Abierta' : 'Cerrada'}
                </span>
              )}
            </h1>
            <p className="secondary" style={{ fontSize: '14px', margin: 0 }}>
              Periodo del <strong>{week?.startDate}</strong> al <strong>{week?.endDate}</strong> (Lunes a Domingo).
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canManage && activeVersion && !activeVersion.publishedAt && (
              <button
                type="button"
                className="button primary"
                onClick={() => { void handlePublishVersion(); }}
                disabled={busy}
                style={{ height: '36px', fontSize: '13px', gap: '6px' }}
              >
                <CheckCircle2 size={15} />
                <span>{busy ? 'Publicando…' : `Publicar Roster v${activeVersion.versionNumber}`}</span>
              </button>
            )}

            {canManage && activeVersion && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  setCloneError('');
                  // Find next week as default candidate
                  const otherWeeks = allWeeks.filter(w => w.id !== weekId);
                  if (otherWeeks.length > 0) setCloneTargetWeekId(otherWeeks[0]!.id);
                  setCloneModalOpen(true);
                }}
                style={{ height: '36px', fontSize: '13px', gap: '6px' }}
                title="Copiar este roster congelado hacia otra semana operativa"
              >
                <Copy size={14} />
                <span>Clonar Roster</span>
              </button>
            )}
          </div>
        </div>

        {/* Notices */}
        {error && (
          <div role="alert" className="form-error" style={{ margin: '14px 0' }}>
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
              margin: '14px 0',
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

        {/* Version Selector Tabs & Overview Card */}
        <div
          className="panel"
          style={{
            marginTop: '20px',
            marginBottom: '20px',
            padding: '16px 20px',
            borderRadius: '4px',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Versiones del Roster:
              </span>

              {versions.length === 0 ? (
                <span className="secondary" style={{ fontSize: '13px' }}>Sin snapshots importados en esta semana</span>
              ) : (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {versions.map(v => {
                    const isSelected = v.id === selectedVersionId;
                    const isPublished = Boolean(v.publishedAt);

                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVersionId(v.id)}
                        style={{
                          border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                          background: isSelected ? 'var(--accent)' : 'transparent',
                          color: isSelected ? 'var(--on-accent)' : 'var(--ink)',
                          padding: '4px 12px',
                          borderRadius: '3px',
                          fontSize: '12px',
                          fontWeight: isSelected ? 600 : 400,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Layers size={12} />
                        <span>v{v.versionNumber}</span>
                        {isPublished && (
                          <span
                            style={{
                              fontSize: '10px',
                              background: isSelected ? 'rgba(255,255,255,0.25)' : 'var(--surface-muted)',
                              padding: '1px 5px',
                              borderRadius: '2px',
                            }}
                          >
                            Oficial
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {activeVersion && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: 'var(--secondary)' }}>
                <span>
                  Estado: <strong style={{ color: activeVersion.publishedAt ? 'var(--accent)' : 'inherit' }}>
                    {activeVersion.publishedAt ? 'Publicado (Inmutable)' : 'Borrador'}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Total registros: <strong>{activeVersion.rowCount}</strong>
                </span>
                {activeVersion.publishedAt && (
                  <>
                    <span>•</span>
                    <span>
                      Publicado: <strong>{new Date(activeVersion.publishedAt).toLocaleDateString()}</strong>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Entries Table Section */}
        <section className="panel table-panel" style={{ borderRadius: '4px' }}>
          <div className="panel-header" style={{ padding: '18px 20px', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <h2 style={{ fontSize: '18px', margin: '0 0 4px' }}>Personal Congelado en la Semana</h2>
              <p className="secondary" style={{ margin: 0, fontSize: '13px' }}>
                Snapshot inmutable de asignaciones a equipos, supervisores y jerarquías durante este periodo.
              </p>
            </div>

            {/* Filter controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', minWidth: '220px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--secondary)' }} />
                <input
                  type="text"
                  placeholder="Buscar agente, código, wave..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    padding: '6px 10px 6px 30px',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    width: '100%',
                    background: 'var(--surface)',
                  }}
                />
              </div>

              {availableTeams.length > 0 && (
                <select
                  value={teamFilter}
                  onChange={e => setTeamFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    background: 'var(--surface)',
                  }}
                >
                  <option value="all">Todos los Equipos ({availableTeams.length})</option>
                  {availableTeams.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}

              {availableSupervisors.length > 0 && (
                <select
                  value={supervisorFilter}
                  onChange={e => setSupervisorFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    fontSize: '12px',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    background: 'var(--surface)',
                  }}
                >
                  <option value="all">Todos los Supervisores</option>
                  {availableSupervisors.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Table */}
          {entriesLoading ? (
            <div style={{ textAlign: 'center', padding: '50px 0' }}>
              <p className="secondary">Cargando registros del roster…</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <Users size={32} style={{ color: 'var(--secondary)', opacity: 0.5, margin: '0 auto 10px' }} />
              <p style={{ margin: 0, fontWeight: 500 }}>
                {entries.length === 0
                  ? 'No hay registros cargados en esta versión del roster.'
                  : 'Ningún registro coincide con los filtros de búsqueda.'}
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>BMS ID</th>
                    <th>Equipo / Campaña</th>
                    <th>Rol / Tipo</th>
                    <th>Wave</th>
                    <th>Supervisor Asignado</th>
                    <th>Floor Manager</th>
                    <th>Hoja Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map(e => (
                    <tr key={e.id}>
                      <td>
                        <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{e.employeeCode}</strong>
                      </td>
                      <td>
                        {e.bmsId ? (
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}>{e.bmsId}</span>
                        ) : (
                          <span className="secondary">—</span>
                        )}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <Building2 size={13} style={{ color: 'var(--secondary)' }} />
                          <strong>{e.teamName || 'Sin Equipo'}</strong>
                        </span>
                      </td>
                      <td>
                        <span className="badge" style={{ fontSize: '11px' }}>
                          {e.employeeTypeSlug || 'agente'}
                        </span>
                      </td>
                      <td>
                        {e.wave ? (
                          <span style={{ fontWeight: 500 }}>{e.wave}</span>
                        ) : (
                          <span className="secondary">—</span>
                        )}
                      </td>
                      <td>
                        {e.supervisorName ? (
                          <span>{e.supervisorName}</span>
                        ) : (
                          <span className="secondary">—</span>
                        )}
                      </td>
                      <td>
                        {e.floorManagerName ? (
                          <span>{e.floorManagerName}</span>
                        ) : (
                          <span className="secondary">—</span>
                        )}
                      </td>
                      <td>
                        {e.sourceSheet ? (
                          <small className="secondary" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px' }}>
                            {e.sourceSheet} (fila {e.sourceRow})
                          </small>
                        ) : (
                          <span className="secondary">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Dialog: Clonar Roster a otra Semana */}
      <Dialog.Root open={cloneModalOpen} onOpenChange={setCloneModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '480px' }}>
            <Dialog.Title className="dialog-title">Clonar Roster Semanal</Dialog.Title>
            <Dialog.Description className="secondary">
              Copia todas las asignaciones de agentes, equipos, supervisores y roles de la semana {week?.weekCode} hacia una nueva semana operativa.
            </Dialog.Description>
            <Dialog.Close className="icon-button dialog-close" aria-label="Cerrar">
              <X />
            </Dialog.Close>

            <form onSubmit={event => { void handleCloneRoster(event); }} style={{ marginTop: '18px' }} aria-busy={cloneSaving}>
              <div className="field" style={{ marginBottom: '18px' }}>
                <label htmlFor="clone-target-week" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  Semana Operativa Destino
                </label>
                <select
                  id="clone-target-week"
                  value={cloneTargetWeekId}
                  onChange={e => setCloneTargetWeekId(e.target.value)}
                  required
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                >
                  {allWeeks
                    .filter(w => w.id !== weekId)
                    .map(w => (
                      <option key={w.id} value={w.id}>
                        {w.weekCode} ({w.startDate} al {w.endDate}) — {w.status === 'current' ? 'Actual' : w.status}
                      </option>
                    ))}
                </select>
              </div>

              {cloneError && <p className="form-error" role="alert" style={{ marginBottom: '14px' }}>{cloneError}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => setCloneModalOpen(false)}
                  disabled={cloneSaving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={cloneSaving}
                >
                  {cloneSaving ? 'Clonando…' : 'Confirmar Clonación'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
