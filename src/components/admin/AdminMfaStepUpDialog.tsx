'use client';

import { useCallback, useRef, useState } from 'react';
import SecurityStepUpDialog from '@/components/security/SecurityStepUpDialog';

type PendingAction = (grantToken: string) => Promise<void>;

function isMfaStepUpError(error: string): boolean {
  return error === 'Admin MFA required'
    || error === 'Recent MFA verification required'
    || error === 'Admin authenticator policy required'
    || error === '安全验证已失效，请重新验证';
}

export function isAdminMfaStepUpResponse(status: number, error: unknown): boolean {
  return status === 403 && typeof error === 'string' && isMfaStepUpError(error);
}

export function useAdminMfaStepUp() {
  const pendingAction = useRef<PendingAction | null>(null);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const close = useCallback(() => {
    if (working) return;
    pendingAction.current = null;
    setOpen(false);
    setWorking(false);
  }, [working]);

  const begin = useCallback(async (action: PendingAction) => {
    pendingAction.current = action;
    setOpen(true);
  }, []);

  const dialog = open ? (
    <SecurityStepUpDialog
      open={open}
      action="admin_sensitive"
      title="管理员身份确认"
      description="当前管理操作需要再次确认身份。可使用验证器应用、手机短信或邮箱验证码。"
      onCancel={close}
      onVerified={async (grantToken) => {
        const action = pendingAction.current;
        pendingAction.current = null;
        setOpen(false);
        setWorking(true);
        if (action) await action(grantToken);
        setWorking(false);
      }}
    />
  ) : null;

  return { begin, dialog };
}
