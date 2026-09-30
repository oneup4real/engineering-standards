// Helpers for Firestore/Storage security-rules tests against the emulator.
// Every rules change needs tests for who IS allowed and who is NOT.

/**
 * Throws unless the Firestore emulator is configured, so rules/service tests can never hit production.
 * @param {Record<string, string | undefined>} [env]
 */
export function assertEmulator(env = process.env) {
  if (!env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set – refusing to run against a real project');
  }
}

/**
 * @param {{ projectId: string, rulesPath: string, storageRulesPath?: string }} opts
 */
export async function createRulesEnv({ projectId, rulesPath, storageRulesPath }) {
  assertEmulator();
  const [{ initializeTestEnvironment }, fs] = await Promise.all([
    import('@firebase/rules-unit-testing'),
    import('node:fs/promises'),
  ]);
  return initializeTestEnvironment({
    projectId,
    firestore: { rules: await fs.readFile(rulesPath, 'utf8') },
    ...(storageRulesPath ? { storage: { rules: await fs.readFile(storageRulesPath, 'utf8') } } : {}),
  });
}

/** Unauthenticated visitor. @param {any} env */
export const nobody = (env) => env.unauthenticatedContext();

/** Anonymous Firebase session: signed in, but must NOT count as a real user. @param {any} env */
export const anon = (env) => env.authenticatedContext('anon-user', { firebase: { sign_in_provider: 'anonymous' } });

/**
 * Signed-in user with roles in the token (custom claims).
 * @param {any} env @param {string} uid @param {string[]} roles
 */
export const withRoles = (env, uid, roles) => env.authenticatedContext(uid, { roles, firebase: { sign_in_provider: 'password' } });

/**
 * Writes test data bypassing the rules.
 * @param {any} env @param {string} docPath e.g. 'users/u1' @param {Record<string, unknown>} data
 */
export async function seed(env, docPath, data) {
  const { doc, setDoc } = await import('firebase/firestore');
  await env.withSecurityRulesDisabled(async (/** @type {any} */ ctx) => {
    await setDoc(doc(ctx.firestore(), docPath), data);
  });
}
