'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface SpectrumDataPoint {
  wavelength: number;
  intensity: number;
}

interface DyeSpectrum {
  id: string;
  name: string;
  abbr: string;
  excitation: SpectrumDataPoint[];
  emission: SpectrumDataPoint[];
  laserLine: number[];
  channel: string;
  color: string;
}

interface SpectrumChartProps {
  spectra: DyeSpectrum[];
  selectedDyes: string[];
}

const SPECTRUM_COLORS = [
  '#1a0033', '#2d004d', '#4B0082', '#0000cc', '#0055ff', '#0088ff',
  '#00ccff', '#00ff88', '#00ff00', '#44dd00', '#88ff00', '#ffff00',
  '#ffcc00', '#ff8800', '#ff6600', '#ff3300', '#ff0000', '#cc0000', '#990000'
];

function generateSpectrumPath(
  data: { wavelength: number; intensity: number }[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>
): string {
  if (data.length === 0) return '';
  const line = d3.line<{ wavelength: number; intensity: number }>()
    .x(d => xScale(d.wavelength))
    .y(d => yScale(d.intensity))
    .curve(d3.curveMonotoneX);
  return line(data) || '';
}

function generateAreaPath(
  data: { wavelength: number; intensity: number }[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  baseline: number
): string {
  if (data.length === 0) return '';
  const area = d3.area<{ wavelength: number; intensity: number }>()
    .x(d => xScale(d.wavelength))
    .y0(baseline)
    .y1(d => yScale(d.intensity))
    .curve(d3.curveMonotoneX);
  return area(data) || '';
}

export default function SpectrumChart({
  spectra,
  selectedDyes,
}: SpectrumChartProps) {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);
  // Mobile breakpoint：< 640px (Tailwind sm-) 时把 SVG 内的右侧 legend 移到 chart 下方
  // —— 不然在手机屏幕上 legend 横向占 120px，光谱曲线被挤成窄条
  const [isMobile, setIsMobile] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mount-time init: client-only chart render + theme detection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
      
    setIsDark(document.documentElement.classList.contains('dark'));
    setIsMobile(window.matchMedia('(max-width: 639px)').matches);
    (window as unknown as Record<string, unknown>).__spectrumSvg = svgRef;
  }, []);

  // 监听 viewport 宽度变化（横竖屏切换、浏览器 resize）实时更新 isMobile
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__spectrumSvg = svgRef;
  }, [spectra, selectedDyes]);

  const renderChart = useCallback(() => {
    if (!svgRef.current || !containerRef.current) {
      return;
    }
    if (selectedDyes.length === 0 || spectra.length === 0) return;

    (window as unknown as Record<string, unknown>).__spectrumSvg = svgRef;

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth || 800;
    // Mobile 时高度略小 —— legend 已移到 chart 下方 React 渲染，不需要给右侧留空间
    const height = isMobile ? 320 : 340;

    // Mobile 不在 SVG 内画 legend：right margin 缩到 20，腾出空间给光谱曲线
    const margin = { top: 20, right: isMobile ? 20 : 120, bottom: 70, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr('width', width).attr('height', height);
    svg.selectAll('*').remove();

    const textColor = isDark ? '#e5e7eb' : '#666';
    const gridColor = isDark ? '#374151' : '#e5e7eb';

    const allWavelengths: number[] = [];
    spectra.forEach(s => {
      s.excitation.forEach(p => allWavelengths.push(p.wavelength));
      s.emission.forEach(p => allWavelengths.push(p.wavelength));
    });
    const minWl = allWavelengths.length > 0 ? Math.min(...allWavelengths) : 300;
    const maxWl = allWavelengths.length > 0 ? Math.max(...allWavelengths) : 850;

    const xScale = d3.scaleLinear().domain([minWl, maxWl]).range([0, innerWidth]);
    const yScale = d3.scaleLinear().domain([0, 100]).range([innerHeight, 0]);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'spectrumGradient')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '0%');

    SPECTRUM_COLORS.forEach((color, i) => {
      gradient.append('stop')
        .attr('offset', `${(i / (SPECTRUM_COLORS.length - 1)) * 100}%`)
        .attr('stop-color', color);
    });

    g.append('g')
      .selectAll('line')
      .data(yScale.ticks(5))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', gridColor)
      .attr('stroke-dasharray', '3,3');

    const xAxis = g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks([300, 400, 500, 600, 700, 800, 850]));

    xAxis.selectAll('text').attr('fill', textColor).attr('font-size', '11px');
    xAxis.selectAll('line').attr('stroke', textColor);
    xAxis.select('.domain').attr('stroke', textColor);

    const yAxis = g.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => `${d}%`));

    yAxis.selectAll('text').attr('fill', textColor).attr('font-size', '11px');
    yAxis.selectAll('line').attr('stroke', textColor);
    yAxis.select('.domain').attr('stroke', textColor);

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -40)
      .attr('x', -innerHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('fill', textColor)
      .text('%Excitation');

    const spectrumBarHeight = 20;
    const spectrumBarY = innerHeight + 8;

    g.append('rect')
      .attr('x', 0)
      .attr('y', spectrumBarY)
      .attr('width', innerWidth)
      .attr('height', spectrumBarHeight)
      .attr('fill', 'url(#spectrumGradient)')
      .attr('rx', 3);

    g.append('rect')
      .attr('x', 0)
      .attr('y', spectrumBarY)
      .attr('width', innerWidth)
      .attr('height', spectrumBarHeight)
      .attr('fill', 'none')
      .attr('stroke', isDark ? '#4B5563' : '#D1D5DB')
      .attr('stroke-width', 1)
      .attr('rx', 3);

    const spectrumTicks = [300, 400, 500, 600, 700, 800, 850];
    g.selectAll('.spectrum-tick')
      .data(spectrumTicks)
      .enter()
      .append('text')
      .attr('class', 'spectrum-tick')
      .attr('x', d => xScale(d))
      .attr('y', spectrumBarY + spectrumBarHeight + 16)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', textColor)
      .text(d => d);

    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 50)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('fill', textColor)
      .text('Wavelength (nm)');

    spectra.forEach((spectrum) => {
      const exPoints = spectrum.excitation;
      const emPoints = spectrum.emission;
      const color = spectrum.color;

      const exLinePath = generateSpectrumPath(exPoints, xScale, yScale);
      g.append('path')
        .attr('d', exLinePath)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-dasharray', '4,3')
        .attr('opacity', 0.8);

      const emAreaPath = generateAreaPath(emPoints, xScale, yScale, innerHeight);
      g.append('path')
        .attr('d', emAreaPath)
        .attr('fill', color)
        .attr('fill-opacity', 0.2)
        .attr('stroke', 'none');

      const emLinePath = generateSpectrumPath(emPoints, xScale, yScale);
      g.append('path')
        .attr('d', emLinePath)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round');
    });

    // Legend：桌面端在 SVG 右侧绘制；移动端跳过，由下方 React 组件渲染
    // （移动端 SVG 右侧空间宝贵，光谱曲线需要更多横向空间）
    if (!isMobile) {
      const legendX = innerWidth + 15;
      const legend = g.append('g')
        .attr('transform', `translate(${legendX}, 0)`);

      spectra.forEach((spectrum, i) => {
        const lg = legend.append('g')
          .attr('transform', `translate(0, ${i * 20})`);

        lg.append('line')
          .attr('x1', 0)
          .attr('x2', 12)
          .attr('y1', 0)
          .attr('y2', 0)
          .attr('stroke', spectrum.color)
          .attr('stroke-width', 2);

        lg.append('line')
          .attr('x1', 14)
          .attr('x2', 26)
          .attr('y1', 0)
          .attr('y2', 0)
          .attr('stroke', spectrum.color)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '4,3');

        lg.append('text')
          .attr('x', 30)
          .attr('y', 4)
          .attr('font-size', '11px')
          .attr('fill', textColor)
          .text(spectrum.abbr);
      });
    }

    const crosshair = g.append('line')
      .attr('class', 'crosshair')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', isDark ? '#9CA3AF' : '#666')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')
      .style('display', 'none');

    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'spectrum-tooltip')
      .style('position', 'absolute')
      .style('background', isDark ? 'rgba(55,65,81,0.95)' : 'rgba(0,0,0,0.85)')
      .style('color', 'white')
      .style('padding', '10px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('display', 'none')
      .style('pointer-events', 'none')
      .style('z-index', '1000')
      .style('box-shadow', '0 4px 6px rgba(0,0,0,0.3)');

    const bisect = d3.bisector((d: { wavelength: number }) => d.wavelength).left;

    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', function(event) {
        const [mx] = d3.pointer(event);
        const wavelength = Math.max(300, Math.min(850, xScale.invert(mx)));

        crosshair
          .attr('x1', mx)
          .attr('x2', mx)
          .style('display', 'block');

        let tooltipContent = `<div style="margin-bottom:6px;font-weight:600;border-bottom:1px solid #555;padding-bottom:4px">${Math.round(wavelength)} nm</div>`;

        spectra.forEach(spectrum => {
          const exIdx = bisect(spectrum.excitation, wavelength);
          const emIdx = bisect(spectrum.emission, wavelength);

          let exIntensity = '';
          let emIntensity = '';

          if (exIdx > 0 && exIdx < spectrum.excitation.length) {
            const p1 = spectrum.excitation[exIdx - 1];
            const p2 = spectrum.excitation[exIdx];
            const p = wavelength - p1.wavelength > p2.wavelength - wavelength ? p2 : p1;
            exIntensity = `<strong>${p.intensity}%</strong>`;
          }

          if (emIdx > 0 && emIdx < spectrum.emission.length) {
            const p1 = spectrum.emission[emIdx - 1];
            const p2 = spectrum.emission[emIdx];
            const p = wavelength - p1.wavelength > p2.wavelength - wavelength ? p2 : p1;
            emIntensity = `<strong>${p.intensity}%</strong>`;
          }

          tooltipContent += `<div style="margin:3px 0">
            <span style="display:inline-block;width:10px;height:10px;background:${spectrum.color};border-radius:2px;margin-right:6px"></span>${spectrum.abbr}:
            Ex ${exIntensity} / Em ${emIntensity}
          </div>`;
        });

        tooltip
          .html(tooltipContent)
          .style('display', 'block')
          .style('left', `${event.offsetX + 20}px`)
          .style('top', `${event.offsetY - 20}px`);
      })
      .on('mouseleave', function() {
        crosshair.style('display', 'none');
        tooltip.style('display', 'none');
      });

    return () => {
      tooltip.remove();
    };
  }, [spectra, selectedDyes, isDark, isMobile]);

  useEffect(() => {
    if (!mounted) return;
    const timer = setTimeout(renderChart, 100);
    return () => clearTimeout(timer);
  }, [mounted, renderChart]);

  useEffect(() => {
    if (!mounted) return;
    const handleResize = () => renderChart();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mounted, renderChart]);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          setIsDark(document.documentElement.classList.contains('dark'));
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  if (!mounted) {
    return (
      <div className={`flex items-center justify-center ${uiSurfaces.mutedText}`} style={{ height: '320px' }}>
        <div className="text-center">
          <p>图表加载中...</p>
        </div>
      </div>
    );
  }

  if (selectedDyes.length === 0 || spectra.length === 0) {
    return (
      <div className={`flex items-center justify-center ${uiSurfaces.mutedText}`} style={{ height: '320px' }}>
        <div className="text-center">
          <p>请从下方选择染料以查看光谱</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div ref={containerRef} style={{ width: '100%', height: isMobile ? '320px' : '360px', position: 'relative' }}>
        <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
      </div>
      {isMobile && spectra.length > 0 && (
        // 移动端 SVG legend 占位已让给光谱曲线 —— 这里 React 渲染 flex-wrap 染料图例
        // 每个 chip：实线（Em）+ 虚线（Ex）+ 染料缩写 + 通道
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs">
          {spectra.map((spectrum) => (
            <div key={spectrum.id} className="flex items-center gap-1.5">
              <span className="inline-flex items-center" aria-hidden>
                <span
                  className="inline-block h-0.5 w-3"
                  style={{ backgroundColor: spectrum.color }}
                />
              </span>
              <span className="inline-flex items-center" aria-hidden>
                <span
                  className="inline-block h-0.5 w-3"
                  style={{
                    backgroundColor: spectrum.color,
                    backgroundImage: `linear-gradient(to right, ${spectrum.color} 60%, transparent 60%)`,
                    backgroundSize: '6px 1.5px',
                    backgroundRepeat: 'repeat-x',
                  }}
                />
              </span>
              <span className={`font-medium ${uiSurfaces.text}`}>
                {spectrum.abbr}
              </span>
              <span className={`text-[10px] ${uiSurfaces.mutedText}`}>
                {spectrum.channel}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
