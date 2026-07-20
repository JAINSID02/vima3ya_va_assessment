import { describe, expect, it } from "vitest";
import { loadMenu, MenuIndex } from "../src/menu.js";
import { Orchestrator } from "../src/orchestrator.js";

describe("Orchestrator — intent changes and ambiguous references", () => {
  const menu = new MenuIndex(loadMenu());

  it("acts on the latest correction, not the first request ('make it two')", () => {
    const orchestrator = new Orchestrator(menu);
    orchestrator.handleUtterance("I'll have one chicken tikka masala");
    orchestrator.handleUtterance("actually make it three");

    const summary = orchestrator.getOrder().getSummary();
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].quantity).toBe(3);
  });

  it("resolves 'remove that' against the most recently mentioned item", () => {
    const orchestrator = new Orchestrator(menu);
    orchestrator.handleUtterance("Can I get a garlic naan");
    const reply = orchestrator.handleUtterance("actually remove that");

    expect(orchestrator.getOrder().isEmpty()).toBe(true);
    expect(reply.toLowerCase()).toContain("removed");
  });

  it("handles a mid-conversation swap in a single utterance", () => {
    const orchestrator = new Orchestrator(menu);
    orchestrator.handleUtterance("Can I get some fries");
    orchestrator.handleUtterance("actually cancel the fries, add a coke instead");

    const summary = orchestrator.getOrder().getSummary();
    expect(orchestrator.getOrder().hasItem("starter-fries")).toBe(false);
    expect(orchestrator.getOrder().hasItem("drink-coke")).toBe(true);
    expect(summary.total).toBe(80);
  });

  it("with 2+ items in the order, a correction applies to the most recently mentioned item, not the first", () => {
    const orchestrator = new Orchestrator(menu);
    orchestrator.handleUtterance("I'll have a garlic naan");
    orchestrator.handleUtterance("I'll also have a mango lassi");
    orchestrator.handleUtterance("actually make it two");

    const summary = orchestrator.getOrder().getSummary();
    const naan = summary.lines.find((l) => l.itemId === "bread-garlic-naan");
    const lassi = summary.lines.find((l) => l.itemId === "drink-mango-lassi");
    expect(naan?.quantity).toBe(1); // untouched — was the first item, not the correction target
    expect(lassi?.quantity).toBe(2); // updated — was the most recently mentioned item
  });

  it("after offering an alternative for an unavailable item, a follow-up pronoun refers to the alternative, not the unavailable item", () => {
    const orchestrator = new Orchestrator(menu);
    orchestrator.handleUtterance("I'd like the vegetable spring rolls"); // out of stock -> offers alternatives
    const reply = orchestrator.handleUtterance("is that spicy?");

    // Should be answering about the offered alternative (Samosa Chaat), not
    // the unavailable Vegetable Spring Rolls.
    expect(reply.toLowerCase()).toContain("samosa chaat");
  });
});

describe("Orchestrator — data grounding", () => {
  const menu = new MenuIndex(loadMenu());

  it("answers a menu-grounded spice question using real menu data, not a guess", () => {
    const orchestrator = new Orchestrator(menu);
    const reply = orchestrator.handleUtterance("Is the chicken tikka masala spicy?");

    // The dataset tags this dish "spicy-hot" — the reply must reflect that,
    // not an invented spice level.
    expect(reply.toLowerCase()).toContain("hot");
  });

  it("never invents an item that isn't in the dataset", () => {
    const orchestrator = new Orchestrator(menu);
    const reply = orchestrator.handleUtterance("I'd like a pizza margherita please");

    expect(orchestrator.getOrder().isEmpty()).toBe(true);
    expect(reply.toLowerCase()).toMatch(/couldn't find|not sure|didn't quite catch/);
  });

  it("quotes a price that exactly matches the dataset, not an invented figure", () => {
    const datasetItem = loadMenu().find((i) => i.id === "main-butter-chicken")!;
    const orchestrator = new Orchestrator(menu);
    const reply = orchestrator.handleUtterance("How much is the butter chicken?");

    expect(reply).toContain(`₹${datasetItem.price}`);
  });

  it("recognizes 'checkout' as a single word (not just 'check out') as a request to finalize", () => {
    const orchestrator = new Orchestrator(menu);
    orchestrator.handleUtterance("I'll have a coke");
    const reply = orchestrator.handleUtterance("checkout please");

    expect(reply.toLowerCase()).toContain("confirming");
  });
});
