import type { ConversationContext, Intent, MenuItem } from "./types.js";

// ---------------------------------------------------------------------------
// Rule-based reasoning stand-in (candidate's choice per the brief — a real
// LLM call could be dropped in here behind the same parseIntent() signature
// without touching the orchestrator, since it only ever consumes Intent
// objects). Kept deterministic and dependency-free so it's easy to test and
// requires no API key to run the demo.
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1, another: 1, couple: 2,
};

function extractQuantity(text: string): number | undefined {
  const negativeMatch = text.match(/-\s*(\d+)/);
  if (negativeMatch) return -parseInt(negativeMatch[1], 10);
  const digitMatch = text.match(/\b(\d+)\b/);
  if (digitMatch) return parseInt(digitMatch[1], 10);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return undefined;
}

const ANAPHORA = /\b(it|that|this|them|those|the last one|the one i (just )?(ordered|added|said))\b/i;

/**
 * Resolves what item a reference points to. Handles explicit names by
 * returning the raw text (menu matching happens in the tools layer), and
 * resolves pronouns/anaphora against conversation context.
 */
function resolveItemRef(rawRef: string, context: ConversationContext, menuNames: string[]): string {
  if (ANAPHORA.test(rawRef.trim())) {
    return context.lastMentionedItemId ?? rawRef;
  }
  // If the reference doesn't look like it names any known menu item at all
  // and context has a recent item, prefer context (handles "make it two"
  // style phrasing where "it" was stripped upstream).
  const looksLikeKnownItem = menuNames.some((n) =>
    n.toLowerCase().split(" ").some((w) => rawRef.toLowerCase().includes(w))
  );
  if (!looksLikeKnownItem && context.lastMentionedItemId) {
    return context.lastMentionedItemId;
  }
  return rawRef;
}

export function parseIntent(
  utteranceRaw: string,
  context: ConversationContext,
  menuItems: MenuItem[]
): Intent {
  const utterance = utteranceRaw.trim();
  const lower = utterance.toLowerCase();
  const menuNames = menuItems.map((i) => i.name);

  if (/^(hi|hello|hey|good (morning|evening|afternoon))\b/.test(lower)) {
    return { type: "GREETING" };
  }

  // Note: compound utterances like "cancel the fries, add a coke instead"
  // are split into separate clauses *before* reaching this function — see
  // splitCompoundUtterance() below, called from Orchestrator.handleUtterance().
  // This function always parses a single clause into a single Intent.

  // Menu listing
  if (/what('s| is)?\s+(on the menu|available)|show( me)? the menu|list (the )?menu/.test(lower)) {
    const categoryMatch = lower.match(/starters?|mains?|drinks?|desserts?/);
    return {
      type: "LIST_MENU",
      category: categoryMatch ? (normalizeCategory(categoryMatch[0]) as MenuItem["category"]) : undefined,
    };
  }

  // Recommendation
  if (/recommend|suggest|what('s| is) good|what do you suggest/.test(lower)) {
    const constraintMatch = lower.match(/vegan|vegetarian|spicy|mild/);
    return { type: "RECOMMEND", constraint: constraintMatch?.[0] };
  }

  // Order summary / bill
  if (/order summary|what('s| is|’s)? (in )?my order|my (current )?order|the bill|total( so far)?/.test(lower)) {
    return { type: "ORDER_SUMMARY" };
  }

  // Confirmation to place the final order
  if (/^(that('s| is) (all|it)|place (the )?order|confirm( the)? order|i('m| am) done|that will be all|checkout|check out)\b/.test(lower)) {
    return { type: "CONFIRM_ORDER" };
  }

  // Menu-grounded question, e.g. "is the tikka masala spicy?", "do you have anything vegan?",
  // "how much is the butter chicken?", "what does the naan cost?"
  if (
    /^(is|are|does|do you have|what'?s in|how spicy|is there|how much|what does)\b/.test(lower) ||
    /\b(cost|costs|price of)\b/.test(lower) ||
    lower.includes("vegan") ||
    lower.includes("gluten")
  ) {
    const explicitRef = extractItemMention(lower, menuNames);
    // "anything/something" questions are deliberately category-wide, not
    // tied to one dish, so don't resolve those against conversation context.
    const isOpenEnded = /\banything|something\b/.test(lower);
    const itemRef = explicitRef ?? (isOpenEnded ? undefined : resolveItemRef("that", context, menuNames));
    return { type: "MENU_QUESTION", itemRef: itemRef ?? undefined, question: utterance };
  }

  // Modification: remove / cancel / change quantity
  if (/\b(remove|cancel|take (that|it|those) off|no more|scratch that|don'?t want)\b/.test(lower)) {
    const rawRef = extractItemMention(lower, menuNames) ?? lower;
    const itemRef = resolveItemRef(rawRef, context, menuNames);
    return { type: "MODIFY_ITEM", itemRef, change: "remove" };
  }

  if (/\bmake it\b|\bchange (that |it )?to\b|\binstead of\b.*\bmake\b/.test(lower)) {
    const qty = extractQuantity(lower);
    const rawRef = extractItemMention(lower, menuNames) ?? "";
    const itemRef = resolveItemRef(rawRef || "it", context, menuNames);
    return { type: "MODIFY_ITEM", itemRef, change: "set_quantity", quantity: qty ?? 1 };
  }

  if (/\badd (one|another|two|\d+)?\s*more\b|\bone more\b/.test(lower)) {
    const rawRef = extractItemMention(lower, menuNames) ?? "";
    const itemRef = resolveItemRef(rawRef || "it", context, menuNames);
    return { type: "MODIFY_ITEM", itemRef, change: "increment", quantity: extractQuantity(lower) ?? 1 };
  }

  // Add to order: "I'll have...", "can I get...", "add...", "order..."
  if (/\b(i('ll| will) have|can i\b.{0,15}\b(get|have)\b|i want|i'?d like|add|order|get me|give me)\b/.test(lower)) {
    const qty = extractQuantity(lower) ?? 1;
    const itemRef = extractItemMention(lower, menuNames);
    if (itemRef) {
      return { type: "ADD_ITEM", itemRef, quantity: qty };
    }
  }

  // Fallback: no explicit trigger phrase matched, but the utterance clearly
  // names a real menu item (e.g. "and a chicken seekh kebab please") — in a
  // food-ordering context that's an implicit add request.
  const fallbackItem = extractItemMention(lower, menuNames);
  if (fallbackItem) {
    const qty = extractQuantity(lower) ?? 1;
    return { type: "ADD_ITEM", itemRef: fallbackItem, quantity: qty };
  }

  return { type: "UNKNOWN", raw: utterance };
}

/** Best-effort scan for a known menu item name (or partial) inside the utterance. */
function extractItemMention(lower: string, menuNames: string[]): string | undefined {
  let best: { name: string; score: number } | undefined;
  for (const name of menuNames) {
    const words = name.toLowerCase().split(" ");
    const overlap = words.filter((w) => lower.includes(w)).length;
    if (overlap === 0) continue;
    const score = overlap / words.length;
    if (!best || score > best.score) best = { name, score };
  }
  if (best && best.score >= 0.34) return best.name;
  return undefined;
}

function normalizeCategory(word: string): string {
  const w = word.replace(/s$/, "");
  return `${w}s`;
}

/**
 * Splits a compound utterance like "cancel the fries, add a coke instead"
 * into separate clauses so the orchestrator can process each as its own
 * turn/intent. This is what lets a single user message carry a correction
 * ("actually cancel X, add Y instead").
 */
export function splitCompoundUtterance(utterance: string): string[] {
  // Deliberately does NOT split on "and", since "fries and a kebab" is one
  // add-item request, not two separate clauses to reason about independently.
  // Comma/"actually" split for correction-style utterances like "actually
  // cancel the fries, add a coke instead".
  return utterance
    .split(/,|\bactually\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
