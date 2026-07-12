import { createApiKey } from "../src/lib/db/api-keys";

async function main() {
  const args = process.argv.slice(2);
  let plan = "free";
  let name = "CLI generated";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      plan = args[++i];
    } else if (args[i] === "--name" && args[i + 1]) {
      name = args[++i];
    }
  }

  if (!["free", "pro", "scale"].includes(plan)) {
    console.error("Invalid plan. Use: free, pro, or scale");
    process.exit(1);
  }

  const created = await createApiKey({ plan, name });

  console.log("API key created");
  console.log(`id:   ${created.id}`);
  console.log(`plan: ${created.plan}`);
  console.log(`name: ${name}`);
  console.log("");
  console.log("Store this key securely — it will not be shown again:");
  console.log(created.key);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
