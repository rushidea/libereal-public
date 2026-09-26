import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id as string;

    const body = await request.json();
    const { recipeId } = body;

    if (!recipeId) {
      return NextResponse.json({ error: 'Missing recipe ID' }, { status: 400 });
    }

    // Verify ownership and status
    const recipe = await prisma.userCreatedRecipe.findFirst({
      where: { id: recipeId, userId },
      select: { status: true },
    });
    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    if (recipe.status !== 'draft' && recipe.status !== 'rejected') {
      return NextResponse.json({ error: 'Recipe already submitted' }, { status: 400 });
    }

    const now = new Date();
    await prisma.userCreatedRecipe.update({
      where: { id: recipeId },
      data: {
        status: 'pending',
        submittedAt: now,
        rejectionReason: null,
        updatedAt: now,
      },
    });

    return NextResponse.json({ message: 'Recipe submitted successfully' });
  } catch (error) {
    console.error('[POST /api/user/recipes/submit] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
