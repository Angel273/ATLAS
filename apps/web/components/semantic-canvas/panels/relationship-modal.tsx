'use client';
import { useState, useEffect, type FormEvent } from 'react';
import { GitMerge, Check, AlertCircle, Star, X } from 'lucide-react';
import type { DatasetVersion } from '@atlas/contracts';
import type { SemanticEdgeData } from '../types';

interface RelationshipModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: SemanticEdgeData | null;
  sources: Array<{ id: string; name: string; slug: string; version: DatasetVersion }>;
  onSave: (payload: {
    fromDatasetId: string;
    fromField: string;
    toDatasetId: string;
    toField: string;
    cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one';
    joinType: 'left' | 'inner';
    isPreferred: boolean;
  }) => Promise<void>;
  canManage: boolean;
}

export function RelationshipModal({
  isOpen,
  onClose,
  data,
  sources,
  onSave,
  canManage,
}: RelationshipModalProps) {
  const [fromDatasetId, setFromDatasetId] = useState('');
  const [fromField, setFromField] = useState('');
  const [toDatasetId, setToDatasetId] = useState('');
  const [toField, setToField] = useState('');
  const [cardinality, setCardinality] = useState<'one_to_one' | 'one_to_many' | 'many_to_one'>('many_to_one');
  const [joinType, setJoinType] = useState<'left' | 'inner'>('left');
  const [isPreferred, setIsPreferred] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (data) {
      setFromDatasetId(data.fromDatasetId);
      setFromField(data.fromField);
      setToDatasetId(data.toDatasetId);
      setToField(data.toField);
      setCardinality(data.cardinality || 'many_to_one');
      setJoinType(data.joinType || 'left');
      setIsPreferred(Boolean(data.isPreferred));
      setError('');
    }
  }, [data]);

  if (!isOpen || !data) return null;

  const fromSource = sources.find(s => s.id === fromDatasetId);
  const toSource = sources.find(s => s.id === toDatasetId);

  const fromFields = fromSource?.version.mapping?.fields || [];
  const toFields = toSource?.version.mapping?.fields || [];

  const isPublished = Boolean(data.relationshipId && data.publishedAt);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fromDatasetId || !fromField || !toDatasetId || !toField) {
      setError('Debes especificar ambos datasets y sus campos respectivos.');
      return;
    }
    if (fromDatasetId === toDatasetId) {
      setError('Una relación semántica debe conectar dos datasets distintos.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onSave({
        fromDatasetId,
        fromField,
        toDatasetId,
        toField,
        cardinality,
        joinType,
        isPreferred,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la relación semántica.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(29, 29, 27, 0.45)',
        backdropFilter: 'blur(2px)',
        zIndex: 50,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--surface)',
          borderRadius: 6,
          border: '1px solid var(--border-strong)',
          boxShadow: '0 20px 40px rgba(29, 29, 27, 0.22)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 4,
                background: 'var(--accent)',
                color: 'var(--on-accent)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <GitMerge size={16} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Relación Semántica</h3>
              <div style={{ fontSize: 11, color: 'var(--secondary)' }}>
                {isPublished ? 'Relación publicada e inmutable' : 'Configurar nueva relación entre tablas'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--secondary)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 4,
                background: '#FDF2F2',
                border: '1px solid #E8B4B4',
                color: '#9A433D',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {isPublished && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 4,
                background: 'rgba(57, 112, 82, 0.08)',
                border: '1px solid rgba(57, 112, 82, 0.25)',
                color: 'var(--positive)',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Check size={14} />
              <span>Esta relación ya se encuentra publicada en el motor de consultas.</span>
            </div>
          )}

          {/* From Table & Field */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
                Dataset Origen
              </label>
              <select
                value={fromDatasetId}
                disabled={isPublished || !canManage}
                onChange={e => {
                  setFromDatasetId(e.target.value);
                  setFromField('');
                }}
                style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
              >
                <option value="">Selecciona dataset...</option>
                {sources.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
                Campo Origen
              </label>
              <select
                value={fromField}
                disabled={isPublished || !canManage}
                onChange={e => setFromField(e.target.value)}
                style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)', fontFamily: 'ui-monospace, monospace' }}
              >
                <option value="">Selecciona campo...</option>
                {fromFields.map(f => (
                  <option key={f.target} value={f.target}>{f.target} ({f.type})</option>
                ))}
              </select>
            </div>
          </div>

          {/* To Table & Field */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
                Dataset Destino
              </label>
              <select
                value={toDatasetId}
                disabled={isPublished || !canManage}
                onChange={e => {
                  setToDatasetId(e.target.value);
                  setToField('');
                }}
                style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
              >
                <option value="">Selecciona dataset...</option>
                {sources.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
                Campo Destino
              </label>
              <select
                value={toField}
                disabled={isPublished || !canManage}
                onChange={e => setToField(e.target.value)}
                style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)', fontFamily: 'ui-monospace, monospace' }}
              >
                <option value="">Selecciona campo...</option>
                {toFields.map(f => (
                  <option key={f.target} value={f.target}>{f.target} ({f.type})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Cardinality & Join Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
                Cardinalidad
              </label>
              <select
                value={cardinality}
                disabled={isPublished || !canManage}
                onChange={e => setCardinality(e.target.value as unknown as typeof cardinality)}
                style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
              >
                <option value="many_to_one">Muchos a Uno (N:1)</option>
                <option value="one_to_many">Uno a Muchos (1:N)</option>
                <option value="one_to_one">Uno a Uno (1:1)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--secondary)', marginBottom: 4 }}>
                Tipo de JOIN
              </label>
              <select
                value={joinType}
                disabled={isPublished || !canManage}
                onChange={e => setJoinType(e.target.value as unknown as typeof joinType)}
                style={{ width: '100%', height: 34, padding: '0 8px', border: '1px solid var(--border)', background: 'var(--canvas)' }}
              >
                <option value="left">LEFT JOIN (Recomendado)</option>
                <option value="inner">INNER JOIN</option>
              </select>
            </div>
          </div>

          {/* isPreferred toggle */}
          <div
            style={{
              padding: '12px',
              borderRadius: 4,
              background: 'var(--canvas)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <input
              type="checkbox"
              id="isPreferredCheck"
              checked={isPreferred}
              disabled={!canManage}
              onChange={e => setIsPreferred(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <label htmlFor="isPreferredCheck" style={{ fontSize: 12, cursor: 'pointer' }}>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--ink)' }}>
                <Star size={12} style={{ color: '#D97706', fill: isPreferred ? '#D97706' : 'none' }} />
                Ruta Preferida de Desambiguación (isPreferred)
              </span>
              <span style={{ display: 'block', color: 'var(--secondary)', marginTop: 2, fontSize: 11 }}>
                Si existen múltiples rutas posibles entre estas tablas, el motor de consultas priorizará automáticamente esta relación.
              </span>
            </label>
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose} className="button" style={{ height: 34 }}>
              Cerrar
            </button>
            {!isPublished && canManage && (
              <button
                type="submit"
                disabled={busy}
                className="button primary"
                style={{ height: 34 }}
              >
                {busy ? 'Publicando...' : 'Publicar Relación'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
