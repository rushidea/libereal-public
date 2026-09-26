'use client';

import { useEffect, useState } from 'react';
import { uiSurfaces } from '@/lib/ui-surfaces';

type OrganizationOption = {
  id: string;
  name: string;
  status: string;
  roles: Array<{ key: string }>;
  permissions?: string[];
};

type OrganizationContextSelectProps = {
  value: string;
  onChange: (organizationId: string) => void;
};

export default function OrganizationContextSelect({ value, onChange }: OrganizationContextSelectProps) {
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/organizations', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { organizations?: OrganizationOption[] } | null) => {
        if (cancelled) return;
        setOrganizations((data?.organizations || []).filter((organization) => (
          organization.status === 'active'
          && (Array.isArray(organization.permissions)
            ? organization.permissions.includes('organization.orders.create')
            : organization.roles?.some((role) => ['owner', 'purchasing'].includes(role.key)))
        )));
      })
      .catch(() => {
        if (!cancelled) setOrganizations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (organizations.length === 0) return null;

  return (
    <div className={`rounded-brand border p-4 ${uiSurfaces.panel}`}>
      <label htmlFor="organization-context" className={`block text-sm font-medium ${uiSurfaces.text}`}>
        采购归属
      </label>
      <select
        id="organization-context"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 w-full px-3.5 py-2.5 text-sm ${uiSurfaces.input}`}
      >
        <option value="">个人账户</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>{organization.name}</option>
        ))}
      </select>
    </div>
  );
}
