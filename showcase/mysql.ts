import { MysqlAdapter, createConnection, sql } from "squn";
import { assert, runSuite } from "./shared.ts";
import type { Suite } from "./shared.ts";

interface User { id: number; name: string; email: string; age: number | null; }

export async function showcaseMysql(url: string): Promise<Suite> {
  const db = createConnection(new MysqlAdapter({ url }));

  return runSuite("MySQL", [
    {
      name: "create table",
      fn: async () => {
        await db.execute(sql`DROP TABLE IF EXISTS squn_showcase_users`);
        await db.execute(sql`
          CREATE TABLE squn_showcase_users (
            id    INT AUTO_INCREMENT PRIMARY KEY,
            name  VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            age   INT NULL
          )
        `);
      },
    },
    {
      name: "insert and query",
      fn: async () => {
        await db.execute(sql`INSERT INTO squn_showcase_users (name, email, age) VALUES (${"Alice"}, ${"alice@example.com"}, ${30})`);
        const users = await db.query<User>(sql`SELECT * FROM squn_showcase_users`);
        assert(users.length === 1, `expected 1 row, got ${users.length}`);
        assert(users[0]?.name === "Alice", "name mismatch");
      },
    },
    {
      name: "querySingle",
      fn: async () => {
        const user = await db.querySingle<User>(sql`SELECT * FROM squn_showcase_users WHERE email = ${"alice@example.com"}`);
        assert(user.email === "alice@example.com", "email mismatch");
      },
    },
    {
      name: "queryScalar",
      fn: async () => {
        const count = await db.queryScalar<number>(sql`SELECT COUNT(*) FROM squn_showcase_users`);
        assert(Number(count) === 1, `expected count 1, got ${count}`);
      },
    },
    {
      name: "executeBatch",
      fn: async () => {
        const rows = [
          { name: "Bob", email: "bob@example.com", age: 25 },
          { name: "Carol", email: "carol@example.com", age: 28 },
        ];
        await db.executeBatch(sql`INSERT INTO squn_showcase_users (name, email, age) VALUES (@name, @email, @age)`, rows);
        const count = await db.queryScalar<number>(sql`SELECT COUNT(*) FROM squn_showcase_users`);
        assert(Number(count) === 3, `expected count 3, got ${count}`);
      },
    },
    {
      name: "atomically",
      fn: async () => {
        await db.atomically(async (q) => {
          await q.execute(sql`UPDATE squn_showcase_users SET age = ${31} WHERE email = ${"alice@example.com"}`);
          const user = await q.querySingle<User>(sql`SELECT * FROM squn_showcase_users WHERE email = ${"alice@example.com"}`);
          assert(user.age === 31, `expected age 31, got ${user.age}`);
        });
      },
    },
    {
      name: "cleanup",
      fn: async () => {
        await db.execute(sql`DROP TABLE squn_showcase_users`);
      },
    },
  ]);
}
