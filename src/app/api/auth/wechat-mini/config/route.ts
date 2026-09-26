import { NextResponse } from 'next/server';

export async function GET() {
  const reviewMode = process.env.WECHAT_MINI_REVIEW_MODE === '1';
  const reviewChallengeId = reviewMode
    ? process.env.WECHAT_MINI_REVIEW_CHALLENGE_ID?.trim() || 'wmc_review_audit'
    : null;
  return NextResponse.json({ reviewMode, reviewChallengeId });
}
