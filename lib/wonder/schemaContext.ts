// Builds a compact, LLM-readable description of every queryable variable and
// its valid value codes, used to ground the natural-language interpreter so it
// only ever emits keys/codes that actually exist (no hallucinated filters).

import { CAUSE_PRESETS, VARIABLES } from "./databases";

export function buildSchemaContext(): string {
  const lines: string[] = [];
  lines.push("Queryable variables (use these exact `key` values):");
  for (const v of VARIABLES) {
    const flags = [v.canGroup ? "groupable" : null, v.canFilter ? "filterable" : null]
      .filter(Boolean)
      .join(", ");
    lines.push(`- key="${v.key}" label="${v.label}" (${flags})${v.note ? ` — ${v.note}` : ""}`);
    if (v.filterMode === "value" && v.values.length > 0 && v.values.length <= 40) {
      const codes = v.values.map((val) => `${val.code}=${val.label}`).join(", ");
      lines.push(`  valid codes: ${codes}`);
    } else if (v.filterMode === "finder") {
      lines.push(`  (finder variable: filter values are free-text codes, e.g. ICD-10 codes like "X60-X84" for ucdCause)`);
    } else if (v.values.length > 40) {
      lines.push(`  (${v.values.length} possible codes — omit unless the user names a specific one; ask by label text if unsure)`);
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
  lines.push("Measures available: deaths, population, crudeRate, ageAdjustedRate.");
  lines.push("Years available: 2018 through 2024.");
  return lines.join("\n");
}
