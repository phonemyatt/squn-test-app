export interface Suite {
  adapter: string;
  passed: number;
  failed: number;
}

export interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

export async function runSuite(adapter: string, cases: TestCase[]): Promise<Suite> {
  let passed = 0;
  let failed = 0;

  console.log(`\n── ${adapter} ──────────────────────────────`);

  for (const { name, fn } of cases) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  return { adapter, passed, failed };
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
