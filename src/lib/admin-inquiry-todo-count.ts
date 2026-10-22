import { prisma } from '@/lib/prisma';
import { adminInquiryTodoWhere } from '@/lib/admin-inquiry-todo';

export function countAdminInquiryTodos(createdBefore?: Date) {
  return prisma.inquiry.count({ where: adminInquiryTodoWhere(createdBefore) });
}
