import { Search } from 'lucide-react';
import ProtocolCard from '@/components/ProtocolCard';
import BufferCard from '@/components/BufferCard';
import type { ProtocolSummary } from '@/data/protocols-summary';
import type { BufferSummary } from '@/data/buffers-summary';
import { uiSurfaces } from '@/lib/ui-surfaces';

type SupportResourceGridProps = {
  activeTab: 'protocols' | 'buffers';
  items: Array<ProtocolSummary | BufferSummary>;
  searchQuery: string;
  selectedCategory: string;
  onCardClick: (id: string) => void;
};

export default function SupportResourceGrid({
  activeTab,
  items,
  onCardClick,
}: SupportResourceGridProps) {
  const resourceLabel = activeTab === 'protocols' ? '方案' : '缓冲液';

  return (
    <>
      {items.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <div key={item.id}>
              {activeTab === 'protocols' ? (
                <ProtocolCard
                  protocol={item as ProtocolSummary}
                  isExpanded={false}
                  isHeaderOnly={true}
                  isLoading={false}
                  detailData={null}
                  onToggle={onCardClick}
                />
              ) : (
                <BufferCard
                  buffer={item as BufferSummary}
                  isExpanded={false}
                  isHeaderOnly={true}
                  isLoading={false}
                  detailData={null}
                  onToggle={onCardClick}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <Search className={`mx-auto mb-4 h-12 w-12 ${uiSurfaces.textQuaternary}`} />
          <h3 className={`mb-2 text-lg font-semibold ${uiSurfaces.titleText}`}>未找到相关{resourceLabel}</h3>
          <p className={`text-sm ${uiSurfaces.mutedText}`}>
            试试其他关键词，或浏览全部{resourceLabel}
          </p>
        </div>
      )}
    </>
  );
}
