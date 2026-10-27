// Tiered weekly commission (migration 080).
//
// Tiers are WEEKLY thresholds: a tech's commission-job collections for a
// Monday-Sunday week pick one rate, and that rate applies to the whole week's
// commission base (not marginally). With 0 -> 15%, $1,500 -> 18%, $3,000 -> 20%,
// a $2,000 week earns 18% of the week's base. A tech with no tier rows falls
// back to the flat tech_pay.commission_pct.

// Monday of the week containing a YYYY-MM-DD string, as YYYY-MM-DD.
export function weekStartOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const back = (d.getUTCDay() + 6) % 7 // Mon=0 ... Sun=6
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

export function weekEndOf(dateStr) {
  const d = new Date(weekStartOf(dateStr) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 6)
  return d.toISOString().slice(0, 10)
}

// tiers: [{ thresholdCents, ratePct }] in any order. Returns the highest tier
// whose threshold the collected dollars have reached, or null if none.
export function tierFor(tiers, collectedDollars) {
  const cents = Math.round((collectedDollars || 0) * 100)
  let hit = null
  for (const t of (tiers || []).slice().sort((a, b) => a.thresholdCents - b.thresholdCents)) {
    if (cents >= t.thresholdCents) hit = t
  }
  return hit
}
