import { describe, expect, it } from "vitest";
import { OrderState } from "../src/orderState.js";

describe("OrderState", () => {
  it("adds an item and computes the running total", () => {
    const order = new OrderState();
    order.addItem("main-butter-chicken", "Butter Chicken", 450, 2);

    const summary = order.getSummary();
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]).toMatchObject({ quantity: 2, unitPrice: 450 });
    expect(summary.total).toBe(900);
  });

  it("accumulates quantity when the same item is added twice", () => {
    const order = new OrderState();
    order.addItem("drink-coke", "Coke", 80, 1);
    order.addItem("drink-coke", "Coke", 80, 2);

    const summary = order.getSummary();
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].quantity).toBe(3);
    expect(summary.total).toBe(240);
  });

  it("removes an item from the order", () => {
    const order = new OrderState();
    order.addItem("starter-fries", "Fries", 150, 1);
    const removed = order.removeItem("starter-fries");

    expect(removed).toBe(true);
    expect(order.isEmpty()).toBe(true);
  });

  it("setting quantity to zero removes the line item", () => {
    const order = new OrderState();
    order.addItem("drink-coke", "Coke", 80, 2);
    order.setQuantity("drink-coke", 0);

    expect(order.hasItem("drink-coke")).toBe(false);
    expect(order.getSummary().total).toBe(0);
  });

  it("keeps totals correct across a mixed sequence of modifications", () => {
    const order = new OrderState();
    order.addItem("main-chicken-tikka-masala", "Chicken Tikka Masala", 460, 2);
    order.adjustQuantity("main-chicken-tikka-masala", 1); // now 3
    order.addItem("bread-garlic-naan", "Garlic Naan", 90, 1);
    order.removeItem("bread-garlic-naan");

    const summary = order.getSummary();
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].quantity).toBe(3);
    expect(summary.total).toBe(1380);
  });
});
