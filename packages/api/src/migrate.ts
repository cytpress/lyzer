import { closeDb } from "./db.js";
import { migrate } from "./schema.js";

async function main() {
  console.log("Running database migrations...");
  await migrate();
  console.log("Database migrations completed successfully.");
}

await main().finally(() => closeDb());
