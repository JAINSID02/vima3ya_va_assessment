import { describe, expect, it } from "vitest";
import { loadMenu, MenuIndex } from "../src/menu.js";
import { Orchestrator } from "../src/orchestrator.js";
import { addToOrder } from "../src/tools.js";
import { OrderState } from "../src/orderState.js";

describe("Unavailable item handling", () => {
  const menu = new MenuIndex(loadMenu());

  it("addToOrder refuses an out-of-stock item and suggests an alternative", () => {
    const order = new OrderState();
    const result = addToOrder(menu, order, "vegetable spring rolls", 1);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("unavailable");
    expect(result.alternatives?.length).toBeGreaterThan(0);
    expect(order.isEmpty()).toBe(true); // must NOT proceed as if it were available
  });

  it("orchestrator responds with an alternative instead of hallucinating success", () => {
    const orchestrator = new Orchestrator(menu);
    const reply = orchestrator.handleUtterance("I'd like the vegetable spring rolls");

    expect(reply.toLowerCase()).toContain("out of stock");
    expect(orchestrator.getOrder().isEmpty()).toBe(true);
  });

  it("does not crash on an invalid (zero) quantity — asks for clarification instead", () => {
    const orchestrator = new Orchestrator(menu);
    expect(() => orchestrator.handleUtterance("add 0 cokes")).not.toThrow();

    const reply = orchestrator.handleUtterance("add 0 cokes");
    expect(orchestrator.getOrder().isEmpty()).toBe(true);
    expect(reply.toLowerCase()).toContain("quantity");
  });

  it("rejects a negative quantity rather than silently adding a positive amount", () => {
    const orchestrator = new Orchestrator(menu);
    const reply = orchestrator.handleUtterance("add -3 cokes");

    expect(orchestrator.getOrder().isEmpty()).toBe(true);
    expect(reply.toLowerCase()).toContain("quantity");
  });

  it("handles an empty/whitespace-only utterance without a blank reply", () => {
    const orchestrator = new Orchestrator(menu);
    const reply = orchestrator.handleUtterance("   ");

    expect(reply.length).toBeGreaterThan(0);
  });

  it("does not silently add a limited-availability item without flagging it", () => {
    const orchestrator = new Orchestrator(menu);
    const reply = orchestrator.handleUtterance("I'll have the lamb rogan josh");

    expect(reply.toLowerCase()).toContain("limited");
    expect(orchestrator.getOrder().hasItem("main-lamb-rogan-josh")).toBe(true);
  });
});
