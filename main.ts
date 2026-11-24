// Token Radar's entrypoint: one sealed snapshot in, one complete entry out.
//
//   node main.ts [--input /input/snapshot.json] [--out /output]
//
// The runner sets MAKEFUN_OUTPUT_DIR for the output root, and the input path
// defaults to /input/snapshot.json. The run is deterministic: the same snapshot
// always writes the same board, the same dashboard and the same dossier.
//
// Outputs:
//   board.json            the ranked board: 226 rows, all 40 watchlist slugs, ranks 1..n
//   data.js               the dashboard's whole dataset, written beside dashboard/
//   dashboard/            index.html + app.css + app.js, no network, no fetch
//   screenshots/          1-board.png, 2-detail.png, 3-filtered.png
//   dossier.json          byte-for-byte buildDossier('/output', { text_max_bytes: 65536 })
//
// The run refuses to write a bad entry: the board is checked for coverage, ranks,
// order and farm steps; the dashboard is checked for the no-network rule and size;
// the screenshots are checked for size and dimensions; the dossier is written last,
// after every file it summarises, and only once.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildRadar, parseSnapshot, type Snapshot } from './lib/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = HERE;
const DEFAULT_INPUT = '/input/snapshot.json';
const DEFAULT_OUT = '/output';
const MAX_BOARD_ROWS = 4000;
const MIN_BOARD_ROWS = 100;
const MAX_DASHBOARD_FILES = 400;
const MAX_DASHBOARD_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 512 * 1024;
const MAX_SCREENSHOT_LONG = 1440;
const MIN_SCREENSHOT_SHORT = 800;

/** One run's failure, named so the summary can say what went wrong. */
class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunError';
  }
}

/** The --input and --out flags, or their defaults. */
function flags(argv: string[]): { input: string; out: string } {
  let input = process.env.MAKEFUN_INPUT_DIR ? join(process.env.MAKEFUN_INPUT_DIR, 'snapshot.json') : DEFAULT_INPUT;
  let out = process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--input' && argv[i + 1]) input = argv[++i]!;
    else if (a === '--out' && argv[i + 1]) out = argv[++i]!;
  }
  return { input, out };
}

/** The snapshot at `path`, read and parsed. */
function readSnapshot(path: string): Snapshot {
  if (!existsSync(path)) throw new RunError(`input snapshot not found: ${path}`);
  return parseSnapshot(readFileSync(path, 'utf8'));
}

/** Every file under `dir`, relative to it, recursively. */
function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** The dashboard's files, checked: at most 400 files and 4 MiB, and no http:// or https:// anywhere. */
function checkDashboard(dir: string): void {
  if (!existsSync(dir)) throw new RunError(`dashboard not found: ${dir}`);
  const files = walk(dir);
  if (files.length === 0) throw new RunError('dashboard is empty');
  if (files.length > MAX_DASHBOARD_FILES) throw new RunError(`dashboard has ${files.length} files, the limit is ${MAX_DASHBOARD_FILES}`);
  let total = 0;
  for (const rel of files) {
    const path = join(dir, rel);
    total += statSync(path).size;
    const text = readFileSync(path, 'utf8');
    const hit = text.match(/https?:\/\//);
    if (hit) throw new RunError(`dashboard file ${rel} carries a network reference (${hit[0]}), which the gate forbids`);
  }
  if (total > MAX_DASHBOARD_BYTES) throw new RunError(`dashboard is ${total} bytes, the limit is ${MAX_DASHBOARD_BYTES}`);
}

/** A PNG or JPEG's pixel size, from its own header bytes. */
function imageSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + buf.readUInt16BE(offset + 2);
    }
  }
  throw new RunError(`cannot read the size of ${path}: not a PNG or JPEG`);
}

/** The screenshots, checked: three of them, each at most 512 KiB, long side at most 1440, short side at least 800. */
function checkScreenshots(dir: string): { name: string; width: number; height: number; bytes: number }[] {
  if (!existsSync(dir)) throw new RunError(`screenshots not found: ${dir}`);
  const names = readdirSync(dir)
    .filter((n) => /\.(png|jpe?g)$/i.test(n))
    .sort();
  if (names.length < 3) throw new RunError(`only ${names.length} screenshot${names.length === 1 ? '' : 's'}, the gate needs at least 3`);
  const out: { name: string; width: number; height: number; bytes: number }[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const bytes = statSync(path).size;
    if (bytes > MAX_SCREENSHOT_BYTES) throw new RunError(`screenshot ${name} is ${bytes} bytes, the limit is ${MAX_SCREENSHOT_BYTES}`);
    const { width, height } = imageSize(path);
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (long > MAX_SCREENSHOT_LONG) throw new RunError(`screenshot ${name} is ${width}x${height}, the long side is over ${MAX_SCREENSHOT_LONG}`);
    if (short < MIN_SCREENSHOT_SHORT) throw new RunError(`screenshot ${name} is ${width}x${height}, the short side is under ${MIN_SCREENSHOT_SHORT}`);
    out.push({ name, width, height, bytes });
  }
  return out;
}

/** The board, checked: size, coverage, ranks, order and farm steps. */
function checkBoard(board: ReturnType<typeof buildRadar>['board'], snapshot: Snapshot): void {
  if (board.length < MIN_BOARD_ROWS || board.length > MAX_BOARD_ROWS) {
    throw new RunError(`board has ${board.length} rows, the gate needs ${MIN_BOARD_ROWS}..${MAX_BOARD_ROWS}`);
  }
  const issue = boardIssue(board, snapshot);
  if (issue) throw new RunError(`board issue: ${issue}`);
}

/** The whole run: read, rank, write, check, then write the dossier last. */
function main(argv: string[]): void {
  const { input, out } = flags(argv);
  const snapshot = readSnapshot(input);
  const { board, radar } = buildRadar(snapshot);
  checkBoard(board, snapshot);

  mkdirSync(out, { recursive: true });
  mkdirSync(join(out, 'dashboard'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });

  // board.json is an object whose `rows` is the ranked board (a bare array is read
  // too, but the object is the shape the house's own starter writes).
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`);
  writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

  const dashboardDir = join(ROOT, 'dashboard');
  for (const name of ['index.html', 'app.css', 'app.js']) {
    const src = join(dashboardDir, name);
    if (!existsSync(src)) throw new RunError(`dashboard source missing: ${src}`);
    cpSync(src, join(out, 'dashboard', name));
  }
  checkDashboard(join(out, 'dashboard'));

  // The screenshots: real PNGs or JPEGs are copied as they are. A `.png.b64` file
  // is the same screenshot stored as base64 text, because the repository's push
  // path carries UTF-8 only; it is decoded back to the image here, so /output
  // always holds whole images whatever form the repository stores them in.
  const shotsDir = join(ROOT, 'screenshots');
  for (const name of readdirSync(shotsDir)) {
    if (/\.(png|jpe?g)$/i.test(name)) cpSync(join(shotsDir, name), join(out, 'screenshots', name));
    else if (/\.png\.b64$/i.test(name)) {
      const b64 = readFileSync(join(shotsDir, name), 'utf8').replace(/\s+/g, '');
      writeFileSync(join(out, 'screenshots', name.replace(/\.b64$/i, '')), Buffer.from(b64, 'base64'));
    }
  }
  const shots = checkScreenshots(join(out, 'screenshots'));

  // The dossier's caps are the scorer's own: text 64 KiB, at most 4 screenshots of
  // at most 512 KiB, dashboard at most 400 files and 4 MiB.
  const dossier = buildDossier(out, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  // buildDossier returns the dossier's exact bytes: write them as they are.
  // JSON.stringify of a Uint8Array would serialise it as {"0":123,"1":34,...},
  // which is not the dossier the gate compares against.
  writeFileSync(join(out, 'dossier.json'), dossier);

  const top = board[0]!;
  console.log(`token-radar ${radar.model_version}: ${board.length} rows, ${radar.watchlist_size} watchlist, ${radar.early_size} early finds, ${radar.live_size} live tokens`);
  console.log(`  #1 ${top.slug}: implied $${top.implied_value_usd.toLocaleString('en-US')} (TVL $${top.tvl_usd.toLocaleString('en-US')}, peer multiple ${top.model.peer_multiple})`);
  console.log(`  board.json ${statSync(join(out, 'board.json')).size} bytes, data.js ${statSync(join(out, 'data.js')).size} bytes`);
  console.log(`  dashboard ${walk(join(out, 'dashboard')).length} files, dossier ${statSync(join(out, 'dossier.json')).size} bytes`);
  for (const s of shots) console.log(`  screenshot ${s.name}: ${s.width}x${s.height}, ${s.bytes} bytes`);
  console.log(`  wrote ${out}`);
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
