import { loadMenu, MenuIndex } from "./menu.js";
import { Orchestrator } from "./orchestrator.js";
import { synthesize, transcribe } from "./sttTts.js";

// ---------------------------------------------------------------------------
// Demo runner. Pipes canned "audio" (mocked transcribe) through the full
// pipeline: transcribe -> orchestrator (reasoning + tools + state) ->
// synthesize. Two scenarios are included; pass --scenario modification to
// run the second one. Run with: npm run demo / npm run demo:modification
// ---------------------------------------------------------------------------

const scenarios: Record<string, string[]> = {
  default: [
    "Hi there!",
    "What do you recommend?",
    "I'll have two chicken tikka masala",
    "Is that spicy?",
    "Can I also get a garlic naan",
    "Actually make it three tikka masala",
    "Do you have anything vegan?",
    "What's my order so far?",
    "That's all, place the order",
  ],
  modification: [
    "Can I get some fries",
    "And a chicken seekh kebab please",
    "I'd also like the vegetable spring rolls",
    "What's in my order?",
    "Actually cancel the fries, add a coke instead",
    "Is the seekh kebab spicy?",
    "Place the order",
  ],
};

function run(scenarioName: string): void {
  const menu = new MenuIndex(loadMenu());
  const orchestrator = new Orchestrator(menu);
  const script = scenarios[scenarioName] ?? scenarios.default;

  console.log(`\n=== Vima3ya Steward Agent — Demo Conversation ("${scenarioName}") ===\n`);

  for (const line of script) {
    const userText = transcribe({ transcript: line });
    console.log(`Customer: ${userText}`);

    const replyText = orchestrator.handleUtterance(userText);
    const audioOut = synthesize(replyText);
    console.log(`Steward:  ${audioOut.text}\n`);
  }

  const summary = orchestrator.getOrder().getSummary();
  console.log("--- Final Order State ---");
  for (const line of summary.lines) {
    console.log(`  ${line.quantity} × ${line.name} — ₹${line.unitPrice * line.quantity}`);
  }
  console.log(`  Total: ₹${summary.total}`);
}

const scenarioArgIdx = process.argv.indexOf("--scenario");
const scenarioName = scenarioArgIdx !== -1 ? process.argv[scenarioArgIdx + 1] : "default";
run(scenarioName);
