import { protocolSummaries, getIcon, type ProtocolSummary } from '@/data/protocols-summary';

/** Featured protocols on homepage — ids must exist in protocols-summary */
export const HOME_FEATURED_PROTOCOL_IDS = [
  'western-blot',
  'elisa-sandwich',
  'immunofluorescence',
  'ihc',
  'flow-cytometry',
  'crispr-cas9',
] as const;

export function getHomeFeaturedProtocols(): ProtocolSummary[] {
  const byId = new Map(protocolSummaries.map((p) => [p.id, p]));
  return HOME_FEATURED_PROTOCOL_IDS.map((id) => byId.get(id)).filter(
    (p): p is ProtocolSummary => p != null
  );
}

export const difficultyBadgeClass: Record<ProtocolSummary['difficulty'], string> = {
  基础: 'bg-green-100/90 text-green-700',
  中级: 'bg-amber-100/90 text-amber-700',
  高级: 'bg-red-100/90 text-red-700',
};

export { getIcon };
