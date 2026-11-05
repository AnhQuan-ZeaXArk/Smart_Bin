import { formatConfidence, CONFIDENCE_PLACEHOLDER } from './ai-confidence.js';

/**
 * Unit test thuần (không cần Database / Socket) cho định dạng AI confidence.
 * Chạy: npx tsx apps/web/src/ai-confidence.test.ts
 */
const cases: Array<[unknown, string, string]> = [
  [0.92, '92%', '0.92 -> 92%'],
  [0.856, '85.6%', '0.856 -> 85.6%'],
  [1.0, '100%', '1.0 -> 100%'],
  [0, '0%', '0 -> 0%'],
  [0.958, '95.8%', '0.958 -> 95.8%'],
  [0.9999, '100%', '0.9999 -> 100% (làm tròn 1 chữ số)'],
  [null, CONFIDENCE_PLACEHOLDER, 'null -> placeholder'],
  [undefined, CONFIDENCE_PLACEHOLDER, 'undefined -> placeholder'],
  [Number.NaN, CONFIDENCE_PLACEHOLDER, 'NaN -> placeholder'],
  [Number.POSITIVE_INFINITY, CONFIDENCE_PLACEHOLDER, 'Infinity -> placeholder'],
  ['0.92', CONFIDENCE_PLACEHOLDER, 'chuỗi -> placeholder'],
  [{}, CONFIDENCE_PLACEHOLDER, 'object -> placeholder'],
  [-0.1, CONFIDENCE_PLACEHOLDER, 'số âm -> placeholder'],
  [1.5, CONFIDENCE_PLACEHOLDER, '> 1 -> placeholder (không đoán thang 0-100)'],
  [95.8, CONFIDENCE_PLACEHOLDER, '95.8 (thang 0-100 legacy) -> placeholder']
];

let passed = 0;
let failed = 0;
for (const [input, expected, label] of cases) {
  const actual = formatConfidence(input);
  if (actual === expected) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label} -> expected "${expected}", got "${actual}"`);
  }
}

console.log(`\nai-confidence: ${passed} passed, ${failed} failed, ${cases.length} total`);
process.exit(failed === 0 ? 0 : 1);

