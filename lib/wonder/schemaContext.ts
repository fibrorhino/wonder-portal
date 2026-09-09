// Builds a compact, LLM-readable description of every queryable variable and
// its valid value codes, used to ground the natural-language interpreter so it
// only ever emits keys/codes that actually exist (no hallucinated filters).

import { CAUSE_PRESETS } from "./databases";
import { getDatabase } from "./db/registry";

export function buildSchemaContext(databaseId?: string): string {
  const db = getDatabase(databaseId);
  const lines: string[] = [];
  lines.push(`Dataset: ${db.label}`);
  lines.push("Queryable variables (use these exact `key` values):");
  for (const v of db.variables) {
    const flags = [v.canGroup ? "groupable" : null, v.canFilter ? "filterable" : null]
      .filter(Boolean)
      .join(", ");
    lines.push(`- key="${v.key}" label="${v.label}" (${flags})${v.note ? ` — ${v.note}` : ""}`);
    if (v.filterMode === "value" && v.values.length > 0) {
      // No size cap: the model must see every valid code, or it guesses a
      // label string instead (which fails validation and gets silently
      // dropped). The full registry is well under typical context limits.
      const codes = v.values.map((val) => `${val.code}=${val.label}`).join(", ");
      lines.push(`  valid codes: ${codes}`);
    } else if (v.filterMode === "finder") {
      lines.push(`  (finder variable: filter values are free-text codes, e.g. ICD-10 codes like "X60-X84" for ucdCause)`);
    }
  }
  lines.push("");
  lines.push("Cause-of-death presets available (for reference/inspiration, not required):");
  for (const p of CAUSE_PRESETS) {
    lines.push(`- "${p.label}": ${JSON.stringify(p.apply)}`);
  }
  lines.push("");
  lines.push(
    "IMPORTANT constraint: only ONE cause-of-death framework may be used per query — " +
      "pick exactly one of: ucdCause (ICD-10 codes), injuryIntent/injuryMechanism, or leadingCauses. Never combine them.",
  );
  lines.push(`Measures available: ${db.measures.join(", ")}.`);
  lines.push(`Years available: ${db.years[0]} through ${db.years[db.years.length - 1]}.`);
  if (db.provisional) {
    lines.push(
      "This dataset is PROVISIONAL: the most recent year is partial, and its counts are not comparable with a full year.",
    );
  }
  return lines.join("\n");
}
