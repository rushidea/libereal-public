import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/**
 * Canonical security event types for identity and organization security. Values are uppercase and
 * intentionally stable so dashboards and audit exports can rely on them.
 * Sensitive values (OTP, recovery code, secret, private key) must never be
 * stored in `metadata` or logs.
 */
export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'MFA_FAILED'
  | 'MFA_SUCCESS'
  | 'SECURITY_STEP_UP_SUCCESS'
  | 'SECURITY_STEP_UP_FAILED'
  | 'RECOVERY_USED'
  | 'RECOVERY_CODES_REGENERATED'
  | 'PASSKEY_CREATED'
  | 'PASSKEY_RENAMED'
  | 'PASSKEY_DELETED'
  | 'PASSKEY_LOGIN_SUCCESS'
  | 'PASSKEY_LOGIN_FAILED'
  | 'AUTHENTICATOR_DATA_CONFLICT'
  | 'ORGANIZATION_CREATED'
  | 'ORGANIZATION_ACTIVATED'
  | 'ORGANIZATION_REJECTED'
  | 'ORGANIZATION_PROFILE_CHANGE_REQUESTED'
  | 'ORGANIZATION_PROFILE_UPDATED'
  | 'ORGANIZATION_PROFILE_CHANGE_REJECTED'
  | 'ORGANIZATION_MEMBER_INVITED'
  | 'ORGANIZATION_INVITATION_ACCEPTED'
  | 'ORGANIZATION_INVITATION_DECLINED'
  | 'ORGANIZATION_MEMBER_LEFT'
  | 'ORGANIZATION_ROLE_CHANGED'
  | 'ORGANIZATION_MEMBER_INVITE_REQUESTED'
  | 'ORGANIZATION_ROLE_CHANGE_REQUESTED'
  | 'ORGANIZATION_APPROVAL_REVIEWED';

export interface SecurityEventInput {
  userId: string | null;
  eventType: SecurityEventType;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, string>;
}

const SECURITY_EVENT_METADATA_KEYS = new Set([
  'authenticatorId',
  'method',
  'provider',
  'action',
  'reason',
  'organizationId',
  'memberId',
  'approvalId',
  'action',
  'roleKey',
  'status',
  'oldName',
  'newName',
]);

export function recordSecurityEvent(db: Database.Database, input: SecurityEventInput): void {
  const metadata = input.metadata
    ? Object.fromEntries(Object.entries(input.metadata).filter(([key]) => SECURITY_EVENT_METADATA_KEYS.has(key)))
    : null;
  db.prepare(`
    INSERT INTO SecurityEvent (id, userId, eventType, ip, userAgent, metadata, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.userId,
    input.eventType,
    input.ip?.trim() || null,
    input.userAgent?.trim() || null,
    metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    new Date().toISOString(),
  );
}
