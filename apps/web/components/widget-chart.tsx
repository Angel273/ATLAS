/**
 * @file apps/web/components/widget-chart.tsx
 * @description Renderizador modular de gráficos ECharts para Widgets de Dashboards (@atlas/web).
 * Soporta visualizaciones de línea (`line_chart`), barras (`bar_chart`) y áreas (`area_chart`),
 * líneas de objetivo (`markLine`), formateo de unidades (porcentajes, números, segundos) y paleta de color adaptativa.
 */

'use client';
import { useEffect, useRef, useState } from 'react';

interface WidgetChartProps {
  type: 'line_chart' | 'bar_chart' | 'area_chart';
  title: string;
  categories: string[];
  data: number[];
  unit?: string | undefined;
  color?: string | undefined;
  targetLine?: number | undefined;
  targetLabel?: string | undefined;
  showTarget?: boolean | undefined;
  height?: number | string | undefined;
}

/**
 * Componente gráfico parametrizable para widgets de dashboards gobernados.
 */
export function WidgetChart({

  type,
  title,
  categories,
  data,
  unit = '',
  color: customColor,
  targetLine,
  targetLabel,
  showTarget = false,
  height = '220px',
}: WidgetChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    if (!categories.length || !data.length) return;

    void import('echarts').then(echarts => {
      if (disposed || !ref.current) return;
      const css = getComputedStyle(document.documentElement);
      const color = (token: string) => css.getPropertyValue(token).trim();
      const accentColor = customColor || color('--accent') || '#365C4A';
      const secondaryColor = color('--secondary') || '#68665F';
      const borderColor = color('--border') || '#CBC6B9';
      const targetColor = color('--warning') || '#A56A2A';

      const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });

      const isArea = type === 'area_chart';
      const isBar = type === 'bar_chart';

      chart.setOption({
        animation: !matchMedia('(prefers-reduced-motion: reduce)').matches,
        textStyle: { fontFamily: 'system-ui, -apple-system, sans-serif', color: secondaryColor, fontSize: 11 },
        grid: { left: 45, right: showTarget && targetLine !== undefined ? 50 : 18, top: 24, bottom: 32 },
        tooltip: {
          trigger: 'axis',
          formatter: (params: unknown) => {
            if (!Array.isArray(params) || !params[0]) return '';
            const p = params[0] as { name: string; value: number };
            let html = `<div style="font-size: 11px; padding: 4px 8px;"><strong>${p.name}</strong>: ${typeof p.value === 'number' ? p.value.toLocaleString() : p.value} ${unit}`;
            if (showTarget && targetLine !== undefined) {
              html += `<div style="margin-top: 4px; color: ${targetColor}; font-size: 10px;">${targetLabel || 'Meta'}: ${targetLine.toLocaleString()} ${unit}</div>`;
            }
            html += `</div>`;
            return html;
          },
        },
        xAxis: {
          type: 'category',
          boundaryGap: isBar,
          data: categories,
          axisLine: { lineStyle: { color: borderColor } },
          axisTick: { show: false },
          axisLabel: {
            color: secondaryColor,
            fontSize: 10,
            interval: categories.length > 8 ? 'auto' : 0,
          },
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            color: secondaryColor,
            fontSize: 10,
            formatter: (v: number) => unit === '%' ? `${v}%` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`,
          },
          splitLine: { lineStyle: { color: borderColor, type: 'dashed', opacity: 0.6 } },
        },
        series: [
          {
            name: title,
            type: isBar ? 'bar' : 'line',
            data: data,
            symbol: isBar ? 'none' : 'circle',
            symbolSize: isBar ? 0 : 5,
            smooth: !isBar,
            itemStyle: { color: accentColor },
            lineStyle: { width: 2, color: accentColor },
            areaStyle: isArea ? { color: accentColor, opacity: 0.12 } : undefined,
            markLine: showTarget && targetLine !== undefined ? {
              symbol: 'none',
              data: [
                {
                  yAxis: targetLine,
                  name: targetLabel || 'Meta',
                  lineStyle: {
                    color: targetColor,
                    type: 'dashed',
                    width: 2,
                  },
                  label: {
                    show: true,
                    position: 'end',
                    formatter: targetLabel || `Meta: ${targetLine}${unit ? ` ${unit}` : ''}`,
                    fontSize: 10,
                    color: targetColor,
                  },
                },
              ],
            } : undefined,
          },
        ],
      });

      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(ref.current);
      cleanup = () => {
        observer.disconnect();
        chart.dispose();
      };
    }).catch(() => {
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [type, title, categories, data, unit, customColor, targetLine, targetLabel, showTarget]);

  if (failed) {
    return <p role="alert" className="performance-body" style={{ color: 'var(--negative)' }}>No se pudo renderizar el gráfico vectorial.</p>;
  }

  return (
    <div
      ref={ref}
      className="chart"
      role="img"
      aria-label={`Gráfica de ${title}. Visualizando ${categories.length} registros.`}
      style={{ height: typeof height === 'number' ? `${height}px` : height, width: '100%' }}
    />
  );
}
