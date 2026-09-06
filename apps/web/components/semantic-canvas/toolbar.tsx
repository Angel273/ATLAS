'use client';
import { useRef } from 'react';
import {
  Layers,
  Database,
  Activity,
  Maximize2,
  Download,
  Upload,
  Plus,
  Play,
  LayoutGrid,
} from 'lucide-react';
import type { CanvasLayer } from './types';

interface CanvasToolbarProps {
  layer: CanvasLayer;
  onLayerChange: (layer: CanvasLayer) => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onOpenNewKpi: () => void;
  onOpenSimulator: () => void;
  onExportJson: () => void;
  onImportJson: (json: string) => void;
  canManage: boolean;
  totalDatasets: number;
  totalKpis: number;
  totalRelationships: number;
}

export function CanvasToolbar({
  layer,
  onLayerChange,
  onAutoLayout,
  onFitView,
  onOpenNewKpi,
  onOpenSimulator,
  onExportJson,
  onImportJson,
  canManage,
  totalDatasets,
  totalKpis,
  totalRelationships,
}: CanvasToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        onImportJson(content);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        right: 16,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        pointerEvents: 'none',
      }}
    >
      {/* Left controls: Layers & Layout */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--surface)',
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          boxShadow: '0 4px 12px rgba(29, 29, 27, 0.08)',
          pointerEvents: 'all',
        }}
      >
        {/* Layer Selector */}
        <div style={{ display: 'flex', background: 'var(--canvas)', padding: 2, borderRadius: 4, gap: 2 }}>
          <button
            type="button"
            onClick={() => onLayerChange('all')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              padding: '4px 8px',
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: layer === 'all' ? 'var(--accent)' : 'transparent',
              color: layer === 'all' ? 'var(--on-accent)' : 'var(--ink)',
              fontWeight: layer === 'all' ? 600 : 400,
            }}
            title="Mostrar Datasets, Relaciones y Dependencias de KPIs"
          >
            <Layers size={13} /> Todo ({totalDatasets + totalKpis})
          </button>
          <button
            type="button"
            onClick={() => onLayerChange('erd')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              padding: '4px 8px',
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: layer === 'erd' ? 'var(--accent)' : 'transparent',
              color: layer === 'erd' ? 'var(--on-accent)' : 'var(--ink)',
              fontWeight: layer === 'erd' ? 600 : 400,
            }}
            title="Solo tablas y relaciones semánticas de datasets"
          >
            <Database size={13} /> Datasets ({totalDatasets})
          </button>
          <button
            type="button"
            onClick={() => onLayerChange('kpis')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              padding: '4px 8px',
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              background: layer === 'kpis' ? 'var(--accent)' : 'transparent',
              color: layer === 'kpis' ? 'var(--on-accent)' : 'var(--ink)',
              fontWeight: layer === 'kpis' ? 600 : 400,
            }}
            title="Solo KPIs y dependencias analíticas"
          >
            <Activity size={13} /> KPIs ({totalKpis})
          </button>
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

        {/* Auto Layout */}
        <button
          type="button"
          onClick={onAutoLayout}
          className="button"
          style={{ height: 28, padding: '0 8px', fontSize: 11, gap: 4 }}
          title="Organizar automáticamente los nodos en niveles limpios"
        >
          <LayoutGrid size={12} /> Auto-Layout
        </button>

        {/* Fit View */}
        <button
          type="button"
          onClick={onFitView}
          className="button"
          style={{ height: 28, padding: '0 8px', fontSize: 11, gap: 4 }}
          title="Centrar y encajar vista"
        >
          <Maximize2 size={12} /> Centrar
        </button>
      </div>

      {/* Right controls: Simulator, Actions & Export */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--surface)',
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          boxShadow: '0 4px 12px rgba(29, 29, 27, 0.08)',
          pointerEvents: 'all',
        }}
      >
        {/* Simulator button */}
        <button
          type="button"
          onClick={onOpenSimulator}
          className="button"
          style={{
            height: 28,
            padding: '0 10px',
            fontSize: 12,
            gap: 4,
            borderColor: '#D9531E',
            color: '#D9531E',
            background: '#FFF9F5',
          }}
          title="Simular y trazar visualmente rutas de JOINs en PostgreSQL"
        >
          <Play size={12} /> Simular JOINs
        </button>

        {/* Export JSON */}
        <button
          type="button"
          onClick={onExportJson}
          className="button"
          style={{ height: 28, padding: '0 8px', fontSize: 11, gap: 4 }}
          title="Exportar diseño actual en JSON"
        >
          <Download size={12} /> Exportar
        </button>

        {/* Import JSON */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".json"
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="button"
          style={{ height: 28, padding: '0 8px', fontSize: 11, gap: 4 }}
          title="Importar diseño guardado en JSON"
        >
          <Upload size={12} /> Importar
        </button>

        {/* New KPI Button */}
        {canManage && (
          <button
            type="button"
            onClick={onOpenNewKpi}
            className="button primary"
            style={{ height: 28, padding: '0 10px', fontSize: 12, gap: 4 }}
          >
            <Plus size={13} /> Nuevo KPI
          </button>
        )}
      </div>
    </div>
  );
}
