import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function testDatabasePath(prefix: string) {
  return join(tmpdir(), `${prefix}-${process.pid}-${randomUUID()}.db`);
}
