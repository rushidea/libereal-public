ALTER TABLE "User" ADD COLUMN "institutionType" TEXT;
ALTER TABLE "User" ADD COLUMN "institutionName" TEXT;
ALTER TABLE "User" ADD COLUMN "institutionUnit" TEXT;
ALTER TABLE "User" ADD COLUMN "institutionFacility" TEXT;

UPDATE "User"
SET
  institutionType = '高校',
  institutionName = NULLIF(TRIM(school), ''),
  institutionUnit = NULLIF(TRIM(college), ''),
  department = COALESCE(NULLIF(TRIM(department), ''), NULLIF(TRIM(major), '')),
  institutionFacility = NULLIF(TRIM(building), '')
WHERE NULLIF(TRIM(school), '') IS NOT NULL;

WITH RECURSIVE split(id, rest, part, n) AS (
  SELECT
    id,
    REPLACE(REPLACE(REPLACE(institution, '－', '-'), '—', '-'), '–', '-'),
    '',
    0
  FROM "User"
  WHERE NULLIF(TRIM(institution), '') IS NOT NULL
    AND NULLIF(TRIM(institutionName), '') IS NULL
  UNION ALL
  SELECT
    id,
    CASE WHEN instr(rest, '-') > 0 THEN substr(rest, instr(rest, '-') + 1) ELSE '' END,
    TRIM(CASE WHEN instr(rest, '-') > 0 THEN substr(rest, 1, instr(rest, '-') - 1) ELSE rest END),
    n + 1
  FROM split
  WHERE rest <> '' AND n < 5
), parts AS (
  SELECT
    id,
    MAX(CASE WHEN n = 1 THEN part END) AS p1,
    MAX(CASE WHEN n = 2 THEN part END) AS p2,
    MAX(CASE WHEN n = 3 THEN part END) AS p3,
    MAX(CASE WHEN n = 4 THEN part END) AS p4,
    MAX(CASE WHEN n = 5 THEN part END) AS p5
  FROM split
  GROUP BY id
)
UPDATE "User"
SET
  institutionType = '待补充',
  institutionName = COALESCE(NULLIF(TRIM(institutionName), ''), (SELECT p1 FROM parts WHERE parts.id = "User".id)),
  institutionUnit = COALESCE(NULLIF(TRIM(institutionUnit), ''), (SELECT p2 FROM parts WHERE parts.id = "User".id)),
  department = COALESCE(NULLIF(TRIM(department), ''), (SELECT p3 FROM parts WHERE parts.id = "User".id)),
  institutionFacility = COALESCE(NULLIF(TRIM(institutionFacility), ''), (SELECT p4 FROM parts WHERE parts.id = "User".id)),
  piLab = COALESCE(NULLIF(TRIM(piLab), ''), (SELECT p5 FROM parts WHERE parts.id = "User".id))
WHERE id IN (SELECT id FROM parts);
