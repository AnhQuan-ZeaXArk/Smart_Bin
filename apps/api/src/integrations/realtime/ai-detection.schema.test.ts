import { aiDetectionStrictSchema, aiDetectionInputSchema } from './ai-detection.schema.js';

/**
 * Unit test thuần cho schema aiDetection (không cần Database / Socket).
 * Chạy: npx tsx apps/api/src/integrations/realtime/ai-detection.schema.test.ts
 */
const base = { class: 'RECYCLABLE', timestamp: '2026-11-05T05:00:00.000Z' };

const cases: Array<[unknown, boolean, string]> = [
  [0, true, '0 -> valid'],
  [0.92, true, '0.92 -> valid'],
  [1, true, '1 -> valid'],
  [-0.1, false, '-0.1 -> invalid'],
  [1.1, false, '1.1 -> invalid'],
  [null, false, 'null -> invalid'],
  ['', false, '"" -> invalid'],
  ['0.92', false, '"0.92" -> invalid'],
  [Number.NaN, false, 'NaN -> invalid'],
  [Number.POSITIVE_INFINITY, false, 'Infinity -> invalid'],
  [undefined, false, 'missing -> invalid']
];

let passed = 0;
let failed = 0;
function check(ok: boolean, label: string, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label} ${detail}`);
  }
}

console.log('=== aiDetectionStrictSchema: confidence validation ===');
for (const [confidence, expectedValid, label] of cases) {
  const result = aiDetectionStrictSchema.safeParse({ ...base, confidence });
  check(result.success === expectedValid, label, `(success=${result.success})`);
  if (result.success && expectedValid) {
    check(result.data.confidence === confidence, `${label} (value unchanged, no transformation)`);
  }
}

console.log('\n=== aiDetectionInputSchema: invalid detection dropped to null (heartbeat not rejected) ===');
// Ẩn cảnh báo dự kiến trong lúc chạy, đồng thời xác nhận cảnh báo được ghi
const originalWarn = console.warn;
let warnCount = 0;
console.warn = () => { warnCount++; };
try {
  const invalid = aiDetectionInputSchema.safeParse({ ...base, confidence: null });
  check(invalid.success && invalid.data === null, 'confidence null -> parse success, aiDetection = null');
  const invalidStr = aiDetectionInputSchema.safeParse({ ...base, confidence: '0.92' });
  check(invalidStr.success && invalidStr.data === null, 'confidence "0.92" -> parse success, aiDetection = null');
  check(warnCount === 2, 'warning logged for each dropped detection', `(warnCount=${warnCount})`);

  const valid = aiDetectionInputSchema.safeParse({ ...base, confidence: 0.92 });
  check(valid.success && valid.data?.confidence === 0.92, 'valid detection passes through unchanged');
  const absent = aiDetectionInputSchema.safeParse(undefined);
  check(absent.success && absent.data === undefined, 'absent aiDetection stays undefined (no warning)');
  check(warnCount === 2, 'no warning for valid / absent detection', `(warnCount=${warnCount})`);
} finally {
  console.warn = originalWarn;
}

console.log(`\nai-detection.schema: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

