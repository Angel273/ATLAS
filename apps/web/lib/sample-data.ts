/**
 * @file apps/web/lib/sample-data.ts
 * @description Conjuntos de datos de muestra y utilidades de formato de métricas para la vista previa del dashboard.
 * Proporciona equipos simulados, tendencias de días anteriores, formateadores numéricos (porcentajes, duraciones mm:ss)
 * y agregaciones operacionales para la interfaz de usuario.
 */

export const sampleTeams = [
  { id: 'norte', name: 'Equipo Norte', account: 'support', initials: 'EN', agents: 24, calls: 3248, answered: 3021, service: 2840, handleSeconds: 1057350, qualityPoints: 9510, evaluations: 50 },
  { id: 'centro', name: 'Equipo Centro', account: 'support', initials: 'EC', agents: 22, calls: 3016, answered: 2827, service: 2620, handleSeconds: 1059641, qualityPoints: 9340, evaluations: 48 },
  { id: 'sur', name: 'Equipo Sur', account: 'sales', initials: 'ES', agents: 20, calls: 2874, answered: 2650, service: 2421, handleSeconds: 1046750, qualityPoints: 9210, evaluations: 44 },
  { id: 'oeste', name: 'Equipo Oeste', account: 'sales', initials: 'EO', agents: 18, calls: 2522, answered: 2290, service: 2028, handleSeconds: 920580, qualityPoints: 9160, evaluations: 40 },
] as const;
export type SampleTeam = typeof sampleTeams[number];
export const numberFormat = new Intl.NumberFormat('es-GT');

/** Formatea un valor numérico como porcentaje con 1 decimal. */
export const percent = (value: number) => `${value.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Formatea una cantidad de segundos a formato `minutos:segundos`. */
export const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;

/**
 * Calcula agregaciones ponderadas (nivel de servicio, AHT y calidad) para una lista de equipos.
 *
 * @param teams Colección de equipos de muestra.
 * @returns Métricas agregadas ponderadas.
 */
export function aggregate(teams: readonly SampleTeam[]) {

  const calls = teams.reduce((sum, team) => sum + team.calls, 0);
  const answered = teams.reduce((sum, team) => sum + team.answered, 0);
  const evaluations = teams.reduce((sum, team) => sum + team.evaluations, 0);
  return {
    calls,
    serviceLevel: calls ? teams.reduce((sum, team) => sum + team.service, 0) / calls * 100 : 0,
    aht: answered ? teams.reduce((sum, team) => sum + team.handleSeconds, 0) / answered : 0,
    quality: evaluations ? teams.reduce((sum, team) => sum + team.qualityPoints * team.evaluations, 0) / evaluations / 100 : 0,
  };
}
export const sampleTrend = [
  { day: '25 ago', current: 79.4, previous: 76.1 }, { day: '26 ago', current: 82.1, previous: 78.8 },
  { day: '27 ago', current: 81.0, previous: 77.3 }, { day: '28 ago', current: 85.8, previous: 80.4 },
  { day: '29 ago', current: 83.6, previous: 79.8 }, { day: '30 ago', current: 87.2, previous: 82.0 },
  { day: '31 ago', current: 85.0, previous: 81.6 },
];
export const kpiDefinitions = [
  { id: 'service', name: 'Nivel de servicio', formula: 'SUM(calls.within_threshold) / SUM(calls.offered) * 100', unit: 'Porcentaje', target: '85,0%', note: 'Llamadas atendidas dentro del umbral sobre el total de llamadas ofrecidas.' },
  { id: 'calls', name: 'Llamadas ofrecidas', formula: 'SUM(calls.offered)', unit: 'Llamadas', target: 'Sin meta configurada', note: 'Total de llamadas ofrecidas a los equipos del contexto seleccionado.' },
  { id: 'aht', name: 'Tiempo medio de gestión', formula: 'SUM(calls.handle_seconds) / SUM(calls.answered)', unit: 'Segundos · visualización m:ss', target: '6:30 min', note: 'Tiempo de gestión total dividido entre llamadas atendidas. Se pondera por volumen.' },
  { id: 'quality', name: 'Calidad de atención', formula: 'SUM(quality.score * quality.evaluations) / SUM(quality.evaluations)', unit: 'Porcentaje', target: '90,0%', note: 'Ejemplo sintético ponderado. Las definiciones definitivas se publicarán en KPI Structure.' },
] as const;
