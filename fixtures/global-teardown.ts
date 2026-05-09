/**
 * Global Teardown — runs once after the entire test suite.
 * Currently a no-op; each spec cleans up its own data in afterEach/afterAll.
 */
export default async function globalTeardown() {
  // Individual specs delete their own seeded data.
  // Add firm-level cleanup here if needed in CI.
  console.log('\n[teardown] Suite complete.');
}
