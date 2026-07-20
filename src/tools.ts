import type { MenuIndex } from "./menu.js";
import type { OrderState } from "./orderState.js";
import type { Availability, MenuItem, OrderSummary } from "./types.js";

// ---------------------------------------------------------------------------
// The tool layer: clean, typed functions the orchestrator calls to check
// data and mutate state. Nothing here does any NLU or text generation —
// it's the "hands" of the agent, easy to swap for real backend/API calls
// later (e.g. point addToOrder at a real POS system).
// ---------------------------------------------------------------------------

export interface AvailabilityResult {
  found: boolean;
  item?: MenuItem;
  availability?: Availability;
}

export interface AddToOrderResult {
  success: boolean;
  reason?: "not_found" | "unavailable" | "invalid_quantity";
  item?: MenuItem;
  alternatives?: MenuItem[];
}

export interface ModifyOrderResult {
  success: boolean;
  reason?: "not_found_in_order" | "item_not_recognized";
}

export function checkAvailability(menu: MenuIndex, itemRef: string): AvailabilityResult {
  const item = menu.findByName(itemRef);
  if (!item) return { found: false };
  return { found: true, item, availability: item.availability };
}

export function addToOrder(
  menu: MenuIndex,
  order: OrderState,
  itemRef: string,
  quantity: number
): AddToOrderResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { success: false, reason: "invalid_quantity" };
  }
  const item = menu.findByName(itemRef);
  if (!item) {
    return { success: false, reason: "not_found" };
  }
  if (item.availability === "out-of-stock") {
    return {
      success: false,
      reason: "unavailable",
      item,
      alternatives: suggestAlternatives(menu, item),
    };
  }
  order.addItem(item.id, item.name, item.price, quantity);
  return { success: true, item };
}

export function modifyOrder(
  menu: MenuIndex,
  order: OrderState,
  itemRef: string,
  change: "remove" | "set_quantity" | "increment" | "decrement",
  quantity?: number
): ModifyOrderResult {
  const item = menu.findByName(itemRef);
  const targetId = item?.id;

  if (!targetId) return { success: false, reason: "item_not_recognized" };
  if (!order.hasItem(targetId)) return { success: false, reason: "not_found_in_order" };

  switch (change) {
    case "remove":
      order.removeItem(targetId);
      return { success: true };
    case "set_quantity":
      order.setQuantity(targetId, quantity ?? 1);
      return { success: true };
    case "increment":
      order.adjustQuantity(targetId, quantity ?? 1);
      return { success: true };
    case "decrement":
      order.adjustQuantity(targetId, -(quantity ?? 1));
      return { success: true };
  }
}

export function getOrderSummary(order: OrderState): OrderSummary {
  return order.getSummary();
}

/** Suggests up to 2 available items from the same category as a fallback. */
function suggestAlternatives(menu: MenuIndex, unavailableItem: MenuItem): MenuItem[] {
  return menu
    .byCategory(unavailableItem.category)
    .filter((i) => i.id !== unavailableItem.id && i.availability !== "out-of-stock")
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// ToolExecutor: a thin stateful facade over the pure functions above, exposing
// the exact call shape the assessment specifies —
//   checkAvailability(item), addToOrder(item, quantity),
//   modifyOrder(item, change), getOrderSummary()
// — by closing over menu/order instead of taking them as parameters each
// call. The free functions above remain the source of truth (and stay
// independently unit-testable with no orchestrator/session involved); this
// class exists purely so the tool surface matches the brief 1:1 for a
// session/agent instance. Orchestrator uses this facade.
// ---------------------------------------------------------------------------
export class ToolExecutor {
  constructor(private readonly menu: MenuIndex, private readonly order: OrderState) {}

  checkAvailability(item: string): AvailabilityResult {
    return checkAvailability(this.menu, item);
  }

  addToOrder(item: string, quantity: number): AddToOrderResult {
    return addToOrder(this.menu, this.order, item, quantity);
  }

  modifyOrder(
    item: string,
    change: "remove" | "set_quantity" | "increment" | "decrement",
    quantity?: number
  ): ModifyOrderResult {
    return modifyOrder(this.menu, this.order, item, change, quantity);
  }

  getOrderSummary(): OrderSummary {
    return getOrderSummary(this.order);
  }
}
