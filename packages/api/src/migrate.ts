// 執行資料庫 schema 初始化後關閉連線
import { closeDb } from "@/db";
import { migrate } from "@/schema";

async function main() {
  console.log("Running database migrations...");
  await migrate();
  console.log("Database migrations completed successfully.");
}

await main().finally(() => closeDb());
