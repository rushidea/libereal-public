import { getIcon, type ProtocolSummary } from '@/data/protocols-summary';

export const difficultyBadgeClass: Record<ProtocolSummary['difficulty'], string> = {
  基础: 'bg-green-100/90 text-green-700',
  中级: 'bg-amber-100/90 text-amber-700',
  高级: 'bg-red-100/90 text-red-700',
};

export { getIcon };
