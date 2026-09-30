import { describe, it, expect } from 'vitest';
import { assertEmulator } from '../firebase-testing/index.js';

describe('assertEmulator', () => {
  it('assertEmulator throws without env', () => {
    expect(() => assertEmulator({})).toThrow('FIRESTORE_EMULATOR_HOST is not set – refusing to run against a real project');
  });

  it('passes with env', () => {
    expect(() => assertEmulator({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).not.toThrow();
  });
});
