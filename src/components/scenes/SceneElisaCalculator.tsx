'use client';

import { LineChart } from 'lucide-react';
import { sceneSurfaceClasses, type SceneTheme } from '@/lib/scene-theme';
import type { SceneUiCopy } from '@/lib/scene-ui-copy';
import ElisaCurveCalculator from '@/components/calculators/ElisaCurveCalculator';

type SceneElisaCalculatorProps = {
  theme: SceneTheme;
  guide: NonNullable<SceneUiCopy['calculatorGuide']>;
};

export default function SceneElisaCalculator({ theme, guide }: SceneElisaCalculatorProps) {
  const t = theme;
  return (
    <section className={`mb-8 p-4 sm:p-5 ${sceneSurfaceClasses.section}`}>
      <div className="mb-4 flex items-center gap-2">
        <LineChart className={`h-5 w-5 ${t.sectionIcon}`} />
        <h2 className={`text-lg font-semibold ${sceneSurfaceClasses.text}`}>{guide.sectionTitle}</h2>
      </div>
      <ElisaCurveCalculator
        guideTitle={guide.title}
        guideItems={guide.items}
        toolTitle={guide.toolTitle}
        toolSummary={guide.toolSummary}
      />
    </section>
  );
}
