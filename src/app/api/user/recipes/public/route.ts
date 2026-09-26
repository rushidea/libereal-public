import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'buffer' | 'protocol' | null
    const id = searchParams.get('id'); // single recipe detail

    if (id) {
      const recipe = await prisma.userCreatedRecipe.findFirst({
        where: { id, status: 'approved', ownerScope: 'personal' },
        include: {
          user: { select: { name: true, wechatNickname: true, displayAvatarUrl: true } },
        },
      });
      if (!recipe) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
      }
      return NextResponse.json({
        recipe: {
          id: recipe.id,
          type: recipe.type,
          name: recipe.name,
          description: recipe.description,
          content: JSON.parse(recipe.content),
          createdAt: recipe.createdAt,
          updatedAt: recipe.updatedAt,
          authorName: recipe.user?.name ?? null,
          wechatNickname: recipe.user?.wechatNickname ?? null,
          displayAvatarUrl: recipe.user?.displayAvatarUrl ?? null,
        },
      });
    }

    const where: { status: string; ownerScope: string; type?: string } = { status: 'approved', ownerScope: 'personal' };
    if (type) where.type = type;

    const recipes = await prisma.userCreatedRecipe.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        user: { select: { name: true, wechatNickname: true, displayAvatarUrl: true } },
      },
    });

    return NextResponse.json({
      recipes: recipes.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        description: r.description,
        content: JSON.parse(r.content),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        authorName: r.user?.name ?? null,
        wechatNickname: r.user?.wechatNickname ?? null,
        displayAvatarUrl: r.user?.displayAvatarUrl ?? null,
      })),
    });
  } catch (error) {
    console.error('[GET /api/user/recipes/public] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
