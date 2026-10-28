import { resolve } from "node:path";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { runTool } from "@/lib/assistant/tools";
import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  // The assistant runs this from assistant/, so find .env.local from the script's own location.
  process.loadEnvFile(resolve(import.meta.dirname, "..", ".env.local"));
  const [name, ...args] = process.argv.slice(2);
  console.log(await runTool(createSupabaseRepo(createAdminClient()), name ?? "", args));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
