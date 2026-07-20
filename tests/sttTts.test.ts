import { describe, expect, it } from "vitest";
import { synthesize, transcribe } from "../src/sttTts.js";

// These are trivial by design — the point is that the I/O boundary (mocked
// per the assessment's scope note) is its own module with its own contract,
// so it's testable and swappable in isolation from reasoning/state/tools.
describe("STT/TTS I/O boundary", () => {
  it("transcribe() passes the input transcript through unchanged", () => {
    expect(transcribe({ transcript: "I'll have the butter chicken" })).toBe(
      "I'll have the butter chicken"
    );
  });

  it("synthesize() returns the text alongside a mocked audio payload", () => {
    const out = synthesize("Got it, added to your order.");
    expect(out.text).toBe("Got it, added to your order.");
    expect(out.audioBase64).toContain("MOCK_AUDIO");
  });
});
