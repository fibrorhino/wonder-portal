import test from "node:test";
import assert from "node:assert/strict";
import { computedRateNote } from "./describeSpec";

// The exact sentence lib/wonder/composite.ts writes into sourceNotes.
const COMPUTED =
  "Age-adjusted rates for 2025–2026 were computed here by direct standardisation to the 2000 US standard population, because the provisional file does not publish them. CDC does not publish these figures.";

test("a figure of computed rates says they are not CDC's", () => {
  const note = computedRateNote({
    sourceNotes: ["1999–2017 from Underlying Cause of Death, 1999-2020.", COMPUTED],
  });
  assert.ok(note, "expected a note");
  assert.match(note!, /2025–2026/);
  assert.match(note!, /computed by this site/);
  assert.match(note!, /not published by CDC/);
  assert.ok(note!.length < 120, "short enough to sit in a figure caption");
});

test("no note when nothing was computed", () => {
  assert.equal(computedRateNote(undefined), null);
  assert.equal(computedRateNote({}), null);
  assert.equal(
    computedRateNote({ sourceNotes: ["1999–2017 from Underlying Cause of Death, 1999-2020."] }),
    null,
  );
});

test("the note survives a change to the sentence it is read from", () => {
  // If composite.ts rewords its note, the figure must still carry a warning.
  const note = computedRateNote({ sourceNotes: ["Some rates were computed here, differently worded."] });
  assert.match(note!, /provisional years/);
  assert.match(note!, /not published by CDC/);
});
