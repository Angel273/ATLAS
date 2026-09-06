import type { Node, Edge } from '@xyflow/react';

export interface CanvasExportPayload {
  version: '1.0';
  exportedAt: string;
  nodes: Node[];
  edges: Edge[];
}

export function exportCanvasToJson(nodes: Node[], edges: Edge[], filename = 'atlas-semantic-model.json'): void {
  const payload: CanvasExportPayload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    nodes,
    edges,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseCanvasJson(jsonString: string): { nodes: Node[]; edges: Edge[] } | null {
  try {
    const data = JSON.parse(jsonString) as CanvasExportPayload;
    if (data.nodes && Array.isArray(data.nodes) && data.edges && Array.isArray(data.edges)) {
      return { nodes: data.nodes, edges: data.edges };
    }
    return null;
  } catch {
    return null;
  }
}
