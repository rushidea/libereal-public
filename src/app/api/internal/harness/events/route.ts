import { NextRequest } from 'next/server';
import { authorizeHarnessEventRequest, harnessError, harnessSuccess } from '@/lib/harness-tools/auth';
import { parseEventFeedQuery, readEventFeed } from '@/lib/harness-tools/event-feed';

export async function GET(req: NextRequest) {
  const auth = authorizeHarnessEventRequest(req);
  if (!auth.ok) return auth.response;

  const query = parseEventFeedQuery(req.nextUrl.searchParams, auth.principal, auth.pilotInquiryIds);
  if (!query) {
    return harnessError(400, 'validation_error', 'INVALID_EVENT_QUERY', '事件查询须提供有效的起始时间或本客户端的延续游标');
  }

  try {
    const page = await readEventFeed(query);
    if (!page) {
      return harnessError(409, 'version_conflict', 'EVENT_CURSOR_STALE', '事件游标对应的来源记录已变化，请核对事件后再恢复');
    }
    const response = harnessSuccess('list_events', auth.principal, null, page);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    return harnessError(500, 'internal_error', 'EVENT_FEED_UNAVAILABLE', '暂时无法读取事件，请稍后再试', true);
  }
}
