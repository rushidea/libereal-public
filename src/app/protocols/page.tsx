'use client';

import Image from 'next/image';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { BookOpen, ArrowLeft, Search, X } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import ProtocolCard from '@/components/ProtocolCard';
import BufferCard from '@/components/BufferCard';
import ProtocolDetailModal from '@/components/ProtocolDetailModal';
import { protocolSummaries, protocolCategories, type ProtocolSummary } from '@/data/protocols-summary';
import { bufferSummaries, bufferCategories, type BufferSummary } from '@/data/buffers-summary';
import { getProtocolById } from '@/data/protocols-detail';
import { getBufferById } from '@/data/buffers-detail';
import type { UserRecipe, ProtocolContent, RecipeContent } from '@/components/community/types';
import type { Protocol } from '@/data/protocols-detail';
import type { BufferDetail } from '@/data/buffers-detail';
import CalculatorsPanel from '@/components/calculators/CalculatorsPanel';
import SpectrumViewer from '@/components/spectra/SpectrumViewer';

type TabType = 'protocols' | 'buffers' | 'community' | 'calculators' | 'spectra';

function ProtocolsContent() {
  const [activeTab, setActiveTab] = useState<TabType>('protocols');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [protocolDetails, setProtocolDetails] = useState<Record<string, Protocol>>({});
  const [bufferDetails, setBufferDetails] = useState<Record<string, BufferDetail>>({});
  const [communityRecipes, setCommunityRecipes] = useState<UserRecipe[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communitySubType, setCommunitySubType] = useState<'all' | 'protocol' | 'buffer'>('all');

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSelectedCategory('全部');
    setSearchQuery('');
    setExpandedId(null);
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
        setProtocolDetails(prev => ({ ...prev, [id]: data }));
      }
    } else {
      const data = getBufferById(id);
      if (data) {
        setBufferDetails(prev => ({ ...prev, [id]: data }));
      }
    }

    setLoadingId(null);
    setExpandedId(id);
  };

  const handleCloseModal = () => {
    setExpandedId(null);
  };

  // Fetch community recipes when community tab is selected
  useEffect(() => {
    if (activeTab === 'community' && communityRecipes.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCommunityLoading(true);
      fetch('/api/user/recipes/public')
        .then(r => r.json())
        .then(data => {
          setCommunityRecipes(data.recipes || []);
           
          setCommunityLoading(false);
        })
        .catch(() => {
           
          setCommunityLoading(false);
        });
    }
  }, [activeTab, communityRecipes.length]);

  const categories = activeTab === 'protocols' ? protocolCategories : activeTab === 'buffers' ? bufferCategories : [];

  const filteredProtocols = protocolSummaries.filter(p => {
    const matchCategory = selectedCategory === '全部' || p.category === selectedCategory;
    const matchSearch = !searchQuery ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const filteredBuffers = bufferSummaries.filter(b => {
    const matchCategory = selectedCategory === '全部' || b.category === selectedCategory;
    const matchSearch = !searchQuery ||
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const currentItems = activeTab === 'protocols' ? filteredProtocols : filteredBuffers;

  const expandedItem = currentItems.find(item => item.id === expandedId);
  const isProtocol = activeTab === 'protocols';
  const detailData = expandedItem
    ? isProtocol
      ? protocolDetails[expandedItem.id] || null
      : bufferDetails[expandedItem.id] || null
    : null;

  return (
    <>
      <AdaptiveHeader showNav={true} />

      <div className="min-h-screen libereal-service-page pb-16 lg:pb-0">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/"
            className="p-2 rounded-lg hover:bg-white/50 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div className="w-12 h-12 bg-brand-500/90 backdrop-blur-sm rounded-lg flex items-center justify-center shadow-lg shadow-brand-200/50">
            <BookOpen className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">实验方案库</h1>
            <p className="text-gray-500 text-sm mt-0.5">标准 Protocol，助力科研成功</p>
          </div>
        </div>

        {/* Search Input */}
        <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-lg p-4 mb-4">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'protocols' ? '搜索实验方案...' :
                activeTab === 'buffers' ? '搜索缓冲液配方...' :
                '搜索用户贡献...'
              }
              className="w-full pl-10 pr-10 py-2.5 border-2 border-brand-500/50 rounded-lg bg-white/70 text-gray-700 placeholder-gray-400 focus:border-brand-500 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => handleTabChange('protocols')}
            className={`min-w-max shrink-0 whitespace-nowrap rounded-lg px-4 py-3 font-medium transition-all sm:flex-1 ${
 activeTab === 'protocols'
 ? 'bg-brand-500/90 text-white shadow-lg shadow-brand-200/50'
 : 'bg-white/60 text-gray-600 hover:bg-white/80 border border-gray-200/50'
 }`}
          >
            实验方案
          </button>
          <button
            onClick={() => handleTabChange('buffers')}
            className={`min-w-max shrink-0 whitespace-nowrap rounded-lg px-4 py-3 font-medium transition-all sm:flex-1 ${
 activeTab === 'buffers'
 ? 'bg-emerald-500/90 text-white shadow-lg shadow-emerald-200/50'
 : 'bg-white/60 text-gray-600 hover:bg-white/80 border border-gray-200/50'
 }`}
          >
            缓冲液配制
          </button>
          <button
            onClick={() => handleTabChange('calculators')}
            className={`min-w-max shrink-0 whitespace-nowrap rounded-lg px-4 py-3 font-medium transition-all sm:flex-1 ${
 activeTab === 'calculators'
 ? 'bg-purple-500/90 text-white shadow-lg shadow-purple-200/50'
 : 'bg-white/60 text-gray-600 hover:bg-white/80 border border-gray-200/50'
 }`}
          >
            计算工具
          </button>
          <button
            onClick={() => handleTabChange('community')}
            className={`min-w-max shrink-0 whitespace-nowrap rounded-lg px-4 py-3 font-medium transition-all sm:flex-1 ${
 activeTab === 'community'
 ? 'bg-amber-500/90 text-white shadow-lg shadow-amber-200/50'
 : 'bg-white/60 text-gray-600 hover:bg-white/80 border border-gray-200/50'
 }`}
          >
            用户贡献
          </button>
          <button
            onClick={() => handleTabChange('spectra')}
            className={`min-w-max shrink-0 whitespace-nowrap rounded-lg px-4 py-3 font-medium transition-all sm:flex-1 ${
 activeTab === 'spectra'
 ? 'bg-orange-500/90 text-white shadow-lg shadow-orange-200/50'
 : 'bg-white/60 text-gray-600 hover:bg-white/80 border border-gray-200/50'
 }`}
          >
            荧光光谱
          </button>
        </div>

        {/* Category Pills - only show for protocols/buffers tabs */}
        {activeTab !== 'calculators' && activeTab !== 'community' && (
          <>
            <div className="flex flex-wrap gap-2 mb-6">
              {categories.map((cat) => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.name}
                    onClick={() => setSelectedCategory(cat.name)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
 selectedCategory === cat.name
 ? activeTab === 'protocols'
 ? 'bg-brand-500/90 text-white shadow-md'
 : 'bg-emerald-500/90 text-white shadow-md'
 : 'bg-white/60 text-gray-600 hover:bg-white/80 border border-gray-200/50'
 }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Results Info */}
            {(searchQuery || selectedCategory !== '全部') && (
              <div className="mb-4 text-sm text-gray-500">
                {searchQuery && <span>搜索 &quot;{searchQuery}&quot;，</span>}
                <span>找到 {currentItems.length} 个{activeTab === 'protocols' ? '方案' : '缓冲液'}</span>
              </div>
            )}
          </>
        )}

        {/* Calculators Panel - only show for calculators tab */}
        {activeTab === 'calculators' ? (
          <CalculatorsPanel />
        ) : activeTab === 'spectra' ? (
          <SpectrumViewer />
        ) : activeTab === 'community' ? (
          <div>
            {/* Sub-type filter */}
            <div className="flex gap-2 mb-4">
              {(['all', 'protocol', 'buffer'] as const).map(t => {
                const labels = { all: '全部', protocol: '实验方案', buffer: '缓冲液/配方' };
                return (
                  <button
                    key={t}
                    onClick={() => setCommunitySubType(t)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
 communitySubType === t
 ? 'bg-amber-500 text-white'
 : 'bg-white/70 text-gray-600 hover:bg-gray-50 border border-gray-200/50'
 }`}
                  >
                    {labels[t]}
                  </button>
                );
              })}
            </div>

            {communityLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
              </div>
            ) : communityRecipes.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">暂无用户贡献内容</p>
                <p className="text-gray-400 text-xs mt-1">登录后可在&quot;我的实验方案&quot;/&quot;我的配方&quot;中创建</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {communityRecipes
                  .filter(r => communitySubType === 'all' || r.type === communitySubType)
                  .filter(r => !searchQuery ||
                    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (r.description || '').toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((recipe) => {
                    const content = recipe.content;
                    const displayName = recipe.wechatNickname || recipe.authorName || '匿名用户';
                    const link = recipe.type === 'protocol'
                      ? `/protocols/user/${recipe.id}`
                      : `/protocols/buffers/user/${recipe.id}`;
                    return (
                      <Link
                        key={recipe.id}
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-white/70 backdrop-blur-md border border-white/70 rounded-2xl p-5 hover:shadow-lg hover:border-amber-200 transition-all"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs px-2 py-0.5 bg-brand-100 text-brand-700 rounded-full font-medium">
                            {recipe.type === 'protocol' ? '实验方案' : '配方'}
                          </span>
                          <span className="text-xs text-gray-400">用户贡献</span>
                        </div>
                        <h3 className="font-semibold text-gray-800 mb-1 line-clamp-2">
                          {recipe.type === 'protocol' ? (content as ProtocolContent).title : (content as RecipeContent).name}
                        </h3>
                        {content.category && (
                          <p className="text-xs text-gray-500 mb-2">{content.category}</p>
                        )}
                        {recipe.description && (
                          <p className="text-xs text-gray-600 line-clamp-2 mb-3">{recipe.description}</p>
                        )}
                        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-xs font-medium flex-shrink-0 overflow-hidden">
                            {recipe.displayAvatarUrl ? (
                              <Image src={recipe.displayAvatarUrl} alt={displayName} width={20} height={20} className="w-full h-full object-cover" suppressHydrationWarning />
                            ) : (
                              displayName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{displayName}</p>
                        </div>
                      </Link>
                    );
                  })}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Cards Grid */}
            {currentItems.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentItems.map((item: ProtocolSummary | BufferSummary) => (
              <div key={item.id}>
                {activeTab === 'protocols' ? (
                  <ProtocolCard
                    protocol={item as ProtocolSummary}
                    isExpanded={false}
                    isHeaderOnly={true}
                    isLoading={false}
                    detailData={null}
                    onToggle={handleCardClick}
                  />
                ) : (
                  <BufferCard
                    buffer={item as BufferSummary}
                    isExpanded={false}
                    isHeaderOnly={true}
                    isLoading={false}
                    detailData={null}
                    onToggle={handleCardClick}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">未找到相关{activeTab === 'protocols' ? '方案' : '缓冲液'}</h3>
            <p className="text-gray-400 text-sm">试试其他关键词，或浏览全部{activeTab === 'protocols' ? '方案' : '缓冲液'}</p>
          </div>
        )}
          </>
        )}
      </main>
      </div>

      <MobileBottomNav />
      <SiteFooter />

      {/* Detail Modal */}
      {expandedItem && (
        <ProtocolDetailModal
          item={expandedItem}
          isProtocol={isProtocol}
          detailData={detailData}
          isLoading={loadingId === expandedItem.id}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
}

export default function ProtocolsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <ProtocolsContent />
    </Suspense>
  );
}
