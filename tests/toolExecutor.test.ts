  import { describe, expect, it } from "vitest";
  import { loadMenu, MenuIndex } from "../src/menu.js";
  import { OrderState } from "../src/orderState.js";
  import { ToolExecutor } from "../src/tools.js";

  // Verifies the exact tool surface the assessment specifies:
  //   checkAvailability(item), addToOrder(item, quantity),
  //   modifyOrder(item, change), getOrderSummary()
  describe("ToolExecutor — matches the required tool/API surface", () => {
    const menu = new MenuIndex(loadMenu());

    it("checkAvailability(item) reports availability from the dataset", () => {
      const tools = new ToolExecutor(menu, new OrderState());
      const result = tools.checkAvailability("Butter Chicken");

      expect(result.found).toBe(true);
      expect(result.availability).toBe("available");
    });

    it("addToOrder(item, quantity) adds to the session's order and getOrderSummary() reflects it", () => {
      const tools = new ToolExecutor(menu, new OrderState());
      tools.addToOrder("Coke", 2);

      const summary = tools.getOrderSummary();
      expect(summary.lines).toHaveLength(1);
      expect(summary.lines[0]).toMatchObject({ name: "Coke", quantity: 2 });
      expect(summary.total).toBe(160);
    });

    it("modifyOrder(item, change) mutates the same session's order", () => {
      const tools = new ToolExecutor(menu, new OrderState());
      tools.addToOrder("Garlic Naan", 1);
      tools.modifyOrder("Garlic Naan", "set_quantity", 3);

      const summary = tools.getOrderSummary();
      expect(summary.lines[0].quantity).toBe(3);
    });

    it("getOrderSummary() takes no arguments and reads from the bound session state", () => {
      const order = new OrderState();
      const tools = new ToolExecutor(menu, order);
      order.addItem("drink-masala-chai", "Masala Chai", 70, 1);

      expect(tools.getOrderSummary().total).toBe(70);
    });
  });
