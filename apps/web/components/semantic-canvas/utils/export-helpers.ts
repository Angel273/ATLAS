/**
 * @file export-helpers.ts
 * @description Funciones auxiliares para exportar e importar el estado completo del Lienzo Semántico en formato JSON.
 * Facilita copias de respaldo, intercambio de esquemas y restauración del layout visual de nodos y aristas.
 */

import type { Node, Edge } from '@xyflow/react';

export interface CanvasExportPayload {
  version: '1.0';
  exportedAt: string;
  nodes: Node[];
  edges: Edge[];
}

/**
 * Descarga los nodos y aristas del canvas en el navegador como un archivo JSON estructurado.
 * @param nodes Lista de nodos del lienzo.
 * @param edges Lista de aristas del lienzo.
 * @param filename Nombre sugerido del archivo descargable.
 */
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

/**
 * Parsea y valida una cadena JSON para extraer nodos y aristas compatibles con el lienzo.
 * @param jsonString Cadena JSON a deserializar.
 * @returns Estructura con nodos y aristas o null si el formato no es válido.
 */
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
