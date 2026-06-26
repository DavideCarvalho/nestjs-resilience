import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { VERSION } from './index';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

describe('scaffold', () => {
  it('exports a version that matches package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
