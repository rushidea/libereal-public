'use client';

import { useState, Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Wrench } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import ProtocolDetailModal from '@/components/ProtocolDetailModal';
import CalculatorsPanel from '@/components/calculators/CalculatorsPanel';
import { isCalculatorType } from '@/components/calculators/CalculatorSelector';
import SpectrumViewer from '@/components/spectra/SpectrumViewer';
import CDMarkerTable from '@/components/support/CDMarkerTable';
import SupportSearchBar from '@/components/support/SupportSearchBar';
import SupportTabs from '@/components/support/SupportTabs';
import SupportCategoryPills from '@/components/support/SupportCategoryPills';
import SupportResourceGrid from '@/components/support/SupportResourceGrid';
import SupportFaqPanel from '@/components/support/SupportFaqPanel';
import { protocolSummaries, protocolCategories } from '@/data/protocols-summary';
import { bufferSummaries, bufferCategories } from '@/data/buffers-summary';
import { getProtocolById } from '@/data/protocols-detail';
import { getBufferById } from '@/data/buffers-detail';
import { uiSurfaces } from '@/lib/ui-surfaces';
import type { Protocol } from '@/data/protocols-detail';
import type { BufferDetail } from '@/data/buffers-detail';
import type { ProtocolSummary } from '@/data/protocols-summary';
import type { BufferSummary } from '@/data/buffers-summary';
import { isSupportTab, type SupportTab } from '@/components/support/types';

function SupportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<SupportTab>('protocols');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [protocolDetails, setProtocolDetails] = useState<Record<string, Protocol>>({});
  const [bufferDetails, setBufferDetails] = useState<Record<string, BufferDetail>>({});
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (isSupportTab(tab)) {
      setActiveTab(tab);
      return;
    }
    setActiveTab('protocols');
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleTabChange = (tab: SupportTab) => {
    setActiveTab(tab);
    setSelectedCategory('全部');
    setSearchQuery('');
    setExpandedId(null);
    setOpenFaq(null);

    if (tab === 'protocols') {
      router.replace('/support');
    } else {
      router.replace(`/support?tab=${tab}`);
    }
  };

  const handleCardClick = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }

    setLoadingId(id);

    if (activeTab === 'protocols') {
      const data = getProtocolById(id);
      if (data) {
        setProtocolDetails((prev) => ({ ...prev, [id]: data }));
      }
    } else {
      const data = getBufferById(id);
      if (data) {
        setBufferDetails((prev) => ({ ...prev, [id]: data }));
      }
    }

    setLoadingId(null);
    setExpandedId(id);
  };

  const handleCloseModal = () => {
    setExpandedId(null);
  };

  const categories =
    activeTab === 'protocols' ? protocolCategories : activeTab === 'buffers' ? bufferCategories : [];
  const calculatorParam = searchParams.get('calculator');
  const initialCalculatorType = isCalculatorType(calculatorParam) ? calculatorParam : undefined;

  const filteredProtocols = protocolSummaries.filter((p) => {
    const matchCategory = selectedCategory === '全部' || p.category === selectedCategory;
    const matchSearch =
      !searchQuery ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const filteredBuffers = bufferSummaries.filter((b) => {
    const matchCategory = selectedCategory === '全部' || b.category === selectedCategory;
    const matchSearch =
      !searchQuery ||
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const currentItems = activeTab === 'protocols' ? filteredProtocols : filteredBuffers;

  const expandedItem = currentItems.find((item) => item.id === expandedId);
  const isProtocol = activeTab === 'protocols';
  const detailData = expandedItem
    ? isProtocol
      ? protocolDetails[expandedItem.id] || null
      : bufferDetails[expandedItem.id] || null
    : null;

  const showCategoryPills =
    activeTab !== 'calculators' && activeTab !== 'faqs' && activeTab !== 'spectra' && activeTab !== 'cd-markers';

  return (
    <>
      <AdaptiveHeader showNav={true} />

      <div className={`min-h-screen pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className={`mb-6 flex items-center gap-4 rounded-3xl p-4 sm:p-5 ${uiSurfaces.panelStrong}`}>
            <Link href="/" className="rounded-xl p-2 transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-100/70">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="w-12 h-12 bg-brand-500/90 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-lg shadow-brand-200/40">
              <Wrench className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className={`text-2xl font-semibold tracking-tight ${uiSurfaces.titleText}`}>实验与支持</h1>
              <p className={`mt-0.5 text-sm ${uiSurfaces.mutedText}`}>Protocol、缓冲液、计算器与常见问题。</p>
            </div>
          </div>

          <SupportSearchBar
            activeTab={activeTab}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />

          <SupportTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />

          {showCategoryPills ? (
            <SupportCategoryPills
              activeTab={activeTab}
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
            />
          ) : null}

          {activeTab === 'faqs' ? (
            <SupportFaqPanel
              searchQuery={searchQuery}
              openFaq={openFaq}
              onToggleFaq={setOpenFaq}
            />
          ) : activeTab === 'calculators' ? (
            <CalculatorsPanel key={initialCalculatorType ?? 'default'} initialType={initialCalculatorType} />
          ) : activeTab === 'spectra' ? (
            <SpectrumViewer />
          ) : activeTab === 'cd-markers' ? (
            <CDMarkerTable searchQuery={searchQuery} />
          ) : (
            <SupportResourceGrid
              activeTab={activeTab}
              items={currentItems as Array<ProtocolSummary | BufferSummary>}
              searchQuery={searchQuery}
              selectedCategory={selectedCategory}
              onCardClick={handleCardClick}
            />
          )}
        </main>
      </div>

      <MobileBottomNav />
      <SiteFooter />

      {expandedItem ? (
        <ProtocolDetailModal
          item={expandedItem}
          isProtocol={isProtocol}
          detailData={detailData}
          isLoading={loadingId === expandedItem.id}
          onClose={handleCloseModal}
        />
      ) : null}
    </>
  );
}

export default function SupportClient() {
  return (
    <Suspense fallback={<div className={`min-h-screen ${uiSurfaces.servicePage}`} />}>
      <SupportContent />
    </Suspense>
  );
}
