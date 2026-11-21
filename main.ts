// Marisol Vice — hand-in program for the gta6-01 bounty (Node 22, standard library only).
// The game itself is the static site in game/ (index.html plus ES modules, no build step,
// no network). This program copies game/ and screenshots/ into the output directory and
// writes dossier.json there with the vendored make.fun library, exactly as the gate
// expects: the dossier is rebuilt by the scorer and compared byte for byte, so the
// vendored file must stay untouched and the caps below mirror the scorer's own.
// Run it the way the grader does, with MAKEFUN_OUTPUT_DIR pointing at a scratch dir:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps from the gate: dossier text capped at 160 KiB, at most 4 screenshots of
// at most 256 KiB each, game/ at most 993 entries and 48 MiB, no game path over
// 1000 UTF-8 bytes. buildDossier refuses anything the scorer would refuse.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
