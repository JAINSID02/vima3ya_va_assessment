// ---------------------------------------------------------------------------
// Mocked STT/TTS. Per the assessment scope note, these are treated as
// black boxes: transcribe() and synthesize() are stubs that pass text
// through, standing in for whatever real STT/TTS provider would sit here
// in production. The orchestrator only ever deals in strings, so swapping
// these for real audio pipelines later requires no changes upstream.
// ---------------------------------------------------------------------------

export interface AudioInput {
  /** In a real system this would be raw audio bytes/stream; mocked as text. */
  transcript: string;
}

export interface AudioOutput {
  text: string;
  /** Placeholder for a real audio buffer/stream a TTS provider would return. */
  audioBase64: string;
}

export function transcribe(audioInput: AudioInput): string {
  // Real implementation would call a streaming STT provider (e.g. Whisper,
  // Deepgram) on raw audio and return the transcript.
  return audioInput.transcript;
}

export function synthesize(text: string): AudioOutput {
  // Real implementation would call a TTS provider and return audio bytes.
  return { text, audioBase64: `MOCK_AUDIO(${text.length}_chars)` };
}
