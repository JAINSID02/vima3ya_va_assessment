import type { OrderLine, OrderSummary } from "./types.js";

/**
 * Pure state container for the current table's order. Deliberately has no
 * knowledge of the menu, NLU, or LLM — it just tracks line items and
 * quantities, and computes totals. This makes it trivially unit-testable
 * and swappable for a real backend (e.g. a DB-backed cart) later.
 */
export class OrderState {
  private lines: Map<string, OrderLine> = new Map();

  addItem(itemId: string, name: string, unitPrice: number, quantity: number): void {
    if (quantity <= 0) throw new Error(`Quantity must be positive, got ${quantity}`);
    const existing = this.lines.get(itemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.lines.set(itemId, { itemId, name, quantity, unitPrice });
    }
  }

  removeItem(itemId: string): boolean {
    return this.lines.delete(itemId);
  }

  setQuantity(itemId: string, quantity: number): boolean {
    const line = this.lines.get(itemId);
    if (!line) return false;
    if (quantity <= 0) {
      this.lines.delete(itemId);
    } else {
      line.quantity = quantity;
    }
    return true;
  }

  adjustQuantity(itemId: string, delta: number): boolean {
    const line = this.lines.get(itemId);
    if (!line) return false;
    const next = line.quantity + delta;
    if (next <= 0) {
      this.lines.delete(itemId);
    } else {
      line.quantity = next;
    }
    return true;
  }

  hasItem(itemId: string): boolean {
    return this.lines.has(itemId);
  }

  getLine(itemId: string): OrderLine | undefined {
    return this.lines.get(itemId);
  }

  getSummary(): OrderSummary {
    const lines = Array.from(this.lines.values());
    const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    return { lines, total };
  }

  isEmpty(): boolean {
    return this.lines.size === 0;
  }
}
