UPDATE "organization_roles"
SET "permissions" = '["organization.read","organization.members.read","organization.members.invite","organization.members.manage","organization.roles.manage","organization.profile.edit","organization.records.read","organization.approvals.read","organization.approvals.review","organization.settings.manage","organization.orders.create","organization.orders.review","organization.inquiries.create","organization.pricing.read"]'
WHERE "key" = 'owner' AND "is_system" = 1;

UPDATE "organization_roles"
SET "permissions" = '["organization.read","organization.members.read","organization.members.invite","organization.members.manage","organization.records.read","organization.approvals.read","organization.approvals.review","organization.settings.manage","organization.orders.review","organization.pricing.read"]'
WHERE "key" = 'admin' AND "is_system" = 1;
