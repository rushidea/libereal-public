UPDATE "organization_roles"
SET "name" = '审计员'
WHERE "key" = 'admin' AND "is_system" = 1;

UPDATE "organization_roles"
SET "name" = '研究员'
WHERE "key" = 'researcher' AND "is_system" = 1;

UPDATE "organization_roles"
SET "name" = '采购'
WHERE "key" = 'purchasing' AND "is_system" = 1;
