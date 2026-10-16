// Thin React wrapper around uPlot: rebuilds when data/options change, resizes with its box.
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

export function Chart({ data, series, height = 220, yLabel }: {
  data: uPlot.AlignedData;
  series: uPlot.Series[];
  height?: number;
  yLabel?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    const css = getComputedStyle(el);
    const fg = css.getPropertyValue('--muted').trim() || '#666';
    const grid = css.getPropertyValue('--line').trim() || '#ddd';
    const axis = { stroke: fg, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } };
    const plot = new uPlot({
      width: el.clientWidth,
      height,
      series: [{}, ...series],
      axes: [axis, { ...axis, label: yLabel, size: 50 }],
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
    }, data, el);
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => { ro.disconnect(); plot.destroy(); };
  }, [data, series, height, yLabel]);
  return <div ref={box} className="chart" />;
}
