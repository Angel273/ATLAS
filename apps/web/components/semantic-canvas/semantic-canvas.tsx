'use client';
import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnNodeDrag,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { DatasetVersion, Kpi, SemanticRelationship } from '@atlas/contracts';
import type {
  CanvasLayer,
  DatasetColumn,
  DatasetNodeData,
  KpiNodeData,
  SemanticEdgeData,
  DependencyEdgeData,
  SimulatedPath,
} from './types';
import { DatasetNode } from './nodes/dataset-node';
import { KpiNode } from './nodes/kpi-node';
import { SemanticEdge } from './edges/semantic-edge';
import { DependencyEdge } from './edges/dependency-edge';
import { CanvasToolbar } from './toolbar';
import { RelationshipModal } from './panels/relationship-modal';
import { FormulaBuilderPanel } from './panels/formula-builder-panel';
import { QueryPathSimulator } from './panels/query-path-simulator';
import { layoutElements } from './utils/auto-layout';
import { wouldIntroduceCycle } from './utils/cycle-detection';
import { exportCanvasToJson, parseCanvasJson } from './utils/export-helpers';

const nodeTypes = {
  datasetNode: DatasetNode,
  kpiNode: KpiNode,
};

const edgeTypes = {
  semanticEdge: SemanticEdge,
  dependencyEdge: DependencyEdge,
};

interface SemanticCanvasProps {
  sources: Array<{ id: string; name: string; slug: string; version: DatasetVersion }>;
  relationships: SemanticRelationship[];
  kpis: Kpi[];
  canManage: boolean;
  onSaveRelationship: (payload: {
    fromDatasetId: string;
    fromField: string;
    toDatasetId: string;
    toField: string;
    cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one';
    joinType: 'left' | 'inner';
    isPreferred: boolean;
  }) => Promise<void>;
  onSaveKpi: (payload: {
    name: string;
    slug: string;
    description: string;
    datasetVersionId: string;
    relatedDatasetVersionIds: string[];
    formula: string;
    unit: 'number' | 'percent' | 'seconds';
    precision: number;
    dimensions: string[];
    targetDirection: 'higher_is_better' | 'lower_is_better' | 'target_match';
    targets: { target?: number | undefined; warningThreshold?: number | undefined; criticalThreshold?: number | undefined };
    dependencies: string[];
  }) => Promise<void>;
  onRefresh: () => Promise<void>;
}

function InnerSemanticCanvas({
  sources,
  relationships,
  kpis,
  canManage,
  onSaveRelationship,
  onSaveKpi,
  onRefresh,
}: SemanticCanvasProps) {
  const { fitView } = useReactFlow();

  const [layer, setLayer] = useState<CanvasLayer>('all');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Modals & Panels state
  const [editingRelData, setEditingRelData] = useState<SemanticEdgeData | null>(null);
  const [isRelModalOpen, setIsRelModalOpen] = useState(false);

  const [editingKpiData, setEditingKpiData] = useState<KpiNodeData | null>(null);
  const [isKpiPanelOpen, setIsKpiPanelOpen] = useState(false);

  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simulatedPath, setSimulatedPath] = useState<SimulatedPath | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const showToast = useCallback((text: string, type: 'error' | 'success' = 'error') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  // Build initial Nodes and Edges from sources, relationships, and kpis
  const generateGraph = useCallback(() => {
    // 1. Build Dataset Nodes
    const datasetNodes: Node[] = sources.map((source, index) => {
      const mappingFields = source.version.mapping?.fields || [];
      const keyFields = source.version.mapping?.keyFields || [];

      const columns: DatasetColumn[] = mappingFields.map(f => ({
        name: f.target,
        sourceName: f.source,
        type: f.type,
        isKey: keyFields.includes(f.target),
        required: f.required,
      }));

      const isHigh = simulatedPath ? simulatedPath.datasetIds.includes(source.id) : false;

      return {
        id: `dataset-${source.id}`,
        type: 'datasetNode',
        position: { x: 60 + (index % 2) * 380, y: 60 + Math.floor(index / 2) * 320 },
        data: {
          datasetId: source.id,
          versionId: source.version.id,
          name: source.name,
          slug: source.slug,
          versionNumber: source.version.number,
          rowCount: source.version.rows,
          columns,
          isHighlighted: isHigh,
          onAddKpiForDataset: (dsId: string, vId: string) => {
            setEditingKpiData({
              slug: '',
              name: '',
              formula: '',
              unit: 'number',
              precision: 2,
              datasetVersionId: vId,
              relatedDatasetVersionIds: [],
              dimensions: [],
              targetDirection: 'higher_is_better',
              targets: {},
              dependencies: [],
            });
            setIsKpiPanelOpen(true);
          },
        } as DatasetNodeData,
      };
    });

    function cleanTargets(t?: unknown) {
      const val = t as Record<string, unknown> | undefined;
      const res: { target?: number | undefined; warningThreshold?: number | undefined; criticalThreshold?: number | undefined } = {};
      if (typeof val?.target === 'number') res.target = val.target;
      if (typeof val?.warningThreshold === 'number') res.warningThreshold = val.warningThreshold;
      if (typeof val?.criticalThreshold === 'number') res.criticalThreshold = val.criticalThreshold;
      return res;
    }

    // 2. Build KPI Nodes
    const kpiNodes: Node[] = kpis.map((kpi, index) => {
      const parentSource = sources.find(s => s.version.id === kpi.datasetVersionId);
      const isHigh = false;

      return {
        id: `kpi-${kpi.id}`,
        type: 'kpiNode',
        position: { x: 880, y: 60 + index * 260 },
        data: {
          id: kpi.id,
          slug: kpi.slug,
          name: kpi.name,
          description: kpi.description,
          formula: kpi.formula,
          unit: kpi.unit,
          precision: kpi.precision,
          datasetVersionId: kpi.datasetVersionId,
          datasetName: parentSource?.name,
          datasetSlug: parentSource?.slug,
          relatedDatasetVersionIds: kpi.relatedDatasetVersionIds || [],
          dimensions: kpi.dimensions,
          targetDirection: kpi.targetDirection,
          targets: cleanTargets(kpi.targets),
          dependencies: kpi.dependencies || [],
          publishedAt: kpi.publishedAt,
          deprecatedAt: kpi.deprecatedAt,
          isHighlighted: isHigh,
          onEdit: () => {
            setEditingKpiData({
              id: kpi.id,
              slug: kpi.slug,
              name: kpi.name,
              description: kpi.description,
              formula: kpi.formula,
              unit: kpi.unit,
              precision: kpi.precision,
              datasetVersionId: kpi.datasetVersionId,
              datasetName: parentSource?.name,
              datasetSlug: parentSource?.slug,
              relatedDatasetVersionIds: kpi.relatedDatasetVersionIds || [],
              dimensions: kpi.dimensions,
              targetDirection: kpi.targetDirection,
              targets: cleanTargets(kpi.targets),
              dependencies: kpi.dependencies || [],
              publishedAt: kpi.publishedAt,
              deprecatedAt: kpi.deprecatedAt,
            });
            setIsKpiPanelOpen(true);
          },
        } as KpiNodeData,
      };
    });

    // 3. Build Semantic Relationship Edges
    const semanticEdges: Edge[] = relationships.map((rel) => {
      const isHigh = simulatedPath ? simulatedPath.edgeIds.includes(rel.id) : false;
      const fromSource = sources.find(s => s.id === rel.fromDatasetId);
      const toSource = sources.find(s => s.id === rel.toDatasetId);

      return {
        id: `rel-${rel.id}`,
        source: `dataset-${rel.fromDatasetId}`,
        target: `dataset-${rel.toDatasetId}`,
        sourceHandle: `field-right-${rel.fromField}`,
        targetHandle: `field-left-${rel.toField}`,
        type: 'semanticEdge',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: isHigh ? '#D9531E' : 'var(--accent)' },
        data: {
          relationshipId: rel.id,
          fromDatasetId: rel.fromDatasetId,
          fromDatasetSlug: fromSource?.slug || '',
          fromField: rel.fromField,
          toDatasetId: rel.toDatasetId,
          toDatasetSlug: toSource?.slug || '',
          toField: rel.toField,
          cardinality: rel.cardinality,
          joinType: rel.joinType,
          isPreferred: rel.isPreferred,
          publishedAt: rel.publishedAt,
          isHighlighted: isHigh,
          onConfigure: (data: SemanticEdgeData) => {
            setEditingRelData(data);
            setIsRelModalOpen(true);
          },
        } as SemanticEdgeData,
      };
    });

    // 4. Build Dataset -> KPI and KPI -> KPI dependency edges
    const dependencyEdges: Edge[] = [];

    kpis.forEach(kpi => {
      // Edge from base dataset to KPI
      const parentSource = sources.find(s => s.version.id === kpi.datasetVersionId);
      if (parentSource) {
        dependencyEdges.push({
          id: `dep-ds-${parentSource.id}-kpi-${kpi.id}`,
          source: `dataset-${parentSource.id}`,
          target: `kpi-${kpi.id}`,
          sourceHandle: 'dataset-bottom',
          targetHandle: 'kpi-target-top',
          type: 'dependencyEdge',
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#2F6FED' },
          data: {
            fromSlug: parentSource.slug,
            toSlug: kpi.slug,
          } as DependencyEdgeData,
        });
      }

      // Edges between KPIs
      (kpi.dependencies || []).forEach(depSlug => {
        const parentKpi = kpis.find(k => k.slug === depSlug);
        if (parentKpi) {
          dependencyEdges.push({
            id: `dep-kpi-${parentKpi.id}-kpi-${kpi.id}`,
            source: `kpi-${parentKpi.id}`,
            target: `kpi-${kpi.id}`,
            sourceHandle: 'kpi-source',
            targetHandle: 'kpi-target',
            type: 'dependencyEdge',
            markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#2F6FED' },
            data: {
              fromSlug: parentKpi.slug,
              toSlug: kpi.slug,
            } as DependencyEdgeData,
          });
        }
      });
    });

    const allNodes = [...datasetNodes, ...kpiNodes];
    const allEdges = [...semanticEdges, ...dependencyEdges];

    return { allNodes, allEdges };
  }, [sources, relationships, kpis, simulatedPath]);

  // Sync state initially or on update
  useEffect(() => {
    const { allNodes, allEdges } = generateGraph();

    // Check if saved positions exist in localStorage
    const saved = localStorage.getItem('atlas_canvas_positions');
    if (saved) {
      try {
        const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>;
        const mergedNodes = allNodes.map(n => {
          const pos = positions[n.id];
          if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
            return { ...n, position: { x: pos.x, y: pos.y } };
          }
          return n;
        });
        setNodes(mergedNodes);
        setEdges(allEdges);
        return;
      } catch {
        // Fallback to fresh layout
      }
    }

    const laidOut = layoutElements(allNodes, allEdges);
    setNodes(laidOut);
    setEdges(allEdges);
  }, [generateGraph, setNodes, setEdges]);

  // Save node positions on move
  const handleNodeDragStop: OnNodeDrag<Node> = useCallback((_, node) => {
    const saved = localStorage.getItem('atlas_canvas_positions');
    const positions = saved ? JSON.parse(saved) : {};
    positions[node.id] = node.position;
    localStorage.setItem('atlas_canvas_positions', JSON.stringify(positions));
  }, []);

  // Filter nodes and edges according to the active layer
  const filteredNodes = useMemo(() => {
    if (layer === 'all') return nodes;
    if (layer === 'erd') return nodes.filter(n => n.type === 'datasetNode');
    if (layer === 'kpis') return nodes.filter(n => n.type === 'kpiNode');
    return nodes;
  }, [nodes, layer]);

  const filteredEdges = useMemo(() => {
    const visibleNodeIds = new Set(filteredNodes.map(n => n.id));
    return edges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
  }, [edges, filteredNodes]);

  // Connection validation callback
  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);

    if (!sourceNode || !targetNode) return false;

    // Disallow self-connections
    if (connection.source === connection.target) return false;

    // Case 1: Dataset to Dataset (Semantic relationship)
    if (sourceNode.type === 'datasetNode' && targetNode.type === 'datasetNode') {
      const sourceHandle = connection.sourceHandle || '';
      const targetHandle = connection.targetHandle || '';

      if (!sourceHandle.startsWith('field-') || !targetHandle.startsWith('field-')) {
        return false;
      }

      const sourceField = sourceHandle.replace(/^field-(?:right|left)-/, '');
      const targetField = targetHandle.replace(/^field-(?:right|left)-/, '');

      const sCol = (sourceNode.data?.columns as DatasetColumn[])?.find(c => c.name === sourceField);
      const tCol = (targetNode.data?.columns as DatasetColumn[])?.find(c => c.name === targetField);

      if (sCol && tCol) {
        // Prevent incompatible types
        const numeric = ['integer', 'decimal'];
        const dates = ['date', 'datetime'];

        const bothNumeric = numeric.includes(sCol.type) && numeric.includes(tCol.type);
        const bothDate = dates.includes(sCol.type) && dates.includes(tCol.type);
        const exactMatch = sCol.type === tCol.type;

        if (!bothNumeric && !bothDate && !exactMatch) {
          showToast(`Tipos de datos incompatibles: no puedes conectar ${sCol.type} con ${tCol.type}.`);
          return false;
        }
      }

      return true;
    }

    // Case 2: KPI to KPI (Dependency)
    if (sourceNode.type === 'kpiNode' && targetNode.type === 'kpiNode') {
      const fromSlug = (sourceNode.data as KpiNodeData)?.slug;
      const toSlug = (targetNode.data as KpiNodeData)?.slug;

      if (!fromSlug || !toSlug) return false;

      // Cycle detection DFS
      const existingDeps: Record<string, string[]> = {};
      kpis.forEach(k => {
        existingDeps[k.slug] = k.dependencies || [];
      });

      const { hasCycle, cyclePath } = wouldIntroduceCycle(fromSlug, toSlug, existingDeps);
      if (hasCycle) {
        showToast(
          `❌ Conexión rechazada: Se detectó una dependencia circular (${cyclePath?.join(' ➔ ')}).`,
          'error'
        );
        return false;
      }

      return true;
    }

    // Case 3: Dataset to KPI
    if (sourceNode.type === 'datasetNode' && targetNode.type === 'kpiNode') {
      return true;
    }

    return false;
  }, [nodes, kpis, showToast]);

  // Handle new connection established
  const onConnect = useCallback((params: Connection) => {
    const sourceNode = nodes.find(n => n.id === params.source);
    const targetNode = nodes.find(n => n.id === params.target);

    if (!sourceNode || !targetNode) return;

    // Dataset to Dataset -> Open Relationship Modal
    if (sourceNode.type === 'datasetNode' && targetNode.type === 'datasetNode') {
      const sourceField = (params.sourceHandle || '').replace(/^field-(?:right|left)-/, '');
      const targetField = (params.targetHandle || '').replace(/^field-(?:right|left)-/, '');

      const sData = sourceNode.data as DatasetNodeData;
      const tData = targetNode.data as DatasetNodeData;

      setEditingRelData({
        fromDatasetId: sData.datasetId,
        fromDatasetSlug: sData.slug,
        fromField: sourceField,
        toDatasetId: tData.datasetId,
        toDatasetSlug: tData.slug,
        toField: targetField,
        cardinality: 'many_to_one',
        joinType: 'left',
        isPreferred: false,
      });
      setIsRelModalOpen(true);
      return;
    }

    // KPI to KPI -> Update dependencies of target KPI
    if (sourceNode.type === 'kpiNode' && targetNode.type === 'kpiNode') {
      const fromSlug = (sourceNode.data as KpiNodeData)?.slug;
      const targetKpiData = targetNode.data as KpiNodeData;

      if (fromSlug && targetKpiData) {
        const newDeps = Array.from(new Set([...(targetKpiData.dependencies || []), fromSlug]));
        void onSaveKpi({
          name: targetKpiData.name,
          slug: targetKpiData.slug,
          description: targetKpiData.description || '',
          datasetVersionId: targetKpiData.datasetVersionId,
          relatedDatasetVersionIds: targetKpiData.relatedDatasetVersionIds || [],
          formula: targetKpiData.formula,
          unit: targetKpiData.unit,
          precision: targetKpiData.precision,
          dimensions: targetKpiData.dimensions,
          targetDirection: targetKpiData.targetDirection,
          targets: targetKpiData.targets,
          dependencies: newDeps,
        }).then(() => {
          showToast(`Dependencia añadida: ${targetKpiData.slug} depende de ${fromSlug}`, 'success');
          void onRefresh();
        });
      }
      return;
    }

    setEdges(eds => addEdge(params, eds));
  }, [nodes, setEdges, onSaveKpi, onRefresh, showToast]);

  // Auto Layout trigger
  const handleAutoLayout = useCallback(() => {
    const laidOut = layoutElements(nodes, edges);
    setNodes(laidOut);
    localStorage.removeItem('atlas_canvas_positions');
    setTimeout(() => fitView({ duration: 400 }), 50);
  }, [nodes, edges, setNodes, fitView]);

  // Export JSON
  const handleExportJson = useCallback(() => {
    exportCanvasToJson(nodes, edges);
    showToast('Diagrama exportado en JSON con éxito.', 'success');
  }, [nodes, edges, showToast]);

  // Import JSON
  const handleImportJson = useCallback((json: string) => {
    const result = parseCanvasJson(json);
    if (!result) {
      showToast('El archivo JSON proporcionado no tiene un formato válido de ATLAS.', 'error');
      return;
    }
    setNodes(result.nodes);
    setEdges(result.edges);
    showToast('Diagrama importado exitosamente.', 'success');
    setTimeout(() => fitView({ duration: 400 }), 50);
  }, [setNodes, setEdges, fitView, showToast]);

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 150px)', minHeight: 600, background: 'var(--canvas)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {/* Toast Alert */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            background: toastMessage.type === 'error' ? '#FDF2F2' : '#EAF5F0',
            border: `1px solid ${toastMessage.type === 'error' ? '#E8B4B4' : '#B8DFC9'}`,
            color: toastMessage.type === 'error' ? '#9A433D' : 'var(--positive)',
            boxShadow: '0 8px 24px rgba(29, 29, 27, 0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Floating Toolbar */}
      <CanvasToolbar
        layer={layer}
        onLayerChange={setLayer}
        onAutoLayout={handleAutoLayout}
        onFitView={() => fitView({ duration: 300 })}
        onOpenNewKpi={() => {
          setEditingKpiData(null);
          setIsKpiPanelOpen(true);
        }}
        onOpenSimulator={() => setIsSimulatorOpen(true)}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        canManage={canManage}
        totalDatasets={sources.length}
        totalKpis={kpis.length}
        totalRelationships={relationships.length}
      />

      {/* Main React Flow Canvas */}
      <ReactFlow
        nodes={filteredNodes}
        edges={filteredEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.8}
        defaultEdgeOptions={{
          type: 'semanticEdge',
        }}
      >
        <Background gap={18} size={1.2} color="var(--border)" />
        <Controls
          style={{
            bottom: 20,
            left: 20,
            borderRadius: 6,
            border: '1px solid var(--border)',
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(29, 29, 27, 0.08)',
          }}
        />
        <MiniMap
          style={{
            bottom: 20,
            right: 20,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
          nodeColor={(node) => {
            if (node.type === 'datasetNode') return 'var(--accent)';
            if (node.type === 'kpiNode') return '#2F6FED';
            return 'var(--muted)';
          }}
          zoomable
          pannable
        />
      </ReactFlow>

      {/* Semantic Relationship Modal */}
      <RelationshipModal
        isOpen={isRelModalOpen}
        onClose={() => {
          setIsRelModalOpen(false);
          setEditingRelData(null);
        }}
        data={editingRelData}
        sources={sources}
        onSave={async (payload) => {
          await onSaveRelationship(payload);
          await onRefresh();
          showToast('Relación semántica publicada exitosamente.', 'success');
        }}
        canManage={canManage}
      />

      {/* Formula Builder & KPI Panel */}
      <FormulaBuilderPanel
        isOpen={isKpiPanelOpen}
        onClose={() => {
          setIsKpiPanelOpen(false);
          setEditingKpiData(null);
        }}
        kpiData={editingKpiData}
        sources={sources}
        allKpis={kpis}
        onSaveKpi={async (payload) => {
          await onSaveKpi(payload);
          await onRefresh();
          showToast(`KPI "${payload.slug}" guardado y publicado.`, 'success');
        }}
        canManage={canManage}
      />

      {/* Query Path Simulator */}
      <QueryPathSimulator
        isOpen={isSimulatorOpen}
        onClose={() => {
          setIsSimulatorOpen(false);
          setSimulatedPath(null);
        }}
        sources={sources}
        relationships={relationships}
        onHighlightPath={(path) => {
          setSimulatedPath(path);
        }}
      />
    </div>
  );
}

export function SemanticCanvas(props: SemanticCanvasProps) {
  return (
    <ReactFlowProvider>
      <InnerSemanticCanvas {...props} />
    </ReactFlowProvider>
  );
}
