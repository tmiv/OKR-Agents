// What a finding is called once the model has stopped talking about it.
//
// Findings have no ids: the model writes a fresh list on every audit, and two
// audits of the same tree describe the same problem in different words. What
// does survive re-wording is the set of nodes the finding is about, so that is
// the identity — a dismissed card stays dismissed across the re-audit that
// follows the fix beside it, and the `{#each}` key does not re-mount a card
// whose title was rephrased.
//
// Sorted, so the model's ordering inside one finding never splits the key.

/**
 * @typedef {import('@okr-agents/schema').Finding} Finding
 */

/**
 * Stable identity of a finding: its node set.
 * @param {{ nodeIds?: readonly string[] }} finding
 * @returns {string}
 */
export const keyOf = (finding) => [...(finding?.nodeIds ?? [])].sort().join('|');
