import {
  Beaker,
  Droplets,
  Activity,
  Dna,
  Brain,
  Microscope,
  Factory,
  FlaskConical,
} from 'lucide-react';
import { buffers, type BufferDetail } from './buffers-detail';

export type BufferSummary = {
  id: string;
  name: string;
  category: string;
  icon: string;
  iconColor: string;
  bgColor: string;
  description: string;
};

const iconMap: Record<string, React.ElementType> = {
  Beaker,
  Droplets,
  Activity,
  Dna,
  Brain,
  Microscope,
  Factory,
  FlaskConical,
};

const iconToName = new Map<React.ElementType, string>(
  Object.entries(iconMap).map(([name, icon]) => [icon, name]),
);

export function getBufferIcon(iconName: string): React.ElementType {
  return iconMap[iconName] || Beaker;
}

function toSummary(buffer: BufferDetail): BufferSummary {
  return {
    id: buffer.id,
    name: buffer.name,
    category: buffer.category,
    icon: iconToName.get(buffer.icon) || 'Beaker',
    iconColor: buffer.iconColor,
    bgColor: buffer.bgColor,
    description: buffer.description,
  };
}

/** Card/list entries — derived from buffers-detail so counts stay in sync. */
export const bufferSummaries: BufferSummary[] = buffers.map(toSummary);

const categoryIcons: Record<string, React.ElementType> = {
  细胞培养: FlaskConical,
  免疫检测: Droplets,
  蛋白检测: Activity,
  分子生物学: Dna,
  蛋白研究: Brain,
  细胞成像: Microscope,
};

const categoryOrder = [
  '细胞培养',
  '免疫检测',
  '蛋白检测',
  '分子生物学',
  '蛋白研究',
  '细胞成像',
] as const;

export const bufferCategories = [
  { name: '全部', icon: Factory, count: bufferSummaries.length },
  ...categoryOrder.map((name) => ({
    name,
    icon: categoryIcons[name],
    count: bufferSummaries.filter((b) => b.category === name).length,
  })),
];
