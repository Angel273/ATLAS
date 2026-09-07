/**
 * @file apps/web/components/trend-chart.tsx
 * @description Gráfico interactivo ECharts de tendencia semanal de nivel de servicio (@atlas/web).
 * Renderiza mediante SVG accesible con soporte para reducción de movimiento (`prefers-reduced-motion`),
 * redimensionamiento responsivo con ResizeObserver y alternativa textual según WCAG 2.2 AA.
 */

'use client';
import { useEffect, useRef, useState } from 'react';
import { sampleTrend } from '../lib/sample-data';

/**
 * Componente de gráfico de línea para visualización comparativa de tendencias operacionales.
 */
export function TrendChart() {

  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import('echarts').then(echarts => {
      if (disposed || !ref.current) return;
      const css = getComputedStyle(document.documentElement);
      const color = (token: string) => css.getPropertyValue(token).trim();
      const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });
      chart.setOption({
        animation: !matchMedia('(prefers-reduced-motion: reduce)').matches,
        textStyle: { fontFamily: 'system-ui', color: color('--secondary'), fontSize: 11 },
        grid: { left: 48, right: 20, top: 42, bottom: 34 },
        tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value}%` },
        legend: { top: 9, right: 13, itemWidth: 15, itemHeight: 2, textStyle: { fontSize: 11, color: color('--secondary') } },
        xAxis: { type: 'category', boundaryGap: false, data: sampleTrend.map(row => row.day), axisLine: { lineStyle: { color: color('--border') } }, axisTick: { show: false } },
        yAxis: { type: 'value', min: 70, max: 95, interval: 5, axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { color: color('--border'), type: 'dashed', opacity: .6 } } },
        series: [
          { name: 'Semana actual', type: 'line', data: sampleTrend.map(row => row.current), symbol: 'circle', symbolSize: 6, smooth: false, itemStyle: { color: color('--accent') }, lineStyle: { width: 2.5 }, areaStyle: { color: color('--accent'), opacity: .055 } },
          { name: 'Semana anterior', type: 'line', data: sampleTrend.map(row => row.previous), symbol: 'none', smooth: false, itemStyle: { color: color('--secondary') }, lineStyle: { type: 'dashed', width: 1.5 } },
        ],
      });
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(ref.current);
      cleanup = () => { observer.disconnect(); chart.dispose(); };
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; cleanup?.(); };
  }, []);
  return failed ? <p role="alert" className="performance-body">No se pudo dibujar el gráfico. Puedes consultar la tabla de datos.</p> : <div ref={ref} className="chart" role="img" aria-label="Ejemplo de tendencia semanal del nivel de servicio. La tabla de datos contiene todos los valores." />;
}
