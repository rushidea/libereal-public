// @vitest-environment node

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { recordSecurityEvent } from '@/lib/security/security-events';

function createEventSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE SecurityEvent (
      id TEXT PRIMARY KEY,
      userId TEXT,
      eventType TEXT NOT NULL,
      ip TEXT,
      userAgent TEXT,
      metadata TEXT,
      createdAt TEXT NOT NULL
    );
  `);
}

describe('security events', () => {
  it('persists uppercase events with trimmed context and JSON metadata', () => {
    const db = new Database(':memory:');
    createEventSchema(db);
    recordSecurityEvent(db, {
      userId: 'user-1',
      eventType: 'MFA_ENABLED',
      ip: ' 1.2.3.4 ',
      userAgent: 'test-agent',
      metadata: { method: 'totp', provider: 'setup' },
    });
    recordSecurityEvent(db, {
      userId: null,
      eventType: 'LOGIN_FAILED',
      metadata: { reason: 'invalid_password', secret: 'must-not-persist' },
    });

    const rows = db.prepare('SELECT userId, eventType, ip, userAgent, metadata FROM SecurityEvent ORDER BY createdAt').all() as Array<{
      userId: string | null;
      eventType: string;
      ip: string | null;
      userAgent: string | null;
      metadata: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: 'user-1', eventType: 'MFA_ENABLED', ip: '1.2.3.4', userAgent: 'test-agent' });
    expect(JSON.parse(rows[0].metadata ?? '{}')).toEqual({ method: 'totp', provider: 'setup' });
    expect(rows[1]).toMatchObject({ userId: null, eventType: 'LOGIN_FAILED', ip: null, userAgent: null, metadata: JSON.stringify({ reason: 'invalid_password' }) });

    recordSecurityEvent(db, {
      userId: 'owner-1',
      eventType: 'ORGANIZATION_APPROVAL_REVIEWED',
      metadata: {
        organizationId: 'org-1',
        approvalId: 'approval-1',
        action: 'approve',
        secret: 'must-not-persist',
      },
    });
    const organizationRow = db.prepare('SELECT eventType, metadata FROM SecurityEvent WHERE eventType = ?').get('ORGANIZATION_APPROVAL_REVIEWED') as {
      eventType: string;
      metadata: string | null;
    };
    expect(organizationRow.eventType).toBe('ORGANIZATION_APPROVAL_REVIEWED');
    expect(JSON.parse(organizationRow.metadata ?? '{}')).toEqual({
      organizationId: 'org-1',
      approvalId: 'approval-1',
      action: 'approve',
    });
    db.close();
  });
});
