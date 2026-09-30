// Apprentice competency catalog.
//
// This is the ladder from apprentice to service technician. Levels live in
// the database (`tech_competencies`), keyed by the `key` strings below; the
// catalog itself is code so it is versioned and reviewable. Editing this file
// is safe: removing a skill leaves its stored row orphaned and unused rather
// than destroying it, and adding one starts everybody at level 0.
//
// Keys are permanent. Rename a `label` freely, never a `key` — that silently
// resets the skill to zero for everyone who had it signed off.

export const LEVELS = [
  { v: 0, label: "Not started",  short: "—",   color: "#dde2ee", ink: "#8899bb" },
  { v: 1, label: "Watched",      short: "W",   color: "#c3ccdd", ink: "#33415c" },
  { v: 2, label: "Assisted",     short: "A",   color: "#3D95CE", ink: "#fff" },
  { v: 3, label: "Supervised",   short: "S",   color: "#6B39A8", ink: "#fff" },
  { v: 4, label: "Solo",         short: "✓",   color: "#16a085", ink: "#fff" },
];

export const MAX_LEVEL = 4;

// Graduation gate. `gate: true` skills must be at SOLO before anyone runs
// their own van — these are the ones where a mistake floods a house, breaks
// code, or costs the customer relationship. Everything else must clear
// SUPERVISED across at least TECHNICAL_THRESHOLD of the catalog.
export const GATE_LEVEL = 4;          // Solo
export const TECHNICAL_LEVEL = 3;     // Supervised
export const TECHNICAL_THRESHOLD = 0.8;

export const DOMAINS = [
  {
    key: "safety",
    name: "Safety & Shutoffs",
    skills: [
      { key: "safety.ppe",        label: "PPE, eye and hand protection",        gate: true },
      { key: "safety.water",      label: "Locate and close the water shutoff",  gate: true },
      { key: "safety.gas",        label: "Locate and close the gas shutoff",    gate: true },
      { key: "safety.electrical", label: "Electrical awareness near water heaters and pumps", gate: true },
      { key: "safety.ladder",     label: "Ladder and crawlspace safety" },
      { key: "safety.protect",    label: "Protect the home: drop cloths, shoe covers, containment", gate: true },
      { key: "safety.cleanup",    label: "Leave the site cleaner than you found it", gate: true },
    ],
  },
  {
    key: "truck",
    name: "Truck & Materials",
    skills: [
      { key: "truck.stock",     label: "Knows the van stock and where it lives" },
      { key: "truck.identify",  label: "Identifies fittings, sizes and materials by sight" },
      { key: "truck.restock",   label: "Restocks the van without being asked" },
      { key: "truck.pull",      label: "Pulls the right parts for a job from the description" },
      { key: "truck.ferguson",  label: "Runs a supply house pickup solo" },
    ],
  },
  {
    key: "copper",
    name: "Copper",
    skills: [
      { key: "copper.cut",      label: "Cut, ream and deburr" },
      { key: "copper.solder",   label: "Solder a clean, leak-free joint" },
      { key: "copper.propress", label: "ProPress fittings" },
      { key: "copper.repair",   label: "Cut in a repair on a live line" },
    ],
  },
  {
    key: "pex",
    name: "PEX & Supply",
    skills: [
      { key: "pex.crimp",     label: "Crimp and expansion connections" },
      { key: "pex.manifold",  label: "Manifold layout and home runs" },
      { key: "pex.repipe",    label: "Repipe a fixture group" },
      { key: "pex.pressure",  label: "Pressure test and locate a leak" },
    ],
  },
  {
    key: "dwv",
    name: "Drain, Waste & Vent",
    skills: [
      { key: "dwv.snake",     label: "Snake a sink, tub and toilet line" },
      { key: "dwv.cleanout",  label: "Find and open a cleanout" },
      { key: "dwv.camera",    label: "Run the sewer camera and read the footage" },
      { key: "dwv.hydro",     label: "Hydro jetting" },
      { key: "dwv.vent",      label: "Venting basics and why a trap siphons" },
      { key: "dwv.abs",       label: "Cut and glue ABS/PVC to grade" },
    ],
  },
  {
    key: "fixtures",
    name: "Fixtures",
    skills: [
      { key: "fix.toilet",    label: "Pull, reset and set a toilet" },
      { key: "fix.faucet",    label: "Faucet and angle stop replacement" },
      { key: "fix.sink",      label: "Sink and drain assembly" },
      { key: "fix.shower",    label: "Tub and shower valve" },
      { key: "fix.disposal",  label: "Garbage disposal" },
      { key: "fix.fillvalve", label: "Diagnose a running or weak-flush toilet" },
    ],
  },
  {
    key: "water_heater",
    name: "Water Heaters",
    skills: [
      { key: "wh.swap",      label: "Tank swap start to finish" },
      { key: "wh.tp",        label: "T&P valve and discharge routing", gate: true },
      { key: "wh.expansion", label: "Expansion tank sizing and install" },
      { key: "wh.venting",   label: "Combustion air and venting", gate: true },
      { key: "wh.tankless",  label: "Tankless install and descaling" },
      { key: "wh.diagnose",  label: "Diagnose no-hot-water calls" },
    ],
  },
  {
    key: "gas",
    name: "Gas",
    skills: [
      { key: "gas.blackiron", label: "Black iron: measure, thread, assemble" },
      { key: "gas.csst",      label: "CSST runs and bonding", gate: true },
      { key: "gas.leaktest",  label: "Pressure and leak test a system", gate: true },
      { key: "gas.appliance", label: "Appliance connection and sediment trap", gate: true },
      { key: "gas.sizing",    label: "Line sizing for total BTU load" },
    ],
  },
  {
    key: "sewer",
    name: "Sewer & Main Line",
    skills: [
      { key: "sewer.locate", label: "Locate a line and mark depth" },
      { key: "sewer.dig",    label: "Excavation safety and shoring", gate: true },
      { key: "sewer.spot",   label: "Spot repair on a main" },
      { key: "sewer.reroute",label: "Reroute or replace a lateral" },
    ],
  },
  {
    key: "code",
    name: "Code & Permits",
    skills: [
      { key: "code.ubc",     label: "Knows which work needs a permit", gate: true },
      { key: "code.pull",    label: "Pull a City & County permit" },
      { key: "code.inspect", label: "Prep a job for inspection and meet the inspector" },
      { key: "code.backflow",label: "Backflow and cross-connection basics", gate: true },
    ],
  },
  {
    key: "customer",
    name: "Customer",
    skills: [
      { key: "cust.arrival",  label: "On-my-way text, arrival and introduction", gate: true },
      { key: "cust.explain",  label: "Explain the problem and the fix in plain language", gate: true },
      { key: "cust.pricing",  label: "Never quotes or discounts pricing on their own", gate: true },
      { key: "cust.hard",     label: "Handles an unhappy customer without escalating", gate: true },
      { key: "cust.upsell",   label: "Flags additional work for Jake to quote" },
    ],
  },
  {
    key: "admin",
    name: "App & Paperwork",
    skills: [
      { key: "admin.photos",    label: "Before and after photos on every job", gate: true },
      { key: "admin.notes",     label: "Job notes good enough to invoice from", gate: true },
      { key: "admin.materials", label: "Records materials used" },
      { key: "admin.hours",     label: "Logs their own hours accurately", gate: true },
    ],
  },
];

// Flat lookup, built once.
export const ALL_SKILLS = DOMAINS.flatMap(d =>
  d.skills.map(s => ({ ...s, domainKey: d.key, domainName: d.name }))
);

export const SKILL_COUNT = ALL_SKILLS.length;
export const GATE_SKILLS = ALL_SKILLS.filter(s => s.gate);

// Progress for one tech. `levels` is { skillKey: level }.
export function progressFor(levels = {}) {
  const lvl = (k) => Math.max(0, Math.min(MAX_LEVEL, levels[k] ?? 0));

  const gateTotal = GATE_SKILLS.length;
  const gateDone = GATE_SKILLS.filter(s => lvl(s.key) >= GATE_LEVEL).length;

  const atTechnical = ALL_SKILLS.filter(s => lvl(s.key) >= TECHNICAL_LEVEL).length;
  const technicalPct = SKILL_COUNT ? atTechnical / SKILL_COUNT : 0;

  // Overall completion is level-weighted, so moving a skill from Watched to
  // Assisted shows movement instead of nothing until it hits Solo.
  const points = ALL_SKILLS.reduce((s, sk) => s + lvl(sk.key), 0);
  const overallPct = SKILL_COUNT ? points / (SKILL_COUNT * MAX_LEVEL) : 0;

  const soloCount = ALL_SKILLS.filter(s => lvl(s.key) >= MAX_LEVEL).length;

  return {
    overallPct,
    technicalPct,
    atTechnical,
    soloCount,
    gateDone,
    gateTotal,
    gateRemaining: GATE_SKILLS.filter(s => lvl(s.key) < GATE_LEVEL),
    ready: gateDone === gateTotal && technicalPct >= TECHNICAL_THRESHOLD,
  };
}

export function domainProgress(domain, levels = {}) {
  const lvl = (k) => Math.max(0, Math.min(MAX_LEVEL, levels[k] ?? 0));
  const pts = domain.skills.reduce((s, sk) => s + lvl(sk.key), 0);
  return domain.skills.length ? pts / (domain.skills.length * MAX_LEVEL) : 0;
}
