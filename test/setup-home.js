// Gives every test worker its own empty home directory, so code that falls back to os.homedir()
// (wizard, sync-skills, doctor, sync-agents) never writes into the developer's real ~/.gemini or ~/.claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oneup-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
