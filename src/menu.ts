import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MenuItem } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads the menu dataset from disk. This is the single source of truth
 * every grounded claim in the system must trace back to — the orchestrator
 * and NLU layer never invent item names, prices, or availability; they only
 * ever read them from here.
 */
export function loadMenu(menuPath?: string): MenuItem[] {
  const resolvedPath = menuPath ?? path.join(__dirname, "..", "data", "menu.json");
  const raw = fs.readFileSync(resolvedPath, "utf-8");
  return JSON.parse(raw) as MenuItem[];
}

export class MenuIndex {
  private readonly items: MenuItem[];

  constructor(items: MenuItem[]) {
    this.items = items;
  }

  all(): MenuItem[] {
    return this.items;
  }

  byId(id: string): MenuItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  byCategory(category: MenuItem["category"]): MenuItem[] {
    return this.items.filter((i) => i.category === category);
  }

  /**
   * Fuzzy name resolution: matches a free-text reference (e.g. "coke",
   * "the tikka masala", "fries") against menu item names. Used to ground
   * user utterances in real menu entries rather than guessing.
   */
  findByName(ref: string): MenuItem | undefined {
    const norm = normalize(ref);
    if (!norm) return undefined;

    // Exact normalized match first.
    const exact = this.items.find((i) => normalize(i.name) === norm);
    if (exact) return exact;

    // Then: every word in the item name appears in the reference, or
    // vice versa (handles "tikka masala" -> "Chicken Tikka Masala").
    const refWords = norm.split(" ");
    let best: { item: MenuItem; score: number } | undefined;

    for (const item of this.items) {
      const nameWords = normalize(item.name).split(" ");
      const overlap = nameWords.filter((w) => refWords.includes(w)).length;
      if (overlap === 0) continue;
      const score = overlap / nameWords.length;
      if (!best || score > best.score) {
        best = { item, score };
      }
    }

    // Require at least half the item's name words to match, to avoid
    // false positives like "chicken" matching three different dishes.
    if (best && best.score >= 0.5) return best.item;
    return undefined;
  }

  /** Finds items matching a dietary/constraint tag, e.g. "vegan", "spicy-hot". */
  findByTag(tag: string): MenuItem[] {
    const norm = normalize(tag);
    return this.items.filter((i) => i.tags.some((t) => normalize(t).includes(norm)));
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
