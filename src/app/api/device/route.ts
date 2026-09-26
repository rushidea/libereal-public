import { NextResponse } from 'next/server';

export function GET(request: Request) {
  const ua = request.headers.get('user-agent') || '';
  const isMobile = /iPhone|iPad|iPod|Android|Mobile|BlackBerry|Windows Phone/i.test(ua);

  const response = NextResponse.json({ isMobile });
  response.cookies.set('device-type', isMobile ? 'mobile' : 'desktop', {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}