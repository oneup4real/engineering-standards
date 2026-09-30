// Terminal prompts for the wizard (readline, no dependencies).
import readline from 'node:readline/promises';

/**
 * @param {import('./wizard.js').Question} q
 * @returns {Promise<string | boolean>}
 */
export async function terminalPrompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`\n  ${q.explain}\n`);
    if (q.choices) {
      q.choices.forEach((c, i) => process.stdout.write(`    ${i + 1}) ${c.label}\n`));
      const defaultIndex = q.choices.findIndex((c) => c.value === q.default) + 1;
      for (;;) {
        const answer = (await rl.question(`  ? ${q.message} [${defaultIndex}] `)).trim();
        if (answer === '') return /** @type {string} */ (q.default);
        const choice = q.choices[Number(answer) - 1];
        if (choice) return choice.value;
        process.stdout.write(`    Please enter a number between 1 and ${q.choices.length}.\n`);
      }
    }
    const hint = q.default ? 'Y/n' : 'y/N';
    const answer = (await rl.question(`  ? ${q.message} (${hint}) `)).trim().toLowerCase();
    if (answer === '') return q.default;
    return answer === 'y' || answer === 'yes' || answer === 'j' || answer === 'ja';
  } finally {
    rl.close();
  }
}
