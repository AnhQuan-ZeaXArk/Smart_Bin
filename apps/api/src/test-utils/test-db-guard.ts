/**
 * Test Database Safety Guard.
 * Ngăn chặn tuyệt đối việc unit/integration tests kết nối hoặc thay đổi Database Production Render.
 */
export function assertIsolatedTestDb(testSuiteName = 'Integration Test'): void {
  const rawUrl = process.env.DATABASE_URL || '';
  const isProduction =
    rawUrl.includes('render.com') ||
    rawUrl.includes('singapore-postgres') ||
    rawUrl.includes('dpg-');

  if (isProduction) {
    console.log('======================================================================');
    console.warn(`[SAFETY GUARD] ${testSuiteName} HALTED: DATABASE_URL points to Remote Production (Render)!`);
    console.warn('[SAFETY GUARD] Tests are strictly FORBIDDEN from modifying or querying Production database.');
    console.warn('[SAFETY GUARD] Status: NOT EXECUTED (Requires local/staging isolated database).');
    console.log('======================================================================');
    process.exit(0);
  }
}

