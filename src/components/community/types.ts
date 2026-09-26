// Data structures for user-created content (protocols & recipes/buffers)
import { uiSurfaces } from '@/lib/ui-surfaces';

export type ProtocolContent = {
  title: string;
  category: string;
  difficulty: '基础' | '中级' | '高级';
  duration: string;
  description: string;
  steps: string[];
  tips: string[];
  relatedProducts: { name: string; cat: string; code: string }[];
};

export type RecipeContent = {
  name: string;
  category: string;
  description: string;
  components: { name: string; amount: string; notes?: string }[];
  preparation: string[];
  storage: string;
  notes: string;
  relatedProducts: { name: string; cat: string; code: string }[];
};

type RecipeStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export type UserRecipe = {
  id: string;
  userId: string;
  type: 'protocol' | 'buffer';
  name: string;
  description: string;
  content: ProtocolContent | RecipeContent;
  status: RecipeStatus;
  rejectionReason?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewerId?: string;
  createdAt: string;
  updatedAt: string;
  authorName?: string;
  wechatNickname?: string;
  displayAvatarUrl?: string;
  userName?: string;
  userEmail?: string;
};

export const PROTOCOL_CATEGORIES = [
  '蛋白检测', '免疫检测', '细胞培养', '细胞成像',
  '细胞结构与功能', '分子生物学', '蛋白研究', '细胞分析',
  '单细胞分析', '磁珠分选', '放射免疫', '细胞分离',
];

export const RECIPE_CATEGORIES = [
  '缓冲液', '染色液', '培养基', '裂解液', '电泳液', '其他',
];

export const DIFFICULTY_OPTIONS: Array<'基础' | '中级' | '高级'> = ['基础', '中级', '高级'];

export const STATUS_CONFIG: Record<RecipeStatus, { label: string; color: string; description: string }> = {
  draft: { label: '草稿', color: uiSurfaces.badge, description: '未提交，仅自己可见' },
  pending: { label: '待审核', color: uiSurfaces.badgeWarning, description: '已提交，等待管理员审核' },
  approved: { label: '已批准', color: uiSurfaces.badgeSuccess, description: '已通过审核，公开显示' },
  rejected: { label: '已拒绝', color: uiSurfaces.badgeError, description: '未通过审核，可修改后重新提交' },
};
