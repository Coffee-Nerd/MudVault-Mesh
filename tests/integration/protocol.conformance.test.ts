import { readFileSync } from 'fs';
import { join } from 'path';
import { validateMessage, validateMessageStrict } from '../../src/utils/validation';

// Language-neutral vectors. Any client or gateway can run the same file.
const vectors = JSON.parse(readFileSync(join(__dirname, '../../docs/protocol-vectors.json'), 'utf8')) as {
  valid: Array<{ name: string; message: unknown }>;
  invalid: Array<{ name: string; message: unknown }>;
};

describe('protocol conformance vectors', () => {
  test.each(vectors.valid.map(v => [v.name, v.message]))('accepts: %s', (_name, message) => {
    expect(validateMessage(JSON.parse(JSON.stringify(message))).error).toBeUndefined();
    expect(validateMessageStrict(JSON.parse(JSON.stringify(message))).error).toBeUndefined();
  });

  test.each(vectors.invalid.map(v => [v.name, v.message]))('rejects: %s', (_name, message) => {
    expect(validateMessage(JSON.parse(JSON.stringify(message))).error).toBeDefined();
  });
});
