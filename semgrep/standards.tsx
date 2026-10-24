// Fixtures for standards.yml. `semgrep --test` expects the rule file and this file side by side.
// Not copied into projects; it only proves the rules in the package.
"use server";

declare function requireStaff(): Promise<void>;
declare function db(): Promise<void>;
declare const DOMPurify: { sanitize(s: string): string };
declare const el: HTMLElement;
declare const userHtml: string;

// ruleid: standards.server-action-error-message-passthrough
export async function leaky() {
  await requireStaff();
  try {
    await db();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ok: standards.server-action-error-message-passthrough
export async function safe() {
  await requireStaff();
  try {
    await db();
  } catch (e) {
    console.error(e);
    return { success: false, error: "Something went wrong", code: "internal" };
  }
}

export function sinks() {
  // ruleid: standards.unsanitized-html-sink
  el.innerHTML = userHtml;
  // ok: standards.unsanitized-html-sink
  el.innerHTML = "<b>static</b>";
  // ok: standards.unsanitized-html-sink
  el.innerHTML = DOMPurify.sanitize(userHtml);
  // ruleid: standards.unsanitized-html-sink
  document.write(userHtml);
}

export function randoms() {
  // ruleid: standards.insecure-random-for-secret
  const resetToken = Math.random().toString(36).slice(2);
  // ruleid: standards.insecure-random-for-secret
  const payload = { sessionId: Math.random() * 1e9 };
  // ok: standards.insecure-random-for-secret
  const jitter = Math.random() * 100;
  // ok: standards.insecure-random-for-secret
  const secureToken = crypto.randomUUID();
  return [resetToken, payload, jitter, secureToken];
}
