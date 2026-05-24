// showcase-all.ts — Docker lifecycle runner + multi-adapter showcase orchestrator

import { showcaseMssql } from "./showcase/mssql.ts";
import { showcaseMysql } from "./showcase/mysql.ts";
import { showcasePostgres } from "./showcase/postgres.ts";
import type { Suite } from "./showcase/shared.ts";

// Connection URLs — overridable via env vars for CI (GHA provides services directly)
const PG_URL =
  process.env["PG_URL"] ?? "postgresql://postgres:password@localhost:5432/squn_test";
const MYSQL_URL =
  process.env["MYSQL_URL"] ?? "mysql://root:password@localhost:3306/squn_test";
const MSSQL_URL =
  process.env["MSSQL_URL"] ?? "mssql://sa:Password123!@localhost:1433/master";

// Set SKIP_DOCKER=1 in CI — GitHub Actions services replace docker compose lifecycle
const SKIP_DOCKER = process.env["SKIP_DOCKER"] === "1";

// Path to the squn project — docker-compose.yml lives there.
// Use import.meta.dir (Bun's resolved directory of this file) to compute the path reliably.
const SQUN_DIR = import.meta.dir + "/../squn";

// ── Docker helpers ────────────────────────────────────────────────────────────

interface RunResult {
  code: number;
  out: string;
}

function run(cmd: string[], cwd?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      ...(cwd !== undefined ? { cwd } : {}),
    });
    Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]).then(([stdout, stderr]) => {
      proc.exited.then((code) => resolve({ code: code ?? 1, out: stdout + stderr }));
    });
  });
}

interface ServiceStatus {
  Service: string;
  Health: string;
}

async function pollHealth(timeoutMs: number = 300_000): Promise<void> {
  const required = new Set(["postgres", "mysql", "mssql"]);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await run(["docker", "compose", "ps", "--format", "json"], SQUN_DIR);
    if (result.code === 0 && result.out.trim().length > 0) {
      // docker compose ps --format json outputs newline-delimited JSON objects
      const healthy = new Set<string>();
      for (const line of result.out.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const svc = JSON.parse(trimmed) as ServiceStatus;
          if (required.has(svc.Service) && svc.Health === "healthy") {
            healthy.add(svc.Service);
          }
        } catch {
          // skip non-JSON lines
        }
      }

      if (healthy.size === required.size) {
        console.log("  All services healthy.");
        return;
      }

      const waiting = [...required].filter((s) => !healthy.has(s));
      process.stdout.write(`\r  Waiting for: ${waiting.join(", ")}...   `);
    }

    await Bun.sleep(2_000);
  }

  throw new Error(`Services did not become healthy within ${timeoutMs / 1000}s`);
}

// ── Result table printer ──────────────────────────────────────────────────────

function printResultTable(suites: Suite[]): void {
  const colWidths = { adapter: 14, passed: 8, failed: 8 };

  const top = `\u250c${"─".repeat(colWidths.adapter + 2)}\u252c${"─".repeat(colWidths.passed + 2)}\u252c${"─".repeat(colWidths.failed + 2)}\u2510`;
  const header = `\u2502 ${"Adapter".padEnd(colWidths.adapter)} \u2502 ${"Passed".padEnd(colWidths.passed)} \u2502 ${"Failed".padEnd(colWidths.failed)} \u2502`;
  const sep = `\u251c${"─".repeat(colWidths.adapter + 2)}\u253c${"─".repeat(colWidths.passed + 2)}\u253c${"─".repeat(colWidths.failed + 2)}\u2524`;
  const bot = `\u2514${"─".repeat(colWidths.adapter + 2)}\u2534${"─".repeat(colWidths.passed + 2)}\u2534${"─".repeat(colWidths.failed + 2)}\u2518`;

  console.log(`\n${top}`);
  console.log(header);
  console.log(sep);
  for (const suite of suites) {
    const adapter = suite.adapter.padEnd(colWidths.adapter);
    const passed = String(suite.passed).padEnd(colWidths.passed);
    const failed = String(suite.failed).padEnd(colWidths.failed);
    console.log(`\u2502 ${adapter} \u2502 ${passed} \u2502 ${failed} \u2502`);
  }
  console.log(bot);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Squn Multi-Adapter Showcase\n" + "=".repeat(40) + "\n");

  if (SKIP_DOCKER) {
    console.log("SKIP_DOCKER=1 — assuming services are already running (CI mode).\n");
  } else {
    // 1. Start Docker services
    console.log("Starting Docker services...");
    const upResult = await run(["docker", "compose", "up", "-d"], SQUN_DIR);
    if (upResult.code !== 0) {
      throw new Error(`docker compose up failed:\n${upResult.out}`);
    }
    console.log("  docker compose up -d: OK");

    // 2. Wait for all services to become healthy
    console.log("\nWaiting for services to become healthy (up to 300s)...");
    try {
      await pollHealth(300_000);
    } catch (err) {
      console.error(String(err));
      await run(["docker", "compose", "down"], SQUN_DIR);
      process.exit(1);
    }
  }

  // 3. Run showcases sequentially
  const suites: Suite[] = [];

  try {
    const pgSuite = await showcasePostgres(PG_URL);
    suites.push(pgSuite);
  } catch (err) {
    console.error("\nPostgres showcase threw unexpectedly:", err);
    suites.push({ adapter: "PostgreSQL", passed: 0, failed: 1 });
  }

  try {
    const mysqlSuite = await showcaseMysql(MYSQL_URL);
    suites.push(mysqlSuite);
  } catch (err) {
    console.error("\nMySQL showcase threw unexpectedly:", err);
    suites.push({ adapter: "MySQL", passed: 0, failed: 1 });
  }

  try {
    const mssqlSuite = await showcaseMssql(MSSQL_URL);
    suites.push(mssqlSuite);
  } catch (err) {
    console.error("\nMSSQL showcase threw unexpectedly:", err);
    suites.push({ adapter: "MSSQL", passed: 0, failed: 1 });
  }

  // 4. Print result table
  printResultTable(suites);

  // 5. Tear down Docker services (skipped in CI mode)
  if (!SKIP_DOCKER) {
    console.log("\nStopping Docker services...");
    const downResult = await run(["docker", "compose", "down"], SQUN_DIR);
    if (downResult.code !== 0) {
      console.warn("  docker compose down returned non-zero:", downResult.out);
    } else {
      console.log("  docker compose down: OK");
    }
  }

  // 6. Exit with code 1 if any failures
  const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0);
  if (totalFailed > 0) {
    console.error(`\n${totalFailed} test(s) failed.`);
    process.exit(1);
  }

  console.log("\nAll tests passed.");
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
