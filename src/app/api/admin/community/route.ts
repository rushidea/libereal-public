import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin('content.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 'pending' | 'approved' | 'rejected' | null

    const where: Prisma.UserCreatedRecipeWhereInput = {};
    if (status) where.status = status;

    const recipes = await prisma.userCreatedRecipe.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } },
    });

    return NextResponse.json({
      recipes: recipes.map((r) => ({
        id: r.id,
        userId: r.userId,
        type: r.type,
        name: r.name,
        description: r.description,
        status: r.status,
        rejectionReason: r.rejectionReason,
        submittedAt: r.submittedAt,
        reviewedAt: r.reviewedAt,
        reviewerId: r.reviewerId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        content: JSON.parse(r.content),
        userName: r.user?.name ?? null,
        userEmail: r.user?.email ?? '',
      })),
    });
  } catch (error) {
    console.error('[GET /api/admin/community] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin('content.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json();
    const { recipeId, action, rejectionReason } = body;

    if (!recipeId || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!['approve', 'reject', 'revoke'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const recipe = await prisma.userCreatedRecipe.findUnique({ where: { id: recipeId } });
    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    const now = new Date();
    let newStatus: string;
    let reviewedAt: Date | null = now;
    let reason: string | null = rejectionReason || null;

    switch (action) {
      case 'approve':
        newStatus = 'approved';
        break;
      case 'reject':
        newStatus = 'rejected';
        if (!reason) {
          return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 });
        }
        break;
      case 'revoke':
        newStatus = 'draft';
        reviewedAt = null;
        reason = null;
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Look up author email for notification
    const author = await prisma.user.findUnique({
      where: { id: recipe.userId },
      select: { email: true },
    });

    // Update recipe
    await prisma.userCreatedRecipe.update({
      where: { id: recipeId },
      data: {
        status: newStatus,
        rejectionReason: reason,
        reviewedAt,
        reviewerId: admin.id,
      },
    });

    // Send notification to user
    if (author) {
      let notifTitle = '';
      let notifContent = '';
      switch (action) {
        case 'approve':
          notifTitle = '配方审核通过';
          notifContent = `您的配方"${recipe.name}"已审核通过，现已公开显示。感谢您的贡献！`;
          break;
        case 'reject':
          notifTitle = '配方审核未通过';
          notifContent = `您的配方"${recipe.name}"未通过审核。原因：${reason}`;
          break;
        case 'revoke':
          notifTitle = '配方收录被撤销';
          notifContent = `您的配方"${recipe.name}"已被撤销公开显示资格。如有疑问请联系管理员。`;
          break;
      }
      await prisma.notification.create({
        data: {
          userId: recipe.userId,
          email: author.email,
          role: 'customer',
          type: 'system',
          title: notifTitle,
          content: notifContent,
        },
      });
    }

    return NextResponse.json({ message: `Recipe ${action}d successfully` });
  } catch (error) {
    console.error('[POST /api/admin/community] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
