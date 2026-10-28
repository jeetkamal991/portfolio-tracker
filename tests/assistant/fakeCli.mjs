// Stands in for the claude CLI: node fakeCli.mjs <mode>
const mode = process.argv[2];
const line = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const text = (t) => line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
const result = () => line({ type: "result", subtype: "success", is_error: false, session_id: "fake-1", total_cost_usd: 0.01, num_turns: 1, duration_ms: 5, permission_denials: [], usage: { input_tokens: 1, output_tokens: 2 } });
process.stderr.write("some stderr noise\n");
if (mode === "ok") { text("hello "); text("world"); result(); }
else if (mode === "env") { text(process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? "unset"); result(); }
else if (mode === "slow") { text("partial"); setInterval(() => {}, 1000); }
else if (mode === "crash") { process.stderr.write("Not logged in\n"); process.exit(3); }
