import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export function testDatabasePath(prefix: string) {
  const directory = process.env.LIBEREAL_TEST_DB_DIR;
  if (!directory) throw new Error('SQLite test fixtures require an initialized test suite');
  return join(directory, `${prefix}-${randomUUID()}.db`);
}
