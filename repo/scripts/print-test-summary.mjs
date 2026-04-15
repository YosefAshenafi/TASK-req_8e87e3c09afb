#!/usr/bin/env node
/**
 * Prints an overall test + coverage summary from Vitest / Playwright JSON artifacts.
 * Run at the end of ./run_tests.sh (repo root).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function pct(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const v = typeof n === 'number' ? n : Number(n);
  return `${v.toFixed(2)}%`;
}

function parseVitestRun(j) {
  if (!j || typeof j !== 'object') return null;
  const files = j.testResults?.length ?? null;
  return {
    total: j.numTotalTests ?? null,
    passed: j.numPassedTests ?? null,
    failed: j.numFailedTests ?? null,
    skipped: (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0),
    files,
  };
}

/** Single headline metric: line coverage % (from Istanbul json-summary). */
function parseCoverageSummary(summary) {
  const p = summary?.total?.lines?.pct;
  if (p === undefined || p === null || Number.isNaN(p)) return null;
  return p;
}

function parsePlaywright(j) {
  if (!j?.stats) return null;
  const st = j.stats;
  const passed = st.expected ?? 0;
  const failed = st.unexpected ?? 0;
  const flaky = st.flaky ?? 0;
  const skipped = st.skipped ?? 0;
  return {
    total: passed + failed + flaky + skipped,
    passed,
    failed,
    flaky,
    skipped,
  };
}

function vitestLine(name, run, cov) {
  if (!run?.total) {
    return [`  ${name}: (no test-results.json — run Vitest with JSON reporter)`];
  }
  const lines = [
    `  ${name}:`,
    `    Tests: ${run.passed}/${run.total} passed` +
      (run.failed ? `, ${run.failed} failed` : '') +
      (run.skipped ? `, ${run.skipped} skipped/pending` : ''),
    `    Test files: ${run.files ?? '—'}`,
  ];
  if (cov != null) {
    lines.push(`    Line coverage: ${pct(cov)}`);
  } else {
    lines.push(`    Line coverage: (no coverage-summary.json in coverage folder)`);
  }
  return lines;
}

function main() {
  const unitRun = readJson(path.join(ROOT, 'coverage/unit/test-results.json'));
  const unitCov = readJson(path.join(ROOT, 'coverage/unit/coverage-summary.json'));
  const apiRun = readJson(path.join(ROOT, 'coverage/api/test-results.json'));
  const apiCov = readJson(path.join(ROOT, 'coverage/api/coverage-summary.json'));
  const e2eRun = readJson(path.join(ROOT, 'coverage/e2e/results.json'));

  const u = parseVitestRun(unitRun);
  const uc = parseCoverageSummary(unitCov);
  const a = parseVitestRun(apiRun);
  const ac = parseCoverageSummary(apiCov);
  const e = parsePlaywright(e2eRun);

  const out = [];
  out.push('');
  out.push(`${'═'.repeat(66)}`);
  out.push('  Overall test & coverage stats');
  out.push(`${'═'.repeat(66)}`);
  out.push(...vitestLine('Unit tests', u, uc));
  out.push('');
  out.push(...vitestLine('API tests', a, ac));
  out.push('');
  if (e?.total != null) {
    out.push('  E2E (Playwright):');
    out.push(
      `    Tests: ${e.passed}/${e.total} passed` +
        (e.failed ? `, ${e.failed} failed` : '') +
        (e.flaky ? `, ${e.flaky} flaky` : '') +
        (e.skipped ? `, ${e.skipped} skipped` : ''),
    );
    out.push('    Line coverage: N/A (E2E — not instrumented)');
  } else {
    out.push('  E2E (Playwright): (no coverage/e2e/results.json)');
  }

  out.push('');
  if (u?.total != null && a?.total != null && e?.total != null) {
    out.push(`  Total test cases (unit + API + E2E): ${u.total + a.total + e.total}`);
  } else if (u?.total != null && a?.total != null) {
    out.push(`  Total test cases (unit + API): ${u.total + a.total}`);
    if (e?.total == null) {
      out.push(`  (E2E: add coverage/e2e/results.json after Playwright for a combined total.)`);
    }
  } else if (u?.total != null) {
    out.push(`  Total test cases (unit only in this summary): ${u.total}`);
  }
  out.push(`${'═'.repeat(66)}`);
  out.push('');

  console.log(out.join('\n'));
}

main();
