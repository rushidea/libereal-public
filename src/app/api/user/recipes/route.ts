import { generateId } from '@/lib/id';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id as string;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'buffer' | 'protocol' | null
    const status = searchParams.get('status'); // 'draft' | 'pending' | 'approved' | 'rejected' | null
    const id = searchParams.get('id');

    if (id) {
      const recipe = await prisma.userCreatedRecipe.findFirst({
        where: { id, userId, ownerScope: 'personal' },
      });
      if (!recipe) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
      }
      return NextResponse.json({
        recipe: {
          id: recipe.id,
          userId: recipe.userId,
          type: recipe.type,
          name: recipe.name,
          description: recipe.description,
          content: JSON.parse(recipe.content),
          status: recipe.status,
          rejectionReason: recipe.rejectionReason,
          submittedAt: recipe.submittedAt,
          reviewedAt: recipe.reviewedAt,
          reviewerId: recipe.reviewerId,
          createdAt: recipe.createdAt,
          updatedAt: recipe.updatedAt,
        },
      });
    }

    const where: Prisma.UserCreatedRecipeWhereInput = { userId, ownerScope: 'personal' };
    if (type) where.type = type;
    if (status) where.status = status;

    const recipes = await prisma.userCreatedRecipe.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      recipes: recipes.map((r) => ({
        id: r.id,
        userId: r.userId,
        type: r.type,
        name: r.name,
        description: r.description,
        content: JSON.parse(r.content),
        status: r.status,
        rejectionReason: r.rejectionReason,
        submittedAt: r.submittedAt,
        reviewedAt: r.reviewedAt,
        reviewerId: r.reviewerId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (error) {
    console.error('[GET /api/user/recipes] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id as string;

    const body = await request.json();
    const { type, name, description, content, status } = body;

    if (!type || !name || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!['buffer', 'protocol'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const id = generateId('rec');
    await prisma.userCreatedRecipe.create({
      data: {
        id,
        userId,
        ownerScope: 'personal',
        type,
        name,
        description: description || '',
        content: JSON.stringify(content),
        status: status || 'draft',
      },
    });

    return NextResponse.json({ id, message: 'Recipe created successfully' }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/user/recipes] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id as string;

    const body = await request.json();
    const { id, name, description, content, status } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing recipe ID' }, { status: 400 });
    }

    // Verify ownership
    const existing = await prisma.userCreatedRecipe.findFirst({
      where: { id, userId, ownerScope: 'personal' },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    const updateData: Prisma.UserCreatedRecipeUpdateInput = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (content !== undefined) updateData.content = JSON.stringify(content);
    if (status !== undefined) updateData.status = status;

    await prisma.userCreatedRecipe.update({ where: { id }, data: updateData });
    return NextResponse.json({ message: 'Recipe updated successfully' });
  } catch (error) {
    console.error('[PUT /api/user/recipes] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id as string;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing recipe ID' }, { status: 400 });
    }

    // Verify ownership
    const existing = await prisma.userCreatedRecipe.findFirst({
      where: { id, userId, ownerScope: 'personal' },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    await prisma.userCreatedRecipe.delete({ where: { id } });
    return NextResponse.json({ message: 'Recipe deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/user/recipes] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
