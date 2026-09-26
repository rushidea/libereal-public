import { generateId } from '@/lib/id';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id as string;

    const buffers = await prisma.userSavedBuffer.findMany({
      where: { userId, ownerScope: 'personal' },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      buffers: buffers.map((b) => ({
        id: b.id,
        name: b.name,
        type: b.calculatorType,
        parameters: JSON.parse(b.parameters),
        result: JSON.parse(b.result),
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
    });
  } catch (error) {
    console.error('[GET /api/user/buffers] error:', error);
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
    const { name, calculatorType, parameters, result } = body;

    if (!name || !calculatorType || !parameters || !result) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const id = generateId('buf');
    await prisma.userSavedBuffer.create({
      data: {
        id,
        userId,
        ownerScope: 'personal',
        name,
        calculatorType,
        parameters: JSON.stringify(parameters),
        result: JSON.stringify(result),
      },
    });

    return NextResponse.json({ id, message: 'Buffer saved successfully' }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/user/buffers] error:', error);
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
      return NextResponse.json({ error: 'Missing buffer ID' }, { status: 400 });
    }

    // Verify ownership
    const buffer = await prisma.userSavedBuffer.findFirst({
      where: { id, userId, ownerScope: 'personal' },
      select: { id: true },
    });
    if (!buffer) {
      return NextResponse.json({ error: 'Buffer not found' }, { status: 404 });
    }

    await prisma.userSavedBuffer.delete({ where: { id } });
    return NextResponse.json({ message: 'Buffer deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/user/buffers] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
