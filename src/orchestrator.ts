import { MenuIndex } from "./menu.js";
import { parseIntent, splitCompoundUtterance } from "./nlu.js";
import { OrderState } from "./orderState.js";
import { ToolExecutor } from "./tools.js";
import type { ConversationContext, Intent, MenuItem, Turn } from "./types.js";

// ---------------------------------------------------------------------------
// The orchestrator is the seam between "user said something" and "agent
// responds and acts correctly." It owns conversation context and delegates
// to: NLU (parseIntent) for reasoning, ToolExecutor for state mutation/lookup,
// and OrderState for the actual cart. It never touches STT/TTS or menu
// data directly beyond reading through MenuIndex — everything is grounded.
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly menu: MenuIndex;
  private readonly order: OrderState;
  private readonly context: ConversationContext;
  private readonly tools: ToolExecutor;

  constructor(menu: MenuIndex, order: OrderState = new OrderState()) {
    this.menu = menu;
    this.order = order;
    this.context = { lastMentionedItemId: null, turns: [] };
    this.tools = new ToolExecutor(menu, order);
  }

  getOrder(): OrderState {
    return this.order;
  }

  getContext(): ConversationContext {
    return this.context;
  }

  /**
   * Processes one raw user utterance and returns the agent's spoken
   * response. Handles compound utterances (e.g. "cancel the fries, add a
   * coke instead") by splitting into clauses and acting on each in order —
   * this is what lets the agent act on the latest correction rather than
   * just the first request.
   */
  handleUtterance(utteranceRaw: string): string {
    this.context.turns.push({ speaker: "user", text: utteranceRaw });

    if (utteranceRaw.trim().length === 0) {
      const emptyReply = "Sorry, I didn't catch that — could you say that again?";
      this.context.turns.push({ speaker: "agent", text: emptyReply });
      return emptyReply;
    }

    const clauses = splitCompoundUtterance(utteranceRaw);
    const responses: string[] = [];

    for (const clause of clauses) {
      const intent = parseIntent(clause, this.context, this.menu.all());
      const response = this.handleIntent(intent);
      if (response !== responses[responses.length - 1]) {
        responses.push(response);
      }
    }

    const reply = responses.join(" ");
    const turn: Turn = { speaker: "agent", text: reply };
    this.context.turns.push(turn);
    return reply;
  }

  private handleIntent(intent: Intent): string {
    switch (intent.type) {
      case "GREETING":
        return "Welcome! I'm your steward tonight — happy to walk you through the menu or take your order whenever you're ready.";

      case "LIST_MENU":
        return this.respondListMenu(intent.category);

      case "RECOMMEND":
        return this.respondRecommend(intent.constraint);

      case "ADD_ITEM":
        return this.respondAddItem(intent.itemRef, intent.quantity ?? 1);

      case "MODIFY_ITEM":
        return this.respondModifyItem(intent.itemRef, intent.change, intent.quantity);

      case "MENU_QUESTION":
        return this.respondMenuQuestion(intent.itemRef, intent.question);

      case "ORDER_SUMMARY":
        return this.respondOrderSummary();

      case "CONFIRM_ORDER":
        return this.respondConfirmOrder();

      case "UNKNOWN":
        return "Sorry, I didn't quite catch that — could you rephrase? I can help you browse the menu, order, or make changes to your order.";
    }
  }

  private respondListMenu(category?: MenuItem["category"]): string {
    const items = category ? this.menu.byCategory(category) : this.menu.all();
    const available = items.filter((i) => i.availability !== "out-of-stock");
    if (available.length === 0) {
      return category
        ? `Unfortunately everything in ${category} is out of stock right now.`
        : "Unfortunately the menu is fully out of stock right now.";
    }
    const list = available.map((i) => `${i.name} (₹${i.price})`).join(", ");
    return category ? `In ${category}, we have: ${list}.` : `Here's what we have today: ${list}.`;
  }

  private respondRecommend(constraint?: string): string {
    let candidates = this.menu.all().filter((i) => i.availability !== "out-of-stock");
    if (constraint) {
      const tagged = this.menu.findByTag(constraint).filter((i) => i.availability !== "out-of-stock");
      if (tagged.length > 0) candidates = tagged;
    }
    if (candidates.length === 0) {
      return constraint
        ? `I'm afraid I don't have anything ${constraint} available right now.`
        : "I don't have a recommendation available right now, sorry.";
    }
    const pick = candidates[0];
    this.context.lastMentionedItemId = pick.id;
    return `I'd recommend the ${pick.name} — ${pick.description} It's ₹${pick.price}.`;
  }

  private respondAddItem(itemRef: string, quantity: number): string {
    const result = this.tools.addToOrder(itemRef, quantity);

    if (!result.success && result.reason === "invalid_quantity") {
      return "Sorry, that doesn't sound like a valid quantity — how many would you like?";
    }

    if (!result.success && result.reason === "not_found") {
      return `I couldn't find "${itemRef}" on our menu — could you tell me the dish name again?`;
    }

    if (!result.success && result.reason === "unavailable") {
      const alt = result.alternatives ?? [];
      // Point context at the alternative we just offered, not the
      // unavailable item — that's what a follow-up "is that spicy?" or
      // "yes, make it two" would naturally refer to.
      this.context.lastMentionedItemId = alt.length > 0 ? alt[0].id : result.item!.id;
      if (alt.length > 0) {
        const altText = alt.map((a) => a.name).join(" or ");
        return `Sorry, the ${result.item!.name} is out of stock right now. Could I interest you in ${altText} instead?`;
      }
      return `Sorry, the ${result.item!.name} is out of stock right now, and I don't have a similar alternative at the moment.`;
    }

    // Success — item may still be "limited" availability, worth flagging.
    const item = result.item!;
    this.context.lastMentionedItemId = item.id;
    const limitedNote = item.availability === "limited" ? " Just a heads up, we only have a limited quantity left tonight." : "";
    return `Got it — ${quantity} × ${item.name} added to your order.${limitedNote}`;
  }

  private respondModifyItem(
    itemRef: string,
    change: "remove" | "set_quantity" | "increment" | "decrement",
    quantity?: number
  ): string {
    // Resolve the reference to a concrete menu item first so we can give a
    // grounded response even on failure paths.
    const resolvedItem = this.menu.findByName(itemRef) ?? this.menu.byId(itemRef);

    if (!resolvedItem) {
      return "I'm not sure which item you mean — could you clarify which dish you'd like to change?";
    }

    const result = this.tools.modifyOrder(resolvedItem.name, change, quantity);

    if (!result.success && result.reason === "not_found_in_order") {
      return `I don't see ${resolvedItem.name} in your order yet, so there's nothing to change there.`;
    }
    if (!result.success) {
      return "I couldn't quite tell which item you meant — could you name the dish?";
    }

    this.context.lastMentionedItemId = resolvedItem.id;

    switch (change) {
      case "remove":
        return `Done — I've removed ${resolvedItem.name} from your order.`;
      case "set_quantity":
        if ((quantity ?? 1) <= 0) {
          return `Got it — that removes ${resolvedItem.name} from your order.`;
        }
        return `Updated — you now have ${quantity} × ${resolvedItem.name}.`;
      case "increment":
        return `Sure — added ${quantity ?? 1} more ${resolvedItem.name}.`;
      case "decrement":
        return this.order.hasItem(resolvedItem.id)
          ? `Okay — reduced ${resolvedItem.name} by ${quantity ?? 1}.`
          : `Okay — that removes ${resolvedItem.name} from your order.`;
    }
  }

  private respondMenuQuestion(itemRef: string | undefined, question: string): string {
    const lowerQ = question.toLowerCase();

    // Dietary/constraint-style questions not tied to one item, e.g.
    // "do you have anything vegan?"
    if (!itemRef || /anything|something/.test(lowerQ)) {
      const constraintMatch = lowerQ.match(/vegan|vegetarian|gluten|spicy|mild/);
      if (constraintMatch) {
        const matches = this.menu
          .findByTag(constraintMatch[0])
          .filter((i) => i.availability !== "out-of-stock");
        if (matches.length === 0) {
          return `I don't have anything marked ${constraintMatch[0]} available right now, I'm afraid.`;
        }
        return `Yes — ${matches.map((m) => m.name).join(", ")} would work for that.`;
      }
    }

    const item = itemRef ? this.menu.byId(itemRef) ?? this.menu.findByName(itemRef) : undefined;
    if (!item) {
      return "I'm not sure which dish you're asking about — could you say the name again?";
    }
    this.context.lastMentionedItemId = item.id;

    if (/spicy|hot|mild/.test(lowerQ)) {
      const spiceTag = item.tags.find((t) => t.startsWith("spicy"));
      const spiceLevel = spiceTag ? spiceTag.replace("spicy-", "") : "not specifically rated for spice";
      return `The ${item.name} is ${spiceLevel === "not specifically rated for spice" ? spiceLevel : spiceLevel + " spice"}. ${item.description}`;
    }

    if (/vegan|vegetarian|gluten|dairy/.test(lowerQ)) {
      const relevant = item.tags.filter((t) => ["vegan", "vegetarian", "non-vegetarian"].includes(t));
      return relevant.length > 0
        ? `The ${item.name} is ${relevant.join(", ")}.`
        : `I don't have dietary tags on file for the ${item.name}, but here's the description: ${item.description}`;
    }

    if (/price|cost|how much/.test(lowerQ)) {
      return `The ${item.name} is ₹${item.price}.`;
    }

    if (/available|in stock|have (any|it)/.test(lowerQ)) {
      const av = this.tools.checkAvailability(item.name);
      if (av.availability === "out-of-stock") return `Sorry, the ${item.name} is currently out of stock.`;
      if (av.availability === "limited") return `We have the ${item.name}, but only in limited quantity tonight.`;
      return `Yes, the ${item.name} is available.`;
    }

    // Default: describe the dish, grounded in the dataset.
    return `The ${item.name}: ${item.description} It's ₹${item.price}.`;
  }

  private respondOrderSummary(): string {
    const summary = this.tools.getOrderSummary();
    if (summary.lines.length === 0) return "Your order is currently empty.";
    const list = summary.lines.map((l) => `${l.quantity} × ${l.name} (₹${l.unitPrice * l.quantity})`).join(", ");
    return `So far you have: ${list}. Running total: ₹${summary.total}.`;
  }

  private respondConfirmOrder(): string {
    if (this.order.isEmpty()) {
      return "Your order is empty right now — would you like to add something before I send it through?";
    }
    const summary = this.tools.getOrderSummary();
    return `Great, confirming your order — total comes to ₹${summary.total}. Sending it to the kitchen now!`;
  }
}
