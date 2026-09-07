/**
 * @file dataset-node.tsx
 * @description Nodo visual tipo ERD para datasets en el Lienzo Semántico.
 * Muestra metadatos del dataset, columnas normalizadas, tipos de datos, llaves primarias
 * y conectores (handles) a nivel de campo para establecer relaciones entre tablas.
 */

'use client';
import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Database, Key, Hash, Calendar, Clock, Type, ToggleLeft, Layers, Plus, Search } from 'lucide-react';
import type { DatasetNodeData, FieldType } from '../types';

/**
 * Renderiza una etiqueta visual compacta con icono y color según el tipo de datos del campo.
 */
function FieldTypeBadge({ type }: { type: FieldType }) {
  switch (type) {
    case 'integer':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#E3EAF2', color: '#1F476B', fontWeight: 600 }}>
          <Hash size={10} /> INT
        </span>
      );
    case 'decimal':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#E3EAF2', color: '#1F476B', fontWeight: 600 }}>
          <Hash size={10} /> DEC
        </span>
      );
    case 'date':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#F5EFE0', color: '#8A5D19', fontWeight: 600 }}>
          <Calendar size={10} /> DATE
        </span>
      );
    case 'datetime':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#F5EFE0', color: '#8A5D19', fontWeight: 600 }}>
          <Clock size={10} /> TIME
        </span>
      );
    case 'duration':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#F2E8DC', color: '#873B1B', fontWeight: 600 }}>
          <Clock size={10} /> DUR
        </span>
      );
    case 'boolean':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#E2F0EA', color: '#255C41', fontWeight: 600 }}>
          <ToggleLeft size={10} /> BOOL
        </span>
      );
    case 'string':
    default:
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: 'var(--surface-muted)', color: 'var(--ink)', fontWeight: 600 }}>
          <Type size={10} /> STR
        </span>
      );
  }
}

/**
 * Componente de nodo ReactFlow para representar un dataset y sus columnas con handles de conexión.
 */
export const DatasetNode = memo(function DatasetNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as DatasetNodeData;
  const [filter, setFilter] = useState('');

  const columns = nodeData.columns || [];
  const filteredColumns = filter
    ? columns.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) || c.sourceName.toLowerCase().includes(filter.toLowerCase()))
    : columns;

  const isHighlighted = Boolean(nodeData.isHighlighted);

  return (
    <div
      style={{
        width: 320,
        borderRadius: '6px',
        background: 'var(--surface)',
        border: selected
          ? '2px solid var(--accent)'
          : isHighlighted
            ? '2px solid #D9531E'
            : '1px solid var(--border-strong)',
        boxShadow: selected || isHighlighted
          ? '0 8px 24px rgba(29, 29, 27, 0.16)'
          : '0 4px 12px rgba(29, 29, 27, 0.08)',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        overflow: 'hidden',
        fontFamily: 'var(--sans)',
      }}
    >
      {/* Top Handle for dataset-level connections */}
      <Handle
        type="target"
        position={Position.Top}
        id="dataset-top"
        style={{
          background: 'var(--accent)',
          width: 10,
          height: 10,
          border: '2px solid var(--surface)',
        }}
      />

      {/* Right Handle for clean dataset-to-KPI connections without looping under cards */}
      <Handle
        type="source"
        position={Position.Right}
        id="dataset-right"
        style={{
          background: '#2F6FED',
          width: 10,
          height: 10,
          border: '2px solid var(--surface)',
          top: 24,
          right: -5,
          zIndex: 10,
        }}
        title="Conectar métricas KPI a este dataset"
      />

      {/* Header */}
      <div
        style={{
          background: isHighlighted ? 'linear-gradient(135deg, #FAF3E6 0%, #F5E8D3 100%)' : 'var(--surface-muted)',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '4px',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Database size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={nodeData.slug}
            >
              {nodeData.slug}
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: '1px 5px',
                borderRadius: '3px',
                background: 'rgba(54, 92, 74, 0.12)',
                color: 'var(--accent)',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              v{nodeData.versionNumber}
            </span>
          </div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={nodeData.name}
          >
            {nodeData.name}
          </div>
        </div>

        {typeof nodeData.onAddKpiForDataset === 'function' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              (nodeData.onAddKpiForDataset as (datasetId: string, versionId: string) => void)(
                nodeData.datasetId,
                nodeData.versionId
              );
            }}
            title="Crear KPI sobre este dataset"
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: '3px',
              width: 24,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              color: 'var(--secondary)',
            }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Row count & search bar if columns > 6 */}
      <div
        style={{
          padding: '6px 14px',
          background: 'var(--canvas)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: 'var(--secondary)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Layers size={11} /> {nodeData.rowCount.toLocaleString()} filas · {columns.length} campos
        </span>
        {columns.length > 5 && (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={11} style={{ position: 'absolute', left: 4, color: 'var(--muted)' }} />
            <input
              type="text"
              placeholder="Filtrar..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onClick={e => e.stopPropagation()}
              style={{
                width: 75,
                fontSize: '10px',
                padding: '2px 4px 2px 18px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                borderRadius: '3px',
              }}
            />
          </div>
        )}
      </div>

      {/* Column list */}
      <div style={{ maxHeight: 300, overflowY: 'auto', padding: '4px 0' }}>
        {filteredColumns.map((col) => {
          return (
            <div
              key={col.name}
              style={{
                position: 'relative',
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
                background: 'transparent',
              }}
            >
              {/* Left Handle */}
              <Handle
                type="target"
                position={Position.Left}
                id={`field-left-${col.name}`}
                style={{
                  width: 9,
                  height: 9,
                  background: col.isKey ? 'var(--warning)' : 'var(--accent)',
                  border: '2px solid var(--surface)',
                  left: -5,
                }}
                title={`Conectar a ${col.name} (${col.type})`}
              />

              {/* Key or bullet indicator */}
              <span style={{ width: 14, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {col.isKey ? (
                  <span title="Clave Primaria / Clave Única" style={{ display: 'grid', placeItems: 'center' }}>
                    <Key size={12} style={{ color: 'var(--warning)' }} />
                  </span>
                ) : (
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--border-strong)' }} />
                )}
              </span>

              {/* Column name & type */}
              <span
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontWeight: col.isKey ? 700 : 500,
                  color: col.isKey ? 'var(--ink)' : 'var(--ink)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${col.name} (Origen: ${col.sourceName})`}
              >
                {col.name}
              </span>

              <FieldTypeBadge type={col.type} />

              {/* Right Handle */}
              <Handle
                type="source"
                position={Position.Right}
                id={`field-right-${col.name}`}
                style={{
                  width: 9,
                  height: 9,
                  background: col.isKey ? 'var(--warning)' : 'var(--accent)',
                  border: '2px solid var(--surface)',
                  right: -5,
                }}
                title={`Conectar desde ${col.name} (${col.type})`}
              />
            </div>
          );
        })}
      </div>

      {/* Bottom Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="dataset-bottom"
        style={{
          background: 'var(--accent)',
          width: 10,
          height: 10,
          border: '2px solid var(--surface)',
        }}
      />
    </div>
  );
});
