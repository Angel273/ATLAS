'use client';
import { useEffect, useState, useMemo, useRef, type FormEvent } from 'react';
import {
  sessionSchema,
  dashboardListSchema,
  dashboardSchema,
  dashboardVersionSchema,
  dashboardFilterOptionsSchema,
  kpiListSchema,
  queryResultSchema,
  type Session,
  type Dashboard,
  type WidgetDefinition,
  type WidgetType,
  type Kpi,
} from '@atlas/contracts';
import { z } from 'zod';
import {
  LayoutDashboard,
  Plus,
  ShieldCheck,
  CalendarDays,
  Table as TableIcon,
  TrendingUp,
  Download,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  GripVertical,
  SlidersHorizontal,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../../../lib/api';
import { AppHeader } from '../../../components/app-header';
import { WidgetChart } from '../../../components/widget-chart';
import { WidgetConfigSidebar } from '../../../components/widget-config-sidebar';

type QueryData = z.infer<typeof queryResultSchema>;

export default function DashboardsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeDashboardId, setActiveDashboardId] = useState<string>('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);

  // Widget layout (ephemeral for non-admins, persistent draft for admins)
  const [widgets, setWidgets] = useState<WidgetDefinition[]>([]);
  const [widgetData, setWidgetData] = useState<Record<string, { loading: boolean; error?: string; data?: QueryData }>>({});
  const [chartViewMode, setChartViewMode] = useState<Record<string, 'chart' | 'table'>>({});

  // Drag and Drop, Resizing & Sidebar State
  const [editingWidget, setEditingWidget] = useState<WidgetDefinition | null>(null);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [hoveredWidgetId, setHoveredWidgetId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Global date & operational filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedDateField, setSelectedDateField] = useState<string>('');
  const [customDateField, setCustomDateField] = useState<string>('');
  const [supervisorFilter, setSupervisorFilter] = useState<string>('');
  const [fmFilter, setFmFilter] = useState<string>('');
  const [waveFilter, setWaveFilter] = useState<string>('');

  // Available options loaded from dashboard datasets
  const [availableSupervisors, setAvailableSupervisors] = useState<string[]>([]);
  const [availableFms, setAvailableFms] = useState<string[]>([]);
  const [availableWaves, setAvailableWaves] = useState<string[]>([]);
  const [availableDateFields, setAvailableDateFields] = useState<string[]>([]);

  // UI state
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [isLocalDirty, setIsLocalDirty] = useState(false);

  // Dialogs
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddWidgetModal, setShowAddWidgetModal] = useState(false);
  const [selectedKpiId, setSelectedKpiId] = useState<string>('');
  const [selectedDim, setSelectedDim] = useState<string>('');
  const [customDim, setCustomDim] = useState<string>('');

  const isAdmin = session?.capabilities.includes('dashboard.manage');
  const canPublish = session?.capabilities.includes('dashboard.publish');

  // Load initial session, dashboards, and KPIs
  useEffect(() => {
    void (async () => {
      try {
        const s = await api('/auth/session', sessionSchema);
        setSession(s);
        const [dashList, kpiList] = await Promise.all([
          api('/dashboards', dashboardListSchema),
          api('/kpis', kpiListSchema),
        ]);
        setDashboards(dashList.items);
        setKpis(kpiList.items);
        if (kpiList.items.length > 0) {
          const firstValid = kpiList.items.find(k => k.publishedAt && !k.deprecatedAt) ?? kpiList.items[0];
          if (firstValid) {
            setSelectedKpiId(firstValid.id);
            if (firstValid.dimensions.length > 0) setSelectedDim(firstValid.dimensions[0] ?? '');
          }
        }
        if (dashList.items.length > 0 && !activeDashboardId) {
          setActiveDashboardId(dashList.items[0]!.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar el panel de control.');
      }
    })();
  }, []);

  // Load selected dashboard details
  useEffect(() => {
    if (!activeDashboardId) return;
    let active = true;
    void (async () => {
      try {
        setBusy(true);
        const d = await api(`/dashboards/${activeDashboardId}`, dashboardSchema);
        if (!active) return;
        setDashboard(d);
        const layout = d.currentVersion?.layout ?? [];
        setWidgets(layout);

        const gf = (d.currentVersion?.globalFilters || {}) as Record<string, unknown>;
        setDateFrom(typeof gf.dateFrom === 'string' ? gf.dateFrom : '');
        setDateTo(typeof gf.dateTo === 'string' ? gf.dateTo : '');
        if (typeof gf.dateField === 'string') {
          if (['fecha', 'created_at', 'date', 'call_date', 'timestamp'].includes(gf.dateField)) {
            setSelectedDateField(gf.dateField);
            setCustomDateField('');
          } else if (gf.dateField) {
            setSelectedDateField('__custom__');
            setCustomDateField(gf.dateField);
          }
        } else {
          setSelectedDateField('');
          setCustomDateField('');
        }
        setSupervisorFilter(typeof gf.supervisor === 'string' ? gf.supervisor : '');
        setFmFilter(typeof gf.fm === 'string' ? gf.fm : '');
        setWaveFilter(typeof gf.wave === 'string' ? gf.wave : '');

        setIsLocalDirty(false);
        setError('');
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'No se pudo cargar el dashboard.');
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, [activeDashboardId]);

  // Load dynamic filter options (supervisors, FMs, waves, dateFields) from dashboard datasets
  useEffect(() => {
    if (!activeDashboardId) return;
    let active = true;
    void (async () => {
      try {
        const opts = await api(`/dashboards/${activeDashboardId}/filter-options`, dashboardFilterOptionsSchema);
        if (!active) return;
        setAvailableSupervisors(opts.supervisors);
        setAvailableFms(opts.fms);
        setAvailableWaves(opts.waves);
        setAvailableDateFields(opts.dateFields);
      } catch {
        // Graceful fallback: manual text entry remains available
      }
    })();
    return () => { active = false; };
  }, [activeDashboardId]);

  // Execute queries for widgets
  useEffect(() => {
    if (!widgets.length) return;
    let active = true;

    for (const w of widgets) {
      if (!w.kpiVersionId) continue;
      const widgetId = w.id;
      setWidgetData(prev => ({ ...prev, [widgetId]: { loading: true } }));

      void (async () => {
        try {
          const effectiveDateCol = w.dateField || (selectedDateField === '__custom__' ? customDateField : selectedDateField) || '';

          const filters: Array<{ field: string; op: 'eq'; value: string }> = [];
          if (supervisorFilter.trim()) {
            filters.push({ field: 'supervisor', op: 'eq', value: supervisorFilter.trim() });
          }
          if (fmFilter.trim()) {
            filters.push({ field: 'fm', op: 'eq', value: fmFilter.trim() });
          }
          if (waveFilter.trim()) {
            filters.push({ field: 'wave', op: 'eq', value: waveFilter.trim() });
          }

          const body: Record<string, unknown> = {
            kpiVersionId: w.kpiVersionId,
            dimensions: w.dimension ? [w.dimension] : [],
            filters,
            limit: 100,
          };
          if (dateFrom || dateTo) {
            body.timeRange = {
              field: effectiveDateCol,
              from: dateFrom || undefined,
              to: dateTo || undefined,
            };
          }

          const res = await api('/queries', queryResultSchema, {
            method: 'POST',
            body: JSON.stringify(body),
          });

          if (!active) return;
          setWidgetData(prev => ({
            ...prev,
            [widgetId]: { loading: false, data: res },
          }));
        } catch (err) {
          if (!active) return;
          setWidgetData(prev => ({
            ...prev,
            [widgetId]: { loading: false, error: err instanceof Error ? err.message : 'Error en consulta' },
          }));
        }
      })();
    }

    return () => { active = false; };
  }, [widgets, dateFrom, dateTo, selectedDateField, customDateField, supervisorFilter, fmFilter, waveFilter]);

  // Drag and drop reordering
  function handleDrop(targetIndex: number) {
    if (draggedIndex === null || draggedIndex === targetIndex) return;
    const copy = [...widgets];
    const [moved] = copy.splice(draggedIndex, 1);
    if (!moved) return;
    copy.splice(targetIndex, 0, moved);
    setWidgets(copy);
    setIsLocalDirty(true);
    setDraggedIndex(null);
    setDragOverIndex(null);
    setNotice('Orden de widgets modificado.');
  }

  // Quick resize widget width
  function handleResizeWidget(id: string, newSpan: number) {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, grid: { ...w.grid, w: newSpan } } : w));
    setIsLocalDirty(true);
  }

  // Drag to resize width (columns 2..12) with click-to-cycle fallback
  function handleStartResizeWidth(e: React.MouseEvent, widgetId: string, currentSpan: number) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedWidgetId(widgetId);

    const startX = e.clientX;
    const gridWidth = gridRef.current?.getBoundingClientRect().width || 1200;
    const colWidth = gridWidth / 12;
    let didMove = false;
    let latestSpan = currentSpan;

    const onMouseMove = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startX;
      if (Math.abs(deltaX) > 4) didMove = true;
      const deltaCols = Math.round(deltaX / colWidth);
      const targetSpan = Math.max(2, Math.min(12, currentSpan + deltaCols));
      if (targetSpan !== latestSpan) {
        latestSpan = targetSpan;
        setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, grid: { ...w.grid, w: targetSpan } } : w));
        setIsLocalDirty(true);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      if (!didMove) {
        const cycle = [3, 4, 6, 8, 12];
        const currIdx = cycle.indexOf(currentSpan);
        const nextSpan = currIdx === -1 || currIdx === cycle.length - 1 ? cycle[0]! : cycle[currIdx + 1]!;
        setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, grid: { ...w.grid, w: nextSpan } } : w));
        setIsLocalDirty(true);
      }
    };

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // Drag to resize height with click-to-cycle fallback
  function handleStartResizeHeight(e: React.MouseEvent, widgetId: string, currentH: number) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedWidgetId(widgetId);

    const startY = e.clientY;
    const rowUnit = 70;
    let didMove = false;
    let latestH = currentH;

    const onMouseMove = (ev: MouseEvent) => {
      const deltaY = ev.clientY - startY;
      if (Math.abs(deltaY) > 4) didMove = true;
      const deltaRows = Math.round(deltaY / rowUnit);
      const targetH = Math.max(2, Math.min(10, currentH + deltaRows));
      if (targetH !== latestH) {
        latestH = targetH;
        setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, grid: { ...w.grid, h: targetH } } : w));
        setIsLocalDirty(true);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      if (!didMove) {
        const cycle = [2, 3, 4, 5];
        const currIdx = cycle.indexOf(currentH);
        const nextH = currIdx === -1 || currIdx === cycle.length - 1 ? cycle[0]! : cycle[currIdx + 1]!;
        setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, grid: { ...w.grid, h: nextH } } : w));
        setIsLocalDirty(true);
      }
    };

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // Drag bottom-right corner to resize both width and height simultaneously
  function handleStartResizeCorner(e: React.MouseEvent, widgetId: string, currentSpan: number, currentH: number) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedWidgetId(widgetId);

    const startX = e.clientX;
    const startY = e.clientY;
    const gridWidth = gridRef.current?.getBoundingClientRect().width || 1200;
    const colWidth = gridWidth / 12;
    const rowUnit = 70;
    let latestSpan = currentSpan;
    let latestH = currentH;

    const onMouseMove = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;
      const deltaCols = Math.round(deltaX / colWidth);
      const deltaRows = Math.round(deltaY / rowUnit);

      const targetSpan = Math.max(2, Math.min(12, currentSpan + deltaCols));
      const targetH = Math.max(2, Math.min(10, currentH + deltaRows));

      if (targetSpan !== latestSpan || targetH !== latestH) {
        latestSpan = targetSpan;
        latestH = targetH;
        setWidgets(prev => prev.map(w => w.id === widgetId ? {
          ...w,
          grid: { ...w.grid, w: targetSpan, h: targetH }
        } : w));
        setIsLocalDirty(true);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // Update widget from sidebar
  function handleUpdateWidget(updated: WidgetDefinition) {
    setWidgets(prev => prev.map(w => w.id === updated.id ? updated : w));
    setIsLocalDirty(true);
    setNotice(`Widget "${updated.title}" actualizado.`);
  }

  // Create new dashboard
  async function handleCreateDashboard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const created = await api('/dashboards', dashboardSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          name: form.get('name'),
          slug: form.get('slug'),
          description: form.get('description') || '',
        }),
      });
      setDashboards(prev => [...prev, created]);
      setActiveDashboardId(created.id);
      setShowCreateModal(false);
      setNotice(`Dashboard "${created.name}" creado con versión borrador.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear dashboard.');
    } finally {
      setBusy(false);
    }
  }

  // Add widget
  function handleAddWidget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const type = form.get('type') as WidgetType;
    const title = String(form.get('title') || 'Widget');
    const kpiVersionId = form.get('kpiVersionId') ? String(form.get('kpiVersionId')) : undefined;
    const dimension = form.get('dimension') ? String(form.get('dimension')) : undefined;
    const textContent = form.get('textContent') ? String(form.get('textContent')) : undefined;
    const colSpan = Number(form.get('colSpan') || 6);

    const newWidget: WidgetDefinition = {
      id: crypto.randomUUID(),
      type,
      title,
      ...(kpiVersionId ? { kpiVersionId } : {}),
      ...(dimension ? { dimension } : {}),
      ...(textContent ? { textContent } : {}),
      grid: {
        x: 0,
        y: widgets.length,
        w: colSpan,
        h: 4,
      },
    };

    setWidgets(prev => [...prev, newWidget]);
    setIsLocalDirty(true);
    setShowAddWidgetModal(false);
    setNotice(`Widget "${title}" agregado al diseño.`);
  }

  // Remove widget
  function handleRemoveWidget(id: string) {
    setWidgets(prev => prev.filter(w => w.id !== id));
    setIsLocalDirty(true);
    setNotice('Widget eliminado del dashboard.');
  }

  const currentGlobalFilters = {
    dateFrom,
    dateTo,
    dateField: selectedDateField === '__custom__' ? customDateField : selectedDateField,
    supervisor: supervisorFilter,
    fm: fmFilter,
    wave: waveFilter,
  };

  // Save version (admin only)
  async function handleSaveVersion() {
    if (!dashboard) return;
    setBusy(true);
    setError('');
    try {
      const ver = await api(`/dashboards/${dashboard.id}/versions`, dashboardVersionSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          title: dashboard.currentVersion?.title || dashboard.name,
          description: dashboard.currentVersion?.description || dashboard.description,
          layout: widgets,
          globalFilters: currentGlobalFilters,
        }),
      });
      setDashboard(prev => prev ? { ...prev, currentVersion: ver } : null);
      setIsLocalDirty(false);
      setNotice(`Versión borrador v${ver.number} guardada exitosamente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar versión.');
    } finally {
      setBusy(false);
    }
  }

  // Publish version (admin only)
  async function handlePublish() {
    if (!dashboard || !dashboard.currentVersion) return;
    setBusy(true);
    setError('');
    try {
      let versionToPublish = dashboard.currentVersion;
      if (isLocalDirty) {
        versionToPublish = await api(`/dashboards/${dashboard.id}/versions`, dashboardVersionSchema, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            title: dashboard.name,
            description: dashboard.description,
            layout: widgets,
            globalFilters: currentGlobalFilters,
          }),
        });
      }

      const published = await api(`/dashboards/${dashboard.id}/publish`, dashboardSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ versionId: versionToPublish.id }),
      });

      setDashboard(published);
      setIsLocalDirty(false);
      setNotice(`Dashboard publicado oficialmente con versión v${versionToPublish.number}. Visible para toda la organización.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al publicar dashboard.');
    } finally {
      setBusy(false);
    }
  }

  // Reset to published version (for non-admins or discarding local tweaks)
  function handleResetPublished() {
    if (!dashboard?.currentVersion) return;
    setWidgets(dashboard.currentVersion.layout);
    const gf = (dashboard.currentVersion.globalFilters || {}) as Record<string, unknown>;
    setDateFrom(typeof gf.dateFrom === 'string' ? gf.dateFrom : '');
    setDateTo(typeof gf.dateTo === 'string' ? gf.dateTo : '');
    if (typeof gf.dateField === 'string') {
      if (['fecha', 'created_at', 'date', 'call_date', 'timestamp'].includes(gf.dateField)) {
        setSelectedDateField(gf.dateField);
        setCustomDateField('');
      } else if (gf.dateField) {
        setSelectedDateField('__custom__');
        setCustomDateField(gf.dateField);
      }
    } else {
      setSelectedDateField('');
      setCustomDateField('');
    }
    setSupervisorFilter(typeof gf.supervisor === 'string' ? gf.supervisor : '');
    setFmFilter(typeof gf.fm === 'string' ? gf.fm : '');
    setWaveFilter(typeof gf.wave === 'string' ? gf.wave : '');

    setIsLocalDirty(false);
    setNotice('Diseño restablecido a la versión oficial publicada.');
  }

  const activeFiltersCount =
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (selectedDateField ? 1 : 0) +
    (supervisorFilter.trim() ? 1 : 0) +
    (fmFilter.trim() ? 1 : 0) +
    (waveFilter.trim() ? 1 : 0);

  function handleClearAllFilters() {
    setDateFrom('');
    setDateTo('');
    setSelectedDateField('');
    setCustomDateField('');
    setSupervisorFilter('');
    setFmFilter('');
    setWaveFilter('');
  }

  // Export current dashboard widget data to CSV
  function handleExportCsv() {
    if (!widgets.length) return;
    const lines: string[] = ['Widget,Tipo,Dimensión,Valor / Resultado'];

    for (const w of widgets) {
      const q = widgetData[w.id];
      if (!q || !q.data) continue;
      if (q.data.rows && q.data.rows.length > 0) {
        for (const row of q.data.rows) {
          const dimVal = w.dimension && row.dimensions ? String(row.dimensions[w.dimension] ?? '') : '';
          const metricVal = String(row.value ?? '');
          lines.push(`"${w.title}","${w.type}","${dimVal}","${metricVal}"`);
        }
      } else {
        lines.push(`"${w.title}","${w.type}","Total","—"`);
      }
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${dashboard?.slug || 'dashboard'}-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Datos del dashboard exportados a CSV.');
  }

  return (
    <>
      <AppHeader session={session} />

      <main id="main" className="workspace" style={{ maxWidth: '1600px', margin: '0 auto', padding: '24px 32px' }}>
        <div className="breadcrumb">
          <span>Espacio de trabajo</span>
          <span style={{ margin: '0 8px', color: 'var(--border-strong)' }}>/</span>
          <span>Dashboards & Visualizaciones</span>
        </div>

        {/* Header and Title */}
        <div className="title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span className="eyebrow secondary">Supervisión Operacional</span>
            <h1 style={{ margin: '4px 0 8px' }}>Dashboards</h1>
            <p className="secondary">
              Paneles visuales en cuadrícula de 12 columnas gobernados por el modelo semántico y métricas publicadas.
            </p>
          </div>
          <div className="actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isAdmin && (
              <button
                className="button primary"
                onClick={() => setShowCreateModal(true)}
                disabled={busy}
              >
                <Plus size={15} />
                Nuevo Dashboard
              </button>
            )}
            <button
              className="button"
              onClick={handleExportCsv}
              disabled={busy || !widgets.length}
            >
              <Download size={14} />
              Exportar CSV
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="form-error" style={{ marginBottom: '16px' }}>
            <p>{error}</p>
          </div>
        )}

        {notice && (
          <div role="status" className="notice-banner" style={{ background: 'var(--surface)', padding: '10px 16px', borderLeft: '3px solid var(--accent)', margin: '16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} style={{ color: 'var(--positive)' }} />
            <span>{notice}</span>
          </div>
        )}

        {/* Dashboard Tabs / Selector */}
        {dashboards.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '20px', overflowX: 'auto' }}>
            {dashboards.map(d => (
              <button
                key={d.id}
                onClick={() => setActiveDashboardId(d.id)}
                className={`button ${activeDashboardId === d.id ? 'primary' : ''}`}
                style={{ height: '36px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                <LayoutDashboard size={14} />
                <span>{d.name}</span>
                {d.currentVersionId ? (
                  <span className="badge positive" style={{ fontSize: '10px', padding: '1px 5px' }}>Publicado</span>
                ) : (
                  <span className="badge" style={{ fontSize: '10px', padding: '1px 5px', color: 'var(--warning)' }}>Borrador</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Active Dashboard Bar and Controls */}
        {dashboard && (
          <section className="panel" style={{ padding: '16px 20px', marginBottom: '24px', background: 'var(--surface)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ fontSize: '20px', margin: 0 }}>{dashboard.name}</h2>
                  {dashboard.currentVersion ? (
                    <span className="badge" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                      v{dashboard.currentVersion.number} · {dashboard.currentVersionId ? 'Oficial publicado' : 'Borrador'}
                    </span>
                  ) : null}
                  {isLocalDirty && (
                    <span className="badge" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>
                      Modificado localmente
                    </span>
                  )}
                </div>
                {dashboard.description && (
                  <p className="secondary" style={{ margin: '4px 0 0', fontSize: '13px' }}>{dashboard.description}</p>
                )}
              </div>

              {/* Admin Save & Publish Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {isAdmin ? (
                  <>
                    <button
                      className="button"
                      onClick={() => setShowAddWidgetModal(true)}
                      disabled={busy}
                    >
                      <Plus size={14} />
                      Agregar Widget
                    </button>
                    <button
                      className="button"
                      onClick={() => void handleSaveVersion()}
                      disabled={busy || !isLocalDirty}
                    >
                      Guardar borrador
                    </button>
                    {canPublish && (
                      <button
                        className="button primary"
                        onClick={() => void handlePublish()}
                        disabled={busy}
                      >
                        Publicar dashboard
                      </button>
                    )}
                  </>
                ) : (
                  isLocalDirty && (
                    <button
                      className="button"
                      onClick={handleResetPublished}
                    >
                      <RotateCcw size={14} />
                      Restablecer diseño publicado
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Operational and Date Filter Toolbar */}
            <div
              style={{
                marginTop: '14px',
                paddingTop: '12px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {/* Date Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', background: 'var(--background)', padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                  <CalendarDays size={14} className="secondary" />
                  <span style={{ fontWeight: 500, marginRight: '2px' }}>Rango:</span>
                  <label htmlFor="dash-date-from" className="secondary">Desde:</label>
                  <input
                    id="dash-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    style={{ padding: '2px 6px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px' }}
                  />
                  <label htmlFor="dash-date-to" className="secondary">Hasta:</label>
                  <input
                    id="dash-date-to"
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    style={{ padding: '2px 6px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px' }}
                  />

                  {/* Date Column Selector */}
                  <span style={{ color: 'var(--border-strong)', margin: '0 4px' }}>|</span>
                  <label htmlFor="dash-date-col" className="secondary" title="Columna utilizada para filtrar fechas en los datasets">Columna:</label>
                  <select
                    id="dash-date-col"
                    value={selectedDateField}
                    onChange={e => setSelectedDateField(e.target.value)}
                    style={{ padding: '2px 8px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)' }}
                  >
                    <option value="">Auto (detectar fecha)</option>
                    {availableDateFields.map(f => (
                      <option key={f} value={f}>{f} (detectada)</option>
                    ))}
                    <option value="fecha">fecha</option>
                    <option value="created_at">created_at</option>
                    <option value="date">date</option>
                    <option value="call_date">call_date</option>
                    <option value="timestamp">timestamp</option>
                    <option value="__custom__">Personalizada…</option>
                  </select>
                  {selectedDateField === '__custom__' && (
                    <input
                      placeholder="nombre de columna"
                      value={customDateField}
                      onChange={e => setCustomDateField(e.target.value)}
                      style={{ padding: '2px 6px', fontSize: '12px', width: '130px', border: '1px solid var(--border)', borderRadius: '4px' }}
                    />
                  )}
                </div>

                {/* Operational Filters: Supervisor, FM, Wave */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', background: 'var(--background)', padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                  <SlidersHorizontal size={14} className="secondary" />
                  <span style={{ fontWeight: 500, marginRight: '2px' }}>Operación:</span>

                  {/* Supervisor Dropdown */}
                  <label htmlFor="dash-filter-supervisor" className="secondary">Supervisor:</label>
                  {availableSupervisors.length > 0 ? (
                    <select
                      id="dash-filter-supervisor"
                      value={supervisorFilter}
                      onChange={e => setSupervisorFilter(e.target.value)}
                      style={{ padding: '2px 8px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)', maxWidth: '170px' }}
                    >
                      <option value="">Todos los supervisores</option>
                      {availableSupervisors.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="dash-filter-supervisor"
                      placeholder="Todos / Nombre"
                      value={supervisorFilter}
                      onChange={e => setSupervisorFilter(e.target.value)}
                      style={{ padding: '2px 6px', fontSize: '12px', width: '110px', border: '1px solid var(--border)', borderRadius: '4px' }}
                    />
                  )}

                  {/* FM (Floor Manager) Dropdown */}
                  <label htmlFor="dash-filter-fm" className="secondary">FM:</label>
                  {availableFms.length > 0 ? (
                    <select
                      id="dash-filter-fm"
                      value={fmFilter}
                      onChange={e => setFmFilter(e.target.value)}
                      style={{ padding: '2px 8px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)', maxWidth: '160px' }}
                    >
                      <option value="">Todos los FM</option>
                      {availableFms.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="dash-filter-fm"
                      placeholder="Todos / Nombre"
                      value={fmFilter}
                      onChange={e => setFmFilter(e.target.value)}
                      style={{ padding: '2px 6px', fontSize: '12px', width: '100px', border: '1px solid var(--border)', borderRadius: '4px' }}
                    />
                  )}

                  {/* Wave Dropdown */}
                  <label htmlFor="dash-filter-wave" className="secondary">Wave:</label>
                  {availableWaves.length > 0 ? (
                    <select
                      id="dash-filter-wave"
                      value={waveFilter}
                      onChange={e => setWaveFilter(e.target.value)}
                      style={{ padding: '2px 8px', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)', minWidth: '95px' }}
                    >
                      <option value="">Todas las waves</option>
                      {availableWaves.map(w => (
                        <option key={w} value={w}>{w.toLowerCase().startsWith('wave') ? w : `Wave ${w}`}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="dash-filter-wave"
                      placeholder="Ej. Wave 1"
                      value={waveFilter}
                      onChange={e => setWaveFilter(e.target.value)}
                      style={{ padding: '2px 6px', fontSize: '12px', width: '85px', border: '1px solid var(--border)', borderRadius: '4px' }}
                    />
                  )}
                </div>
              </div>

              {/* Active filters summary & Clear button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {activeFiltersCount > 0 && (
                  <>
                    <span className="badge" style={{ fontSize: '11px', background: 'rgba(54, 92, 74, 0.1)', color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                      {activeFiltersCount} filtro{activeFiltersCount > 1 ? 's' : ''} activo{activeFiltersCount > 1 ? 's' : ''}
                    </span>
                    <button
                      className="button"
                      style={{ padding: '2px 8px', height: '26px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      onClick={handleClearAllFilters}
                      title="Limpiar todos los filtros"
                    >
                      <RotateCcw size={12} />
                      Limpiar filtros
                    </button>
                  </>
                )}
              </div>
            </div>

            {!isAdmin && (
              <p className="secondary" style={{ fontSize: '11px', margin: '12px 0 0', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                <ShieldCheck size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                Modo visualización · Cualquier ajuste de filtros o disposición es temporal de esta sesión y no altera el diseño oficial.
              </p>
            )}
          </section>
        )}

        {/* 12-Column Responsive Grid Layout for Widgets */}
        {dashboard && (
          <div
            ref={gridRef}
            onClick={() => setSelectedWidgetId(null)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
              gap: '16px',
            }}
          >
            {widgets.map((widget, index) => {
              const q = widgetData[widget.id];
              const kpiDef = kpis.find(k => k.id === widget.kpiVersionId);
              const viewMode = chartViewMode[widget.id] || 'chart';
              const colSpan = widget.grid.w || 6;
              const cardH = widget.grid.h || 3;
              const isSelected = selectedWidgetId === widget.id || editingWidget?.id === widget.id;
              const isHovered = hoveredWidgetId === widget.id;
              const showChrome = isSelected || isHovered;
              const chartHeight = Math.max(180, (cardH * 75) - 95);
              const firstRow = q?.data?.rows?.[0];
              const singleVal = firstRow ? firstRow.value : null;

              // Target line and color
              const widgetColor = widget.config?.color;
              const showTargetLine = Boolean(widget.config?.showTargetLine);
              const targetVal = widget.config?.targetLineValue ?? kpiDef?.targets.target;
              const targetLbl = widget.config?.targetLineLabel;

              return (
                <article
                  key={widget.id}
                  className="panel dashboard-widget"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedWidgetId(widget.id);
                  }}
                  onMouseEnter={() => setHoveredWidgetId(widget.id)}
                  onMouseLeave={() => {
                    if (hoveredWidgetId === widget.id) setHoveredWidgetId(null);
                  }}
                  draggable={isAdmin}
                  onDragStart={e => {
                    setDraggedIndex(index);
                    e.dataTransfer.setData('text/plain', String(index));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverIndex !== index) setDragOverIndex(index);
                  }}
                  onDragLeave={() => {
                    if (dragOverIndex === index) setDragOverIndex(null);
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    handleDrop(index);
                  }}
                  onDragEnd={() => {
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                  style={{
                    gridColumn: `span ${colSpan}`,
                    minHeight: `${cardH * 75}px`,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    borderRadius: '3px',
                    boxShadow: showChrome
                      ? '0 0 0 1px var(--accent), 0 3px 12px rgba(54, 92, 74, 0.12)'
                      : '0 1px 3px rgba(0,0,0,0.04)',
                    background: 'var(--surface)',
                    opacity: draggedIndex === index ? 0.35 : 1,
                    border: dragOverIndex === index
                      ? '2px dashed var(--accent)'
                      : showChrome
                      ? '1.5px solid var(--accent)'
                      : '1px solid var(--border)',
                    transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.15s',
                    position: 'relative',
                  }}
                >
                  {/* Widget Card Header */}
                  <div
                    style={{
                      padding: '12px 16px 10px',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'var(--surface)',
                      borderTopLeftRadius: '3px',
                      borderTopRightRadius: '3px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      {isAdmin && (
                        <span
                          style={{ cursor: 'grab', color: 'var(--secondary)', display: 'flex', alignItems: 'center', padding: '2px' }}
                          title="Arrastrar para reordenar"
                        >
                          <GripVertical size={14} />
                        </span>
                      )}
                      <div
                        style={{ cursor: 'pointer', minWidth: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWidgetId(widget.id);
                          setEditingWidget(widget);
                        }}
                        title="Hacer clic para configurar este widget"
                      >
                        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {widget.title}
                        </h3>
                        {kpiDef && (
                          <span className="secondary" style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace' }}>
                            KPI: {kpiDef.slug} ({kpiDef.unit})
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      {/* Accessible table vs chart toggle */}
                      {['line_chart', 'bar_chart', 'area_chart'].includes(widget.type) && (
                        <button
                          type="button"
                          className="button"
                          style={{ height: '26px', padding: '0 8px', fontSize: '11px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setChartViewMode(prev => ({
                              ...prev,
                              [widget.id]: viewMode === 'chart' ? 'table' : 'chart',
                            }));
                          }}
                          title={viewMode === 'chart' ? 'Ver tabla de datos accesible' : 'Ver gráfica visual'}
                        >
                          {viewMode === 'chart' ? <TableIcon size={12} /> : <TrendingUp size={12} />}
                          <span>{viewMode === 'chart' ? 'Tabla' : 'Gráfica'}</span>
                        </button>
                      )}

                      {/* Quick resize span buttons for admin */}
                      {isAdmin && (
                        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                          {[3, 4, 6, 8, 12].map(span => (
                            <button
                              key={span}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResizeWidget(widget.id, span);
                              }}
                              style={{
                                padding: '2px 6px',
                                fontSize: '10px',
                                border: 'none',
                                background: colSpan === span ? 'var(--accent)' : 'var(--surface)',
                                color: colSpan === span ? 'var(--on-accent)' : 'var(--secondary)',
                                cursor: 'pointer',
                                fontWeight: colSpan === span ? 600 : 400,
                              }}
                              title={`Ajustar a ${span} columnas (${Math.round((span / 12) * 100)}%)`}
                            >
                              {span === 12 ? '100%' : span === 6 ? '50%' : span === 4 ? '33%' : span === 3 ? '25%' : '66%'}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Settings button */}
                      <button
                        type="button"
                        className="icon-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWidgetId(widget.id);
                          setEditingWidget(widget);
                        }}
                        title="Configurar widget (datos, colores, metas, fórmulas)"
                        style={{ padding: '4px' }}
                      >
                        <SlidersHorizontal size={14} />
                      </button>

                      {/* Delete button */}
                      {isAdmin && (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveWidget(widget.id);
                          }}
                          style={{ padding: '4px', color: 'var(--secondary)' }}
                          title="Eliminar widget"
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--negative)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--secondary)')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Widget Body */}
                  <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {q?.loading ? (
                      <p className="secondary" style={{ fontSize: '12px', textAlign: 'center', padding: '20px' }}>
                        Calculando métricas del modelo semántico…
                      </p>
                    ) : q?.error ? (
                      <div style={{ padding: '12px', background: 'rgba(154,67,61,0.08)', borderRadius: '3px', color: 'var(--negative)', fontSize: '12px' }}>
                        <AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />
                        {q.error}
                      </div>
                    ) : widget.type === 'kpi_card' ? (
                      /* KPI Card Rendering */
                      <div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                          <span
                            className="kpi-value"
                            style={{
                              fontSize: '38px',
                              lineHeight: 1.1,
                              fontFamily: 'var(--serif)',
                              letterSpacing: '-1px',
                              color: widgetColor || 'var(--ink)',
                            }}
                          >
                            {singleVal !== null && singleVal !== undefined
                              ? !Number.isNaN(Number(singleVal))
                                ? Number(singleVal).toLocaleString(undefined, { maximumFractionDigits: 2 })
                                : singleVal
                              : '—'}
                          </span>
                          <span className="secondary" style={{ fontSize: '16px' }}>{kpiDef?.unit ?? ''}</span>
                        </div>

                        {/* Target badge evaluation */}
                        {q?.data?.targetEvaluation && (
                          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              className="badge"
                              style={{
                                color: q.data.targetEvaluation.status === 'good'
                                  ? 'var(--positive)'
                                  : q.data.targetEvaluation.status === 'warning'
                                  ? 'var(--warning)'
                                  : 'var(--negative)',
                                borderColor: 'currentColor',
                                fontSize: '11px',
                                fontWeight: 500,
                              }}
                            >
                              {q.data.targetEvaluation.status === 'good' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                              {q.data.targetEvaluation.status === 'good' ? 'Meta Cumplida' : q.data.targetEvaluation.status === 'warning' ? 'En Riesgo' : 'Bajo Umbral'}
                            </span>
                            {q.data.targetEvaluation.target !== null && q.data.targetEvaluation.target !== undefined && (
                              <span className="secondary" style={{ fontSize: '11px' }}>
                                (Meta: {q.data.targetEvaluation.target} {kpiDef?.unit})
                              </span>
                            )}
                          </div>
                        )}

                        <div className="kpi-baseline" style={{ marginTop: '16px', paddingTop: '10px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--secondary)' }}>
                          <span>Versión: v{kpiDef?.number ?? 1}</span>
                          <span>{q?.data?.cacheHit ? 'Caché semántica activa' : 'Consulta calculada'}</span>
                        </div>
                      </div>
                    ) : ['line_chart', 'bar_chart', 'area_chart'].includes(widget.type) ? (
                      /* Chart or Accessible Table */
                      <div>
                        {viewMode === 'chart' ? (
                          <WidgetChart
                            type={widget.type as 'line_chart' | 'bar_chart' | 'area_chart'}
                            title={widget.title}
                            categories={(q?.data?.rows ?? []).map(r => String(widget.dimension && r.dimensions ? r.dimensions[widget.dimension] ?? 'Métrica' : 'Métrica'))}
                            data={(q?.data?.rows ?? []).map(r => Number(r.value || 0))}
                            unit={kpiDef?.unit}
                            color={widgetColor}
                            showTarget={showTargetLine}
                            targetLine={targetVal}
                            targetLabel={targetLbl}
                            height={chartHeight}
                          />
                        ) : (
                          /* Accessible table representation */
                          <div className="table-scroll" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>{widget.dimension || 'Categoría'}</th>
                                  <th style={{ textAlign: 'right' }}>Valor ({kpiDef?.unit || ''})</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(q?.data?.rows ?? []).map((row, idx) => (
                                  <tr key={idx}>
                                    <td>{String(widget.dimension && row.dimensions ? row.dimensions[widget.dimension] ?? `Registro ${idx + 1}` : `Registro ${idx + 1}`)}</td>
                                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                      {row.value !== null && !Number.isNaN(Number(row.value))
                                        ? Number(row.value).toLocaleString()
                                        : String(row.value ?? '—')}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : widget.type === 'table' ? (
                      /* Table Widget with Computed Column and Conditional Formatting */
                      (() => {
                        const compCfg = widget.config?.computedColumn;
                        const condCfg = widget.config?.conditionalFormatting;

                        return (
                          <div className="table-scroll" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>{widget.dimension || 'Dimensión'}</th>
                                  <th style={{ textAlign: 'right' }}>Resultado ({kpiDef?.unit || ''})</th>
                                  {compCfg?.enabled && (
                                    <th style={{ textAlign: 'right', color: 'var(--accent)' }}>
                                      {compCfg.name || 'Calculada'}
                                    </th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {(q?.data?.rows ?? []).map((row, idx) => {
                                  const rawNum = row.value !== null && !Number.isNaN(Number(row.value)) ? Number(row.value) : null;
                                  const baseTarget = widget.config?.targetLineValue ?? kpiDef?.targets.target ?? 1;

                                  // Calculate computed column
                                  let compVal: string = '—';
                                  if (rawNum !== null && compCfg?.enabled) {
                                    if (compCfg.calculationType === 'percent_of_target') {
                                      compVal = `${((rawNum / (baseTarget || 1)) * 100).toFixed(1)}%`;
                                    } else if (compCfg.calculationType === 'diff_from_target') {
                                      const diff = rawNum - baseTarget;
                                      compVal = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`;
                                    } else if (compCfg.calculationType === 'multiply_100') {
                                      compVal = `${(rawNum * 100).toFixed(1)}%`;
                                    } else if (compCfg.calculationType === 'custom') {
                                      compVal = (rawNum * (compCfg.customMultiplier ?? 1)).toFixed(2);
                                    }
                                  }

                                  // Conditional formatting evaluation
                                  let isGreen = false;
                                  let isRed = false;
                                  if (rawNum !== null && condCfg?.enabled) {
                                    if (condCfg.greenThreshold !== undefined && rawNum >= condCfg.greenThreshold) {
                                      isGreen = true;
                                    } else if (condCfg.redThreshold !== undefined && rawNum <= condCfg.redThreshold) {
                                      isRed = true;
                                    }
                                  }

                                  const cellStyle: React.CSSProperties = {
                                    textAlign: 'right',
                                    fontVariantNumeric: 'tabular-nums',
                                    background: isGreen && condCfg?.mode === 'background' ? 'rgba(57, 112, 82, 0.14)' : isRed && condCfg?.mode === 'background' ? 'rgba(154, 67, 61, 0.14)' : undefined,
                                  };

                                  return (
                                    <tr key={idx}>
                                      <td>{String(widget.dimension && row.dimensions ? row.dimensions[widget.dimension] ?? `Fila ${idx + 1}` : `Fila ${idx + 1}`)}</td>
                                      <td style={cellStyle}>
                                        {condCfg?.enabled && condCfg.mode === 'badge' ? (
                                          <span
                                            className="badge"
                                            style={{
                                              color: isGreen ? 'var(--positive)' : isRed ? 'var(--negative)' : 'inherit',
                                              borderColor: isGreen ? 'var(--positive)' : isRed ? 'var(--negative)' : 'var(--border)',
                                              padding: '1px 6px',
                                              fontSize: '11px',
                                            }}
                                          >
                                            {isGreen ? <Check size={10} /> : isRed ? <AlertTriangle size={10} /> : null}
                                            {rawNum !== null ? rawNum.toLocaleString() : String(row.value ?? '—')}
                                          </span>
                                        ) : condCfg?.enabled && condCfg.mode === 'bar' && rawNum !== null ? (
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                                            <span>{rawNum.toLocaleString()}</span>
                                            <div style={{ width: '40px', height: '6px', background: 'var(--surface-muted)', borderRadius: '2px', overflow: 'hidden' }}>
                                              <div
                                                style={{
                                                  width: `${Math.min(100, Math.max(0, (rawNum / (baseTarget || 1)) * 100))}%`,
                                                  height: '100%',
                                                  background: isGreen ? 'var(--positive)' : isRed ? 'var(--negative)' : 'var(--accent)',
                                                }}
                                              />
                                            </div>
                                          </div>
                                        ) : (
                                          rawNum !== null ? rawNum.toLocaleString() : String(row.value ?? '—')
                                        )}
                                      </td>
                                      {compCfg?.enabled && (
                                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--accent)' }}>
                                          {compVal}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()
                    ) : widget.type === 'text' ? (
                      /* Text commentary widget */
                      <div style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--ink)' }}>
                        {widget.textContent || 'Sin anotaciones registradas.'}
                      </div>
                    ) : null}
                  </div>

                  {/* Quick bottom edit link */}
                  <div
                    style={{
                      padding: '4px 12px',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '10px',
                      color: 'var(--secondary)',
                      background: 'var(--surface-muted)',
                    }}
                  >
                    <span>{colSpan}/12 col {showTargetLine && targetVal !== undefined ? `· Meta: ${targetVal}` : ''}</span>
                    <button
                      className="text-button"
                      style={{ fontSize: '10px' }}
                      onClick={() => setEditingWidget(widget)}
                    >
                      Personalizar widget ↗
                    </button>
                  </div>

                  {/* Tiradores interactivos sobrios (acorde a design.md) */}
                  {showChrome && (
                    <>
                      {/* Tirador Lateral Derecho (ancho de columnas) */}
                      <div
                        role="slider"
                        aria-label="Ajustar ancho de columnas"
                        aria-valuenow={colSpan}
                        aria-valuemin={2}
                        aria-valuemax={12}
                        title={`Arrastrar para ajustar ancho (${colSpan}/12 cols) o clic para ciclar`}
                        onMouseDown={(e) => handleStartResizeWidth(e, widget.id, colSpan)}
                        style={{
                          position: 'absolute',
                          right: '-4px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: '7px',
                          height: '28px',
                          backgroundColor: 'var(--surface)',
                          border: '1.5px solid var(--accent)',
                          borderRadius: '9999px',
                          cursor: 'ew-resize',
                          boxShadow: '0 1px 4px rgba(29, 29, 27, 0.2)',
                          zIndex: 35,
                          transition: 'transform 0.12s ease, background-color 0.12s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-50%) scale(1.15)';
                          e.currentTarget.style.backgroundColor = 'var(--surface-muted)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                          e.currentTarget.style.backgroundColor = 'var(--surface)';
                        }}
                      />

                      {/* Tirador Inferior (altura) */}
                      <div
                        role="slider"
                        aria-label="Ajustar altura de widget"
                        aria-valuenow={cardH}
                        aria-valuemin={2}
                        aria-valuemax={12}
                        title="Arrastrar para ajustar altura o clic para ciclar"
                        onMouseDown={(e) => handleStartResizeHeight(e, widget.id, cardH)}
                        style={{
                          position: 'absolute',
                          bottom: '-4px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: '28px',
                          height: '7px',
                          backgroundColor: 'var(--surface)',
                          border: '1.5px solid var(--accent)',
                          borderRadius: '9999px',
                          cursor: 'ns-resize',
                          boxShadow: '0 1px 4px rgba(29, 29, 27, 0.2)',
                          zIndex: 35,
                          transition: 'transform 0.12s ease, background-color 0.12s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateX(-50%) scale(1.15)';
                          e.currentTarget.style.backgroundColor = 'var(--surface-muted)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
                          e.currentTarget.style.backgroundColor = 'var(--surface)';
                        }}
                      />

                      {/* Tirador Esquina Inferior Derecha (ancho y altura simultáneos) */}
                      <div
                        role="slider"
                        aria-label="Redimensionar ancho y altura simultáneamente"
                        title="Arrastrar esquina para redimensionar en 2D"
                        onMouseDown={(e) => handleStartResizeCorner(e, widget.id, colSpan, cardH)}
                        style={{
                          position: 'absolute',
                          right: '-5px',
                          bottom: '-5px',
                          width: '10px',
                          height: '10px',
                          backgroundColor: 'var(--surface)',
                          border: '1.5px solid var(--accent)',
                          borderRadius: '50%',
                          cursor: 'nwse-resize',
                          boxShadow: '0 1px 4px rgba(29, 29, 27, 0.2)',
                          zIndex: 36,
                          transition: 'transform 0.12s ease, background-color 0.12s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.2)';
                          e.currentTarget.style.backgroundColor = 'var(--surface-muted)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'var(--surface)';
                        }}
                      />
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {/* Empty state if no widgets */}
        {dashboard && widgets.length === 0 && (
          <section className="empty" style={{ marginTop: '32px', padding: '48px 24px', textAlign: 'center', background: 'var(--surface)', border: '1px dashed var(--border)' }}>
            <LayoutDashboard size={36} style={{ color: 'var(--secondary)', marginBottom: '12px' }} />
            <h2 style={{ fontSize: '20px', margin: '0 0 6px' }}>Dashboard sin widgets configurados</h2>
            <p className="secondary" style={{ maxWidth: '500px', margin: '0 auto 18px', fontSize: '13px' }}>
              Comienza armando tu panel agregando tarjetas KPI, tendencias temporales o tablas de desempeño desglosadas por equipo o agente.
            </p>
            {isAdmin && (
              <button className="button primary" onClick={() => setShowAddWidgetModal(true)}>
                <Plus size={15} />
                Agregar primer widget
              </button>
            )}
          </section>
        )}

        {/* Empty state if no dashboards created */}
        {dashboards.length === 0 && (
          <section className="empty" style={{ marginTop: '32px', padding: '48px 24px', textAlign: 'center', background: 'var(--surface)', border: '1px dashed var(--border)' }}>
            <LayoutDashboard size={40} style={{ color: 'var(--accent)', marginBottom: '16px' }} />
            <h2 style={{ fontSize: '22px', margin: '0 0 8px' }}>Tu primer dashboard operacional</h2>
            <p className="secondary" style={{ maxWidth: '560px', margin: '0 auto 20px', fontSize: '14px' }}>
              ATLAS permite crear paneles 100% integrados con tus datasets y KPIs. Crea tu primer dashboard para visualizar los resultados de tu operación en tiempo real.
            </p>
            {isAdmin ? (
              <button className="button primary" onClick={() => setShowCreateModal(true)}>
                <Plus size={15} />
                Crear Dashboard
              </button>
            ) : (
              <p className="secondary">Un administrador debe crear el primer dashboard de la organización.</p>
            )}
          </section>
        )}
      </main>

      {/* Sidebar: Widget Properties Editor */}
      <WidgetConfigSidebar
        widget={editingWidget}
        kpis={kpis}
        isOpen={editingWidget !== null}
        onClose={() => setEditingWidget(null)}
        onUpdate={handleUpdateWidget}
        onDelete={handleRemoveWidget}
      />

      {/* Modal: Create Dashboard */}
      <Dialog.Root open={showCreateModal} onOpenChange={setShowCreateModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <Dialog.Title className="dialog-title" style={{ margin: 0 }}>Crear nuevo Dashboard</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="Cerrar">
                <X size={16} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="secondary" style={{ fontSize: '13px', marginBottom: '16px' }}>
              Define el nombre y clave única del dashboard. Se creará una versión borrador inicial.
            </Dialog.Description>

            <form onSubmit={e => { void handleCreateDashboard(e); }}>
              <div className="field" style={{ marginBottom: '14px' }}>
                <label htmlFor="dash-name">Nombre del Dashboard</label>
                <input id="dash-name" name="name" required minLength={2} maxLength={120} placeholder="Ej. Operaciones y Ventas" />
              </div>

              <div className="field" style={{ marginBottom: '14px' }}>
                <label htmlFor="dash-slug">Identificador (slug)</label>
                <input id="dash-slug" name="slug" required pattern="^[a-z][a-z0-9_]{1,62}$" placeholder="Ej. operaciones_ventas" />
                <small className="secondary" style={{ fontSize: '11px' }}>Solo minúsculas, números y guion bajo.</small>
              </div>

              <div className="field" style={{ marginBottom: '20px' }}>
                <label htmlFor="dash-desc">Descripción (opcional)</label>
                <textarea id="dash-desc" name="description" rows={3} placeholder="Objetivo de este panel…" style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="button" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="button primary" disabled={busy}>
                  {busy ? 'Creando…' : 'Crear Dashboard'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal: Add Widget */}
      <Dialog.Root open={showAddWidgetModal} onOpenChange={setShowAddWidgetModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content" style={{ maxWidth: '540px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <Dialog.Title className="dialog-title" style={{ margin: 0 }}>Agregar Widget al Dashboard</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="Cerrar">
                <X size={16} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="secondary" style={{ fontSize: '13px', marginBottom: '16px' }}>
              Elige el tipo de componente visual y el KPI del modelo semántico al que estará vinculado.
            </Dialog.Description>

            <form onSubmit={handleAddWidget}>
              <div className="field" style={{ marginBottom: '14px' }}>
                <label htmlFor="w-title">Título del Widget</label>
                <input id="w-title" name="title" required minLength={1} maxLength={120} placeholder="Ej. Nivel de Servicio Semanal" />
              </div>

              <div className="field" style={{ marginBottom: '14px' }}>
                <label htmlFor="w-type">Tipo de Componente</label>
                <select id="w-type" name="type" defaultValue="kpi_card" required>
                  <option value="kpi_card">Tarjeta KPI (Número grande y meta)</option>
                  <option value="line_chart">Gráfico de Líneas (Tendencia temporal)</option>
                  <option value="area_chart">Gráfico de Área (Volumen acumulado)</option>
                  <option value="bar_chart">Gráfico de Barras (Comparativa)</option>
                  <option value="table">Tabla Detallada</option>
                  <option value="text">Anotación / Texto informativo</option>
                </select>
              </div>

              <div className="field" style={{ marginBottom: '14px' }}>
                <label htmlFor="w-kpi">KPI Asociado (Modelo semántico)</label>
                <select
                  id="w-kpi"
                  name="kpiVersionId"
                  value={selectedKpiId}
                  onChange={e => {
                    const id = e.target.value;
                    setSelectedKpiId(id);
                    const k = kpis.find(item => item.id === id);
                    if (k && k.dimensions.length > 0) {
                      setSelectedDim(k.dimensions[0] ?? '');
                    } else {
                      setSelectedDim('');
                    }
                  }}
                >
                  <option value="">Sin KPI (Solo texto o anotación)</option>
                  {kpis.map(k => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.slug}) · {k.unit} {k.deprecatedAt ? '· [Deprecado]' : !k.publishedAt ? '· [Borrador]' : '· [Publicado]'}
                    </option>
                  ))}
                </select>
                {kpis.length === 0 ? (
                  <p className="secondary" style={{ fontSize: '12px', marginTop: '6px' }}>
                    No hay KPIs disponibles. Puedes crearlos en <a href="/app/kpis" style={{ textDecoration: 'underline', color: 'var(--accent)' }}>KPIs & Semántica</a>.
                  </p>
                ) : (
                  <small className="secondary" style={{ fontSize: '11px' }}>
                    {kpis.find(k => k.id === selectedKpiId)
                      ? `Fórmula: ${kpis.find(k => k.id === selectedKpiId)?.formula} | Unidad: ${kpis.find(k => k.id === selectedKpiId)?.unit}`
                      : 'Selecciona un KPI para calcular datos.'}
                  </small>
                )}
              </div>

              <div className="field" style={{ marginBottom: '14px' }}>
                <label htmlFor="w-dim">Dimensión de Desglose (opcional)</label>
                {(() => {
                  const selectedKpi = kpis.find(k => k.id === selectedKpiId);
                  if (selectedKpi && selectedKpi.dimensions.length > 0) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <select
                          id="w-dim-select"
                          value={selectedDim}
                          onChange={e => setSelectedDim(e.target.value)}
                        >
                          <option value="">Total general (sin desglose)</option>
                          {selectedKpi.dimensions.map(d => (
                            <option key={d} value={d}>
                              {d} {d === 'day' ? '(Fecha / Tendencia diaria)' : ''}
                            </option>
                          ))}
                          <option value="__custom__">Otro campo personalizado…</option>
                        </select>
                        {selectedDim === '__custom__' && (
                          <input
                            placeholder="Nombre exacto del campo de agrupación"
                            value={customDim}
                            onChange={e => setCustomDim(e.target.value)}
                            style={{ marginTop: '4px' }}
                          />
                        )}
                        <input
                          type="hidden"
                          name="dimension"
                          value={selectedDim === '__custom__' ? customDim : selectedDim}
                        />
                      </div>
                    );
                  }
                  return (
                    <input id="w-dim" name="dimension" placeholder="Ej. day, agent, queue, status" />
                  );
                })()}
                <small className="secondary" style={{ fontSize: '11px' }}>Campo por el cual agrupar los datos del gráfico o tabla (ej. day para series temporales).</small>
              </div>

              <div className="field" style={{ marginBottom: '14px' }}>
                <label htmlFor="w-span">Ancho en cuadrícula (12 columnas)</label>
                <select id="w-span" name="colSpan" defaultValue="6">
                  <option value="3">3 Columnas (25% del ancho)</option>
                  <option value="4">4 Columnas (33% del ancho)</option>
                  <option value="6">6 Columnas (50% del ancho)</option>
                  <option value="8">8 Columnas (66% del ancho)</option>
                  <option value="12">12 Columnas (100% del ancho completo)</option>
                </select>
              </div>

              <div className="field" style={{ marginBottom: '20px' }}>
                <label htmlFor="w-text">Texto de comentario (solo tipo texto)</label>
                <textarea id="w-text" name="textContent" rows={2} placeholder="Notas operacionales o descripción…" style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="button" onClick={() => setShowAddWidgetModal(false)}>Cancelar</button>
                <button type="submit" className="button primary">Agregar Widget</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
