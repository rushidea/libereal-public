'use client';

import { useMarkNotificationModuleRead } from '@/context/CustomerNotificationsContext';
import type { CustomerNotificationModule } from '@/lib/customer-notification-modules';

/** Clears one sidebar module's unread badge while this view is mounted. */
export default function MarkNotificationModuleRead({ module }: { module: CustomerNotificationModule }) {
  useMarkNotificationModuleRead(module);
  return null;
}
