'use client';

import { Sparkles } from 'lucide-react';
import SpectrumViewer from '@/components/spectra/SpectrumViewer';
import { sceneSurfaceClasses, type SceneTheme } from '@/lib/scene-theme';

type SceneFlowSpectrumViewerProps = {
  theme: SceneTheme;
};

export default function SceneFlowSpectrumViewer({ theme }: SceneFlowSpectrumViewerProps) {
  return (
    <section className="mb-8">
      <div className="mb-4">
        <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${theme.stepBadge}`}>
          <Sparkles className={`h-4 w-4 ${theme.stepIcon}`} />
          Panel 光谱检查
        </div>
        <h2 className={`text-xl font-bold ${sceneSurfaceClasses.text}`}>荧光光谱与仪器通道</h2>
        <p className={`mt-1 max-w-3xl text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>
          选择常用流式染料，结合预设仪器或手动激光/滤光片配置，快速查看激发、发射光谱与通道兼容性。
        </p>
      </div>
      <SpectrumViewer />
    </section>
  );
}
