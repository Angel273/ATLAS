'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Users,
  Shield,
  Clock,
  Building2,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  UserCheck,
  UserX,
  History,
  Briefcase,
  Layers,
} from 'lucide-react';
import {
  sessionSchema,
  employeeListSchema,
  employeeSchema,
  teamListSchema,
  teamSchema,
  employeeTypeListSchema,
  employeeTypeSchema,
  employmentAssignmentListSchema,
  employmentAssignmentSchema,
  employeeRelationshipListSchema,
  employeeRelationshipSchema,
  type Session,
  type Employee,
  type Team,
  type EmployeeType,
  type EmploymentAssignment,
  type EmployeeRelationship,
} from '@atlas/contracts';
import { api } from '../../../lib/api';
import { AppHeader } from '../../../components/app-header';

type Tab = 'agentes' | 'equipos' | 'tipos';

export default function WorkforcePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>('agentes');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [types, setTypes] = useState<EmployeeType[]>([]);

  // Search and filters
  const [search, setSearch] = useState('');
  const [selectedTeamFilter, setSelectedTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals & Drawers
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [employeeAssignments, setEmployeeAssignments] = useState<EmploymentAssignment[]>([]);
  const [employeeRelationships, setEmployeeRelationships] = useState<EmployeeRelationship[]>([]);

  // Forms state
  const [showNewEmployeeModal, setShowNewEmployeeModal] = useState(false);
  const [showNewTeamModal, setShowNewTeamModal] = useState(false);
  const [showNewTypeModal, setShowNewTypeModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = session?.capabilities.includes('workforce.manage');

  async function refreshData() {
    try {
      const [empRes, teamRes, typeRes] = await Promise.all([
        api('/workforce/employees', employeeListSchema),
        api('/workforce/teams', teamListSchema),
        api('/workforce/employee-types', employeeTypeListSchema),
      ]);
      setEmployees(empRes.items);
      setTeams(teamRes.items);
      setTypes(typeRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar datos de workforce.');
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const user = await api('/auth/session', sessionSchema);
        setSession(user);
        await refreshData();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo autenticar.');
      }
    })();
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenHistory(employee: Employee) {
    setSelectedEmployee(employee);
    await run(async () => {
      const [assignments, relationships] = await Promise.all([
        api(`/workforce/employees/${employee.id}/assignments`, employmentAssignmentListSchema),
        api(`/workforce/employees/${employee.id}/relationships`, employeeRelationshipListSchema),
      ]);
      setEmployeeAssignments(assignments.items);
      setEmployeeRelationships(relationships.items);
    });
  }

  async function handleCreateEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const newEmp = await api('/workforce/employees', employeeSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          code: form.get('code'),
          firstName: form.get('firstName'),
          lastName: form.get('lastName'),
          email: form.get('email') || undefined,
          status: form.get('status') || 'active',
          hireDate: form.get('hireDate') || undefined,
          employeeTypeId: form.get('employeeTypeId') || undefined,
          teamId: form.get('teamId') || undefined,
          managerId: form.get('managerId') || undefined,
        }),
      });
      setShowNewEmployeeModal(false);
      setNotice(`Empleado ${newEmp.firstName} ${newEmp.lastName} (${newEmp.code}) registrado exitosamente.`);
      await refreshData();
    });
  }

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const newTeam = await api('/workforce/teams', teamSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          name: form.get('name'),
          slug: form.get('slug'),
          description: form.get('description') || '',
        }),
      });
      setShowNewTeamModal(false);
      setNotice(`Equipo "${newTeam.name}" creado exitosamente.`);
      await refreshData();
    });
  }

  async function handleCreateType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const newType = await api('/workforce/employee-types', employeeTypeSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          name: form.get('name'),
          slug: form.get('slug'),
          description: form.get('description') || '',
        }),
      });
      setShowNewTypeModal(false);
      setNotice(`Tipo de rol "${newType.name}" creado exitosamente.`);
      await refreshData();
    });
  }

  async function handleTransferEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee) return;
    const form = new FormData(event.currentTarget);
    const newTeamId = form.get('teamId') as string;
    const newTypeId = form.get('employeeTypeId') as string;
    const newManagerId = form.get('managerId') as string;

    await run(async () => {
      if (newTeamId && newTypeId) {
        await api('/workforce/assignments', employmentAssignmentSchema, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            employeeId: selectedEmployee.id,
            employeeTypeId: newTypeId,
            teamId: newTeamId,
          }),
        });
      }

      if (newManagerId) {
        await api('/workforce/relationships', employeeRelationshipSchema, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            employeeId: selectedEmployee.id,
            managerId: newManagerId,
            relationType: 'supervisor',
          }),
        });
      }

      setShowTransferModal(false);
      setNotice(`Asignación actualizada para ${selectedEmployee.firstName} ${selectedEmployee.lastName}. Linaje histórico preservado.`);
      await refreshData();
      if (selectedEmployee) {
        const updated = await api(`/workforce/employees/${selectedEmployee.id}`, employeeSchema);
        await handleOpenHistory(updated);
      }
    });
  }

  // Filtered employees
  const filteredEmployees = employees.filter(emp => {
    if (selectedTeamFilter && emp.currentTeamId !== selectedTeamFilter) return false;
    if (statusFilter && emp.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchCode = emp.code.toLowerCase().includes(q);
      const matchName = `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q);
      const matchEmail = (emp.email || '').toLowerCase().includes(q);
      if (!matchCode && !matchName && !matchEmail) return false;
    }
    return true;
  });

  const totalAgents = employees.length;
  const activeAgents = employees.filter(e => e.status === 'active').length;
  const assignedTeamsCount = teams.length;
  const supervisedCount = employees.filter(e => e.currentManagerId).length;
  const supervisionCoverage = totalAgents > 0 ? Math.round((supervisedCount / totalAgents) * 100) : 0;

  return (
    <>
      <AppHeader session={session} />

      <main id="main" className="workspace data-workspace" style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px' }}>
        <div className="breadcrumb">Espacio de trabajo / Workforce & Agent Definer</div>

        <div className="title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span className="eyebrow secondary">Estructura Laboral y Personas</span>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '28px', margin: '4px 0 8px' }}>
              Agent Definer & Directorio de Equipos
            </h1>
            <p className="secondary" style={{ maxWidth: '750px', margin: 0 }}>
              Gobierna el roster de call center, equipos y linaje temporal de asignaciones con inmutabilidad histórica garantizada.
            </p>
          </div>

          {canManage && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="button primary"
                onClick={() => setShowNewEmployeeModal(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={14} />
                <span>Nuevo Empleado</span>
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setShowNewTeamModal(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Building2 size={14} />
                <span>Nuevo Equipo</span>
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setShowNewTypeModal(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Briefcase size={14} />
                <span>Nuevo Rol</span>
              </button>
            </div>
          )}
        </div>

        {error && <p role="alert" className="form-error" style={{ marginTop: '16px' }}>{error}</p>}
        {notice && <p role="status" style={{ marginTop: '16px', color: 'var(--accent)', fontWeight: 500 }}>{notice}</p>}

        {/* Operational Stats Cards */}
        <div className="data-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginTop: '20px' }}>
          <div className="panel data-card" style={{ padding: '16px' }}>
            <span className="secondary" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Roster</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px' }}>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: '28px', fontWeight: 600 }}>{totalAgents}</span>
              <span className="secondary" style={{ fontSize: '12px' }}>({activeAgents} activos)</span>
            </div>
          </div>

          <div className="panel data-card" style={{ padding: '16px' }}>
            <span className="secondary" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Equipos Operacionales</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px' }}>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: '28px', fontWeight: 600 }}>{assignedTeamsCount}</span>
              <span className="secondary" style={{ fontSize: '12px' }}>campañas activas</span>
            </div>
          </div>

          <div className="panel data-card" style={{ padding: '16px' }}>
            <span className="secondary" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tipos de Rol</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px' }}>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: '28px', fontWeight: 600 }}>{types.length}</span>
              <span className="secondary" style={{ fontSize: '12px' }}>categorías laborales</span>
            </div>
          </div>

          <div className="panel data-card" style={{ padding: '16px' }}>
            <span className="secondary" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cobertura de Supervisión</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px' }}>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: '28px', fontWeight: 600 }}>{supervisionCoverage}%</span>
              <span className="secondary" style={{ fontSize: '12px' }}>con líder asignado</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)', marginTop: '24px' }}>
          <button
            type="button"
            className={`button ${tab === 'agentes' ? 'primary' : ''}`}
            onClick={() => setTab('agentes')}
            style={{ borderRadius: '3px 3px 0 0', borderBottom: 'none' }}
          >
            <Users size={14} style={{ marginRight: '6px' }} />
            Directorio de Agentes ({employees.length})
          </button>
          <button
            type="button"
            className={`button ${tab === 'equipos' ? 'primary' : ''}`}
            onClick={() => setTab('equipos')}
            style={{ borderRadius: '3px 3px 0 0', borderBottom: 'none' }}
          >
            <Building2 size={14} style={{ marginRight: '6px' }} />
            Equipos de Operación ({teams.length})
          </button>
          <button
            type="button"
            className={`button ${tab === 'tipos' ? 'primary' : ''}`}
            onClick={() => setTab('tipos')}
            style={{ borderRadius: '3px 3px 0 0', borderBottom: 'none' }}
          >
            <Briefcase size={14} style={{ marginRight: '6px' }} />
            Roles y Tipos ({types.length})
          </button>
        </div>

        {/* TAB 1: EMPLOYEES DIRECTORY */}
        {tab === 'agentes' && (
          <section className="panel data-card" style={{ marginTop: '0', borderTop: 'none', borderRadius: '0 0 3px 3px' }}>
            {/* Filter Bar */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--secondary)' }} />
                <input
                  type="text"
                  placeholder="Buscar por código, nombre o correo…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: '32px', width: '100%' }}
                />
              </div>

              <select
                value={selectedTeamFilter}
                onChange={e => setSelectedTeamFilter(e.target.value)}
                style={{ width: 'auto', minWidth: '180px' }}
              >
                <option value="">Todos los equipos</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{ width: 'auto', minWidth: '140px' }}
              >
                <option value="">Todos los estados</option>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
                <option value="on_leave">En permiso</option>
              </select>
            </div>

            {filteredEmployees.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                <Users size={32} style={{ color: 'var(--secondary)', opacity: 0.6, margin: '0 auto 12px' }} />
                <p style={{ margin: 0, fontWeight: 500 }}>No se encontraron empleados con los filtros aplicados.</p>
                <span className="secondary" style={{ fontSize: '13px' }}>
                  {canManage ? 'Usa el botón "+ Nuevo Empleado" para dar de alta al primer agente.' : 'Comunícate con un administrador para registrar agentes.'}
                </span>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Empleado</th>
                      <th>Rol Laboral</th>
                      <th>Equipo Actual</th>
                      <th>Supervisor</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map(emp => (
                      <tr key={emp.id}>
                        <td>
                          <code style={{ fontWeight: 600, color: 'var(--accent)' }}>{emp.code}</code>
                        </td>
                        <td>
                          <strong>{emp.firstName} {emp.lastName}</strong>
                          {emp.email && <div className="secondary" style={{ fontSize: '12px' }}>{emp.email}</div>}
                        </td>
                        <td>{emp.currentEmployeeTypeName || <span className="secondary">Sin asignar</span>}</td>
                        <td>{emp.currentTeamName || <span className="secondary">Sin equipo</span>}</td>
                        <td>{emp.currentManagerName || <span className="secondary">Sin supervisor</span>}</td>
                        <td>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '3px',
                              fontSize: '11px',
                              fontWeight: 600,
                              backgroundColor: emp.status === 'active' ? 'var(--surface-muted)' : 'var(--border)',
                              color: emp.status === 'active' ? 'var(--accent)' : 'var(--secondary)',
                              border: '1px solid currentColor',
                            }}
                          >
                            {emp.status === 'active' ? 'Activo' : emp.status === 'inactive' ? 'Inactivo' : 'Permiso'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="button"
                              onClick={() => { void handleOpenHistory(emp); }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <History size={13} />
                              <span>Historial</span>
                            </button>
                            {canManage && (
                              <button
                                type="button"
                                className="button"
                                onClick={() => {
                                  setSelectedEmployee(emp);
                                  setShowTransferModal(true);
                                }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                <ArrowRight size={13} />
                                <span>Transferir</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 2: TEAMS */}
        {tab === 'equipos' && (
          <section className="panel data-card" style={{ marginTop: '0', borderTop: 'none', borderRadius: '0 0 3px 3px' }}>
            {teams.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                <Building2 size={32} style={{ color: 'var(--secondary)', opacity: 0.6, margin: '0 auto 12px' }} />
                <p style={{ margin: 0, fontWeight: 500 }}>No hay equipos configurados.</p>
                {canManage && (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => setShowNewTeamModal(true)}
                    style={{ marginTop: '12px' }}
                  >
                    Crear primer equipo
                  </button>
                )}
              </div>
            ) : (
              <div className="data-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {teams.map(team => {
                  const memberCount = employees.filter(e => e.currentTeamId === team.id).length;
                  return (
                    <article key={team.id} className="panel" style={{ padding: '16px', background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <h3 style={{ margin: '0 0 4px', fontSize: '16px' }}>{team.name}</h3>
                          <code>{team.slug}</code>
                        </div>
                        <span
                          style={{
                            padding: '3px 8px',
                            background: 'var(--surface-muted)',
                            borderRadius: '3px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'var(--accent)',
                          }}
                        >
                          {memberCount} {memberCount === 1 ? 'agente' : 'agentes'}
                        </span>
                      </div>
                      {team.description && (
                        <p className="secondary" style={{ fontSize: '13px', margin: '8px 0 0' }}>{team.description}</p>
                      )}
                      <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span className="secondary">Creado: {new Date(team.createdAt).toLocaleDateString()}</span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setSelectedTeamFilter(team.id);
                            setTab('agentes');
                          }}
                        >
                          Ver agentes ↗
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: EMPLOYEE TYPES */}
        {tab === 'tipos' && (
          <section className="panel data-card" style={{ marginTop: '0', borderTop: 'none', borderRadius: '0 0 3px 3px' }}>
            {types.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                <Briefcase size={32} style={{ color: 'var(--secondary)', opacity: 0.6, margin: '0 auto 12px' }} />
                <p style={{ margin: 0, fontWeight: 500 }}>No hay roles definidos.</p>
                {canManage && (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => setShowNewTypeModal(true)}
                    style={{ marginTop: '12px' }}
                  >
                    Crear primer rol
                  </button>
                )}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre del Rol</th>
                      <th>Slug</th>
                      <th>Descripción</th>
                      <th>Agentes Asignados</th>
                      <th>Fecha de Creación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.map(t => {
                      const count = employees.filter(e => e.currentEmployeeTypeId === t.id).length;
                      return (
                        <tr key={t.id}>
                          <td><strong>{t.name}</strong></td>
                          <td><code>{t.slug}</code></td>
                          <td>{t.description || <span className="secondary">Sin descripción</span>}</td>
                          <td>
                            <strong>{count}</strong> {count === 1 ? 'empleado' : 'empleados'}
                          </td>
                          <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* MODAL / DRAWER: EMPLOYEE HISTORY (TEMPORAL LINEAGE) */}
        {selectedEmployee && !showTransferModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.4)',
              display: 'flex',
              justifyContent: 'flex-end',
              zIndex: 100,
            }}
            onClick={() => setSelectedEmployee(null)}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '550px',
                height: '100%',
                background: 'var(--surface)',
                boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
                padding: '24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span className="eyebrow secondary">Ficha y Linaje Temporal</span>
                  <h2 style={{ margin: '4px 0', fontFamily: 'Georgia, serif' }}>
                    {selectedEmployee.firstName} {selectedEmployee.lastName}
                  </h2>
                  <code style={{ fontWeight: 600, color: 'var(--accent)' }}>{selectedEmployee.code}</code>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() => setSelectedEmployee(null)}
                >
                  ✕ Cerrar
                </button>
              </div>

              {/* Employee Summary Card */}
              <div style={{ padding: '12px', background: 'var(--surface-muted)', borderRadius: '3px', fontSize: '13px' }}>
                <div><strong>Correo:</strong> {selectedEmployee.email || 'No registrado'}</div>
                <div><strong>Estado:</strong> {selectedEmployee.status}</div>
                <div><strong>Rol Actual:</strong> {selectedEmployee.currentEmployeeTypeName || 'Sin asignar'}</div>
                <div><strong>Equipo Actual:</strong> {selectedEmployee.currentTeamName || 'Sin asignar'}</div>
                <div><strong>Supervisor Actual:</strong> {selectedEmployee.currentManagerName || 'Sin supervisor'}</div>
                {selectedEmployee.hireDate && (
                  <div><strong>Fecha de Ingreso:</strong> {selectedEmployee.hireDate}</div>
                )}
              </div>

              {canManage && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setShowTransferModal(true)}
                  style={{ width: '100%', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                >
                  <ArrowRight size={14} />
                  <span>Transferir de Equipo o Supervisor</span>
                </button>
              )}

              {/* Temporal Assignments Timeline */}
              <div>
                <h3 style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px', margin: '16px 0 8px' }}>
                  <Clock size={16} />
                  Historial de Equipos y Asignaciones
                </h3>
                <p className="secondary" style={{ fontSize: '12px', margin: '0 0 10px' }}>
                  Preservación histórica: cada periodo se conserva intacto para análisis retrospectivo de KPIs.
                </p>

                {employeeAssignments.length === 0 ? (
                  <p className="secondary">Sin asignaciones registradas.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {employeeAssignments.map(a => (
                      <div
                        key={a.id}
                        style={{
                          padding: '10px 14px',
                          background: a.validTo === null ? 'var(--surface-muted)' : 'var(--surface)',
                          borderLeft: `3px solid ${a.validTo === null ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: '3px',
                          fontSize: '13px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong>{a.teamName || 'Sin equipo'}</strong>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: a.validTo === null ? 'var(--accent)' : 'var(--secondary)',
                            }}
                          >
                            {a.validTo === null ? '● Vigente (Actual)' : 'Cerrado'}
                          </span>
                        </div>
                        <div className="secondary" style={{ fontSize: '12px' }}>{a.employeeTypeName}</div>
                        <div className="secondary" style={{ fontSize: '11px', marginTop: '4px' }}>
                          {new Date(a.validFrom).toLocaleDateString()} — {a.validTo ? new Date(a.validTo).toLocaleDateString() : 'Presente'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Temporal Manager Timeline */}
              <div>
                <h3 style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px', margin: '16px 0 8px' }}>
                  <Shield size={16} />
                  Historial de Supervisión y Jerarquía
                </h3>

                {employeeRelationships.length === 0 ? (
                  <p className="secondary">Sin relaciones de supervisión registradas.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {employeeRelationships.map(r => (
                      <div
                        key={r.id}
                        style={{
                          padding: '10px 14px',
                          background: r.validTo === null ? 'var(--surface-muted)' : 'var(--surface)',
                          borderLeft: `3px solid ${r.validTo === null ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: '3px',
                          fontSize: '13px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong>Líder: {r.managerName || 'Supervisor'}</strong>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: r.validTo === null ? 'var(--accent)' : 'var(--secondary)' }}>
                            {r.validTo === null ? '● Actual' : 'Anterior'}
                          </span>
                        </div>
                        <div className="secondary" style={{ fontSize: '11px', marginTop: '4px' }}>
                          {new Date(r.validFrom).toLocaleDateString()} — {r.validTo ? new Date(r.validTo).toLocaleDateString() : 'Presente'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODAL: TRANSFER EMPLOYEE */}
        {showTransferModal && selectedEmployee && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 110,
              padding: '16px',
            }}
            onClick={() => setShowTransferModal(false)}
          >
            <div
              className="panel data-card"
              style={{ maxWidth: '480px', width: '100%', background: 'var(--surface)' }}
              onClick={e => e.stopPropagation()}
            >
              <h3>Transferir / Reasignar Agente</h3>
              <p className="secondary" style={{ fontSize: '13px', margin: '4px 0 16px' }}>
                Reasignando a: <strong>{selectedEmployee.firstName} {selectedEmployee.lastName} ({selectedEmployee.code})</strong>
              </p>

              <form onSubmit={event => { void handleTransferEmployee(event); }}>
                <label className="field">
                  Nuevo Equipo Operacional
                  <select name="teamId" defaultValue={selectedEmployee.currentTeamId || ''} required>
                    <option value="">Selecciona equipo destino</option>
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                    ))}
                  </select>
                </label>

                <label className="field" style={{ marginTop: '12px' }}>
                  Rol Laboral
                  <select name="employeeTypeId" defaultValue={selectedEmployee.currentEmployeeTypeId || ''} required>
                    <option value="">Selecciona rol</option>
                    {types.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>

                <label className="field" style={{ marginTop: '12px' }}>
                  Nuevo Supervisor (Opcional)
                  <select name="managerId" defaultValue={selectedEmployee.currentManagerId || ''}>
                    <option value="">Mantener o sin supervisor</option>
                    {employees
                      .filter(e => e.id !== selectedEmployee.id)
                      .map(e => (
                        <option key={e.id} value={e.id}>
                          {e.firstName} {e.lastName} ({e.code}) · {e.currentTeamName || 'Sin equipo'}
                        </option>
                      ))}
                  </select>
                </label>

                <div
                  style={{
                    padding: '10px 12px',
                    margin: '16px 0',
                    background: 'var(--surface-muted)',
                    borderLeft: '3px solid var(--accent)',
                    fontSize: '12px',
                  }}
                >
                  Principio de inmutabilidad (ATLAS): La vigencia anterior se cerrará automáticamente con la fecha actual y comenzará la nueva asignación.
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button type="button" className="button" onClick={() => setShowTransferModal(false)}>
                    Cancelar
                  </button>
                  <button className="button primary" disabled={busy}>
                    {busy ? 'Guardando…' : 'Confirmar Transferencia'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: CREATE EMPLOYEE */}
        {showNewEmployeeModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 110,
              padding: '16px',
            }}
            onClick={() => setShowNewEmployeeModal(false)}
          >
            <div
              className="panel data-card"
              style={{ maxWidth: '520px', width: '100%', background: 'var(--surface)' }}
              onClick={e => e.stopPropagation()}
            >
              <h3>Nuevo Empleado / Agente</h3>
              <p className="secondary" style={{ fontSize: '13px', margin: '4px 0 16px' }}>
                Registra un miembro en el roster de la organización con código natural único.
              </p>

              <form onSubmit={event => { void handleCreateEmployee(event); }}>
                <div className="data-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <label className="field">
                    Código de Agente
                    <input name="code" placeholder="ej. AGT-101" required minLength={1} maxLength={63} />
                  </label>
                  <label className="field">
                    Estado Inicial
                    <select name="status" defaultValue="active">
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                      <option value="on_leave">En permiso</option>
                    </select>
                  </label>
                  <label className="field">
                    Nombre
                    <input name="firstName" placeholder="Nombre" required minLength={1} maxLength={120} />
                  </label>
                  <label className="field">
                    Apellido
                    <input name="lastName" placeholder="Apellido" required minLength={1} maxLength={120} />
                  </label>
                </div>

                <label className="field" style={{ marginTop: '12px' }}>
                  Correo Electrónico (Opcional)
                  <input name="email" type="email" placeholder="agente@empresa.com" />
                </label>

                <div className="data-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '12px' }}>
                  <label className="field">
                    Rol / Tipo de Empleado
                    <select name="employeeTypeId" required>
                      <option value="">Selecciona rol</option>
                      {types.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    Equipo Inicial
                    <select name="teamId">
                      <option value="">Sin equipo inicial</option>
                      {teams.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="data-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '12px' }}>
                  <label className="field">
                    Supervisor / Líder
                    <select name="managerId">
                      <option value="">Sin supervisor inicial</option>
                      {employees.map(e => (
                        <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.code})</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    Fecha de Ingreso
                    <input name="hireDate" type="date" />
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button type="button" className="button" onClick={() => setShowNewEmployeeModal(false)}>
                    Cancelar
                  </button>
                  <button className="button primary" disabled={busy}>
                    {busy ? 'Guardando…' : 'Crear Empleado'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: CREATE TEAM */}
        {showNewTeamModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 110,
              padding: '16px',
            }}
            onClick={() => setShowNewTeamModal(false)}
          >
            <div
              className="panel data-card"
              style={{ maxWidth: '440px', width: '100%', background: 'var(--surface)' }}
              onClick={e => e.stopPropagation()}
            >
              <h3>Nuevo Equipo Operacional</h3>
              <form onSubmit={event => { void handleCreateTeam(event); }}>
                <label className="field" style={{ marginTop: '12px' }}>
                  Nombre del Equipo
                  <input name="name" placeholder="ej. Equipo Soporte Nivel 1" required minLength={2} maxLength={120} />
                </label>

                <label className="field" style={{ marginTop: '12px' }}>
                  Identificador (Slug)
                  <input name="slug" pattern="[a-z][a-z0-9_]{1,62}" placeholder="soporte_n1" required />
                </label>

                <label className="field" style={{ marginTop: '12px' }}>
                  Descripción
                  <input name="description" placeholder="Misión o campaña del equipo" maxLength={1000} />
                </label>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button type="button" className="button" onClick={() => setShowNewTeamModal(false)}>
                    Cancelar
                  </button>
                  <button className="button primary" disabled={busy}>
                    {busy ? 'Guardando…' : 'Crear Equipo'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: CREATE EMPLOYEE TYPE */}
        {showNewTypeModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 110,
              padding: '16px',
            }}
            onClick={() => setShowNewTypeModal(false)}
          >
            <div
              className="panel data-card"
              style={{ maxWidth: '440px', width: '100%', background: 'var(--surface)' }}
              onClick={e => e.stopPropagation()}
            >
              <h3>Nuevo Rol / Tipo de Empleado</h3>
              <form onSubmit={event => { void handleCreateType(event); }}>
                <label className="field" style={{ marginTop: '12px' }}>
                  Nombre del Rol
                  <input name="name" placeholder="ej. Coordinador de Calidad" required minLength={2} maxLength={120} />
                </label>

                <label className="field" style={{ marginTop: '12px' }}>
                  Identificador (Slug)
                  <input name="slug" pattern="[a-z][a-z0-9_]{1,62}" placeholder="coordinador_calidad" required />
                </label>

                <label className="field" style={{ marginTop: '12px' }}>
                  Descripción
                  <input name="description" placeholder="Responsabilidades o nivel" maxLength={1000} />
                </label>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button type="button" className="button" onClick={() => setShowNewTypeModal(false)}>
                    Cancelar
                  </button>
                  <button className="button primary" disabled={busy}>
                    {busy ? 'Guardando…' : 'Crear Rol'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
