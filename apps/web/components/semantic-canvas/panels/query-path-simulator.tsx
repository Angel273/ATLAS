/**
 * @file query-path-simulator.tsx
 * @description Modal y simulador de rutas de consulta (Query Path Simulator).
 * Permite seleccionar un dataset raíz y datasets de destino para evaluar y resaltar visualmente
 * la ruta BFS de JOINs deterministas en el lienzo semántico sin productos cartesianos.
 */

'use client';
import { useState, useMemo } from 'react';
import { Play, Sparkles, X, RotateCcw, AlertTriangle, ArrowRight } from 'lucide-react';
import type { DatasetVersion, SemanticRelationship } from '@atlas/contracts';
import type { SimulatedPath } from '../types';

interface QueryPathSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
  sources: Array<{ id: string; name: string; slug: string; version: DatasetVersion }>;
  relationships: SemanticRelationship[];
  onHighlightPath: (path: SimulatedPath | null) => void;
}

/**
 * Componente interactivo para simular y verificar la alcanzabilidad de datasets mediante el grafo de relaciones.
 */
export function QueryPathSimulator({
  isOpen,
  onClose,
  sources,
  relationships,
  onHighlightPath,
}: QueryPathSimulatorProps) {
  const [rootDatasetId, setRootDatasetId] = useState(sources[0]?.id || '');
  const [targetDatasetIds, setTargetDatasetIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'warning' | 'error'; text: string } | null>(null);

  const availableTargets = useMemo(() => {
    return sources.filter(s => s.id !== rootDatasetId);
  }, [sources, rootDatasetId]);

  function handleSimulate() {
    if (!rootDatasetId) {
      setStatusMessage({ type: 'error', text: 'Selecciona un dataset raíz para iniciar la simulación.' });
      return;
    }
    if (targetDatasetIds.length === 0) {
      setStatusMessage({ type: 'warning', text: 'Selecciona al menos un dataset objetivo para calcular la ruta de JOIN.' });
      return;
    }

    // Graph BFS/DFS traversal
    const highlightedDatasetIds = new Set<string>([rootDatasetId]);
    const highlightedEdgeIds = new Set<string>();
    const steps: string[] = [];

    let allReachable = true;

    for (const targetId of targetDatasetIds) {
      // Find paths from root to target
      const queue: Array<{ current: string; path: SemanticRelationship[] }> = [
        { current: rootDatasetId, path: [] },
      ];
      const visited = new Set<string>([rootDatasetId]);
      let foundPath: SemanticRelationship[] | null = null;

      while (queue.length > 0) {
        const item = queue.shift()!;
        if (item.current === targetId) {
          foundPath = item.path;
          break;
        }

        // Find outgoing/incoming edges for item.current
        const edges = relationships.filter(
          r => r.fromDatasetId === item.current || r.toDatasetId === item.current
        );

        // Sort edges by isPreferred first
        edges.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0));

        for (const edge of edges) {
          const next = edge.fromDatasetId === item.current ? edge.toDatasetId : edge.fromDatasetId;
          if (!visited.has(next)) {
            visited.add(next);
            queue.push({
              current: next,
              path: [...item.path, edge],
            });
          }
        }
      }

      if (foundPath && foundPath.length > 0) {
        for (const edge of foundPath) {
          highlightedDatasetIds.add(edge.fromDatasetId);
          highlightedDatasetIds.add(edge.toDatasetId);
          highlightedEdgeIds.add(edge.id);

          const fromDs = sources.find(s => s.id === edge.fromDatasetId)?.slug || 'origen';
          const toDs = sources.find(s => s.id === edge.toDatasetId)?.slug || 'destino';
          steps.push(`${fromDs}.${edge.fromField} ⟷ ${toDs}.${edge.toField} (${edge.joinType.toUpperCase()} JOIN)`);
        }
      } else {
        allReachable = false;
        const targetSlug = sources.find(s => s.id === targetId)?.slug || targetId;
        steps.push(`❌ No se encontró ruta semántica válida hacia "${targetSlug}".`);
      }
    }

    if (!allReachable) {
      setStatusMessage({
        type: 'error',
        text: 'Existen datasets desconectados en el grafo semántico. Publica relaciones entre ellos para permitir consultas conjuntas.',
      });
    } else {
      setStatusMessage({
        type: 'ok',
        text: `Ruta de consulta resuelta con éxito (${steps.length} saltos de JOIN).`,
      });
    }

    onHighlightPath({
      datasetIds: Array.from(highlightedDatasetIds),
      edgeIds: Array.from(highlightedEdgeIds),
      explanation: steps,
    });
  }

  function handleClear() {
    setTargetDatasetIds([]);
    setStatusMessage(null);
    onHighlightPath(null);
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '90%',
        maxWidth: 720,
        background: 'var(--surface)',
        borderRadius: 8,
        border: '1px solid var(--border-strong)',
        boxShadow: '0 16px 36px rgba(29, 29, 27, 0.2)',
        zIndex: 35,
        overflow: 'hidden',
        fontFamily: 'var(--sans)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 18px',
          background: 'var(--surface-muted)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} style={{ color: '#D9531E' }} />
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
            Simulador de Rutas de Consulta y Resolución de JOINs
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--secondary)' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 16, alignItems: 'center' }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
              Dataset Raíz (FROM)
            </label>
            <select
              value={rootDatasetId}
              onChange={e => {
                setRootDatasetId(e.target.value);
                setTargetDatasetIds(prev => prev.filter(id => id !== e.target.value));
              }}
              style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
            >
              {sources.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
              Datasets Objetivos a Unir (JOIN)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {availableTargets.map(s => {
                const isSelected = targetDatasetIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setTargetDatasetIds(prev =>
                        isSelected ? prev.filter(id => id !== s.id) : [...prev, s.id]
                      );
                    }}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 3,
                      border: isSelected ? '1px solid #D9531E' : '1px solid var(--border)',
                      background: isSelected ? '#FFF2E6' : 'var(--surface)',
                      color: isSelected ? '#D9531E' : 'var(--ink)',
                      cursor: 'pointer',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    {s.slug}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Status result */}
        {statusMessage && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: statusMessage.type === 'ok' ? 'rgba(57, 112, 82, 0.08)' : '#FDF2F2',
              border: `1px solid ${statusMessage.type === 'ok' ? 'rgba(57, 112, 82, 0.25)' : '#E8B4B4'}`,
              color: statusMessage.type === 'ok' ? 'var(--positive)' : '#9A433D',
            }}
          >
            {statusMessage.type === 'ok' ? <Sparkles size={14} /> : <AlertTriangle size={14} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={handleClear}
            className="button"
            style={{ height: 32, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <RotateCcw size={12} /> Limpiar
          </button>
          <button
            type="button"
            onClick={handleSimulate}
            className="button primary"
            style={{ height: 32, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Play size={12} /> Simular Ruta en Canvas
          </button>
        </div>
      </div>
    </div>
  );
}
