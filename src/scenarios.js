// TrainBench scenario data.
// Times are minutes-since-midnight. arr === null means the train is already at a platform.

export const SCENARIOS = [
  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 1 — Stockholm Central (EASY)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'STO',
    name: 'Stockholm Central',
    subtitle: 'Morning Platform Conflict',
    city: 'Stockholm, Sweden',
    station: 'Centralstation',
    difficulty: 'EASY',
    duration: 20, // game minutes
    startTime: 7 * 60 + 45, // 07:45
    description:
      'Two intercity trains are converging on the same 14-minute platform window. A delayed local commuter is caught in the middle.',
    context:
      'Based on real scheduling conflicts at Stockholm C between the Gothenburg and Uppsala morning peak services. Platform 3 is a short bay platform — not all trains fit.',

    platforms: [
      { id: 'P1', label: '1', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'P2', label: '2', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'P3', label: '3', full: false, elec: true, status: 'FREE', trainId: null, sigFail: false },
    ],

    trains: [
      { id: 'SJ501', name: 'SJ 501 Göteborg→Stockholm', type: 'INTERCITY', priority: 2, pax: 320, needFull: true, needElec: true, arr: 7 * 60 + 48, dep: 8 * 60 + 2, delay: 0, status: 'APPROACHING', platId: null, blocked: false },
      { id: 'SL4423', name: 'SL 4423 Uppsala Local', type: 'COMMUTER', priority: 3, pax: 180, needFull: false, needElec: true, arr: 7 * 60 + 50, dep: 7 * 60 + 58, delay: 3, status: 'APPROACHING', platId: null, blocked: false },
      { id: 'X2803', name: 'SJ X2 803 Malmö→Stockholm', type: 'HIGH_SPEED', priority: 1, pax: 280, needFull: true, needElec: true, arr: 8 * 60 + 1, dep: 8 * 60 + 15, delay: 0, status: 'SCHEDULED', platId: null, blocked: false },
    ],

    events: [
      { at: 7, trainId: 'SJ501', type: 'DELAY', value: 4, msg: '⚡ Signal hold on outer approach — SJ501 +4 min additional delay' },
    ],

    // Reference solution used by scorer
    optimalAssign: { SJ501: 'P2', SL4423: 'P3', X2803: 'P1' },
    optimalNote:
      'SJ501→P2 (arrives first, needs full). SL4423→P3 (short is fine, quick turnaround). X2803→P1 (priority 1, arrives last, needs full).',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 2 — Penn Station (HARD)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'PEN',
    name: 'Penn Station',
    subtitle: 'Rush Hour Cascade',
    city: 'New York, USA',
    station: 'Penn Station',
    difficulty: 'HARD',
    duration: 30,
    startTime: 8 * 60,
    description:
      'Amtrak Acela mechanical fault blocks Platform 7 during peak hour. Four incoming trains need immediate re-routing.',
    context:
      'Modeled on the 2017 "Summer of Hell" disruptions. A single blocked platform during 08:00 rush can cascade to 600,000+ affected passengers. ACS100 is stuck with a door actuator fault — it cannot depart.',

    platforms: [
      { id: 'P7', label: '7', full: true, elec: true, status: 'OCCUPIED', trainId: 'ACS100', sigFail: false },
      { id: 'P8', label: '8', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'P9', label: '9', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'P10', label: '10', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'P11', label: '11', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'P12', label: '12', full: false, elec: true, status: 'FREE', trainId: null, sigFail: false },
    ],

    trains: [
      { id: 'ACS100', name: 'Amtrak Acela 100 (DC→Boston)', type: 'HIGH_SPEED', priority: 1, pax: 290, needFull: true, needElec: true, arr: 7 * 60 + 55, dep: 8 * 60 + 10, delay: 20, status: 'AT_PLATFORM', platId: 'P7', blocked: true, blockNote: 'Door actuator fault — est. +35min' },
      { id: 'NJT317', name: 'NJT 317 Trenton→Penn', type: 'COMMUTER', priority: 2, pax: 640, needFull: true, needElec: true, arr: 8 * 60 + 5, dep: 8 * 60 + 20, delay: 0, status: 'APPROACHING', platId: null, blocked: false },
      { id: 'NJT411', name: 'NJT 411 Princeton Jct→Penn', type: 'COMMUTER', priority: 2, pax: 520, needFull: true, needElec: true, arr: 8 * 60 + 8, dep: 8 * 60 + 25, delay: 2, status: 'APPROACHING', platId: null, blocked: false },
      { id: 'ACS108', name: 'Amtrak NEC 108 Philadelphia→Penn', type: 'INTERCITY', priority: 1, pax: 380, needFull: true, needElec: true, arr: 8 * 60 + 12, dep: 8 * 60 + 30, delay: 0, status: 'APPROACHING', platId: null, blocked: false },
      { id: 'LIRR22', name: 'LIRR 22 Jamaica→Penn [TERMINATES]', type: 'COMMUTER', priority: 3, pax: 710, needFull: true, needElec: true, arr: 8 * 60 + 15, dep: null, delay: 5, status: 'APPROACHING', platId: null, blocked: false, terminates: true },
    ],

    events: [
      { at: 5, trainId: 'ACS100', type: 'DELAY', value: 15, msg: '⚡ ACS100 mechanical confirmed: +15 min additional delay. Platform 7 blocked until ~08:40+' },
      { at: 10, trainId: null, type: 'INFO', value: 0, msg: '⚡ Surge alert: all approaching trains at 110–140% capacity' },
    ],

    optimalAssign: { NJT317: 'P8', NJT411: 'P9', ACS108: 'P10', LIRR22: 'P11' },
    optimalNote:
      'P7 stays with blocked ACS100. Waterfall: NJT317→P8, NJT411→P9, ACS108→P10, LIRR22→P11 by arrival order. P12 is short-only overflow.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 3 — Frankfurt Hbf (MEDIUM)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'FRA',
    name: 'Frankfurt Hbf',
    subtitle: 'ICE Connection Cascade',
    city: 'Frankfurt, Germany',
    station: 'Hauptbahnhof',
    difficulty: 'MEDIUM',
    duration: 25,
    startTime: 14 * 60 + 30,
    description:
      'ICE 621 from München is 18 minutes late. Three connecting trains wait at platforms — each with a hold limit before their own schedule cascades.',
    context:
      "Deutsche Bahn's Anschlussmanagement system. Frankfurt Hbf handles ~450 trains/day. This is the exact type of decision DB dispatchers face: weigh connecting passenger counts against cascading delays for on-board passengers.",

    platforms: [
      { id: 'G1', label: 'Gl. 1', full: true, elec: true, status: 'OCCUPIED', trainId: 'RE50', sigFail: false },
      { id: 'G2', label: 'Gl. 2', full: false, elec: true, status: 'OCCUPIED', trainId: 'RB15', sigFail: false },
      { id: 'G3', label: 'Gl. 3', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'G4', label: 'Gl. 4', full: true, elec: true, status: 'OCCUPIED', trainId: 'IC112', sigFail: false },
      { id: 'G10', label: 'Gl. 10', full: false, elec: false, status: 'OCCUPIED', trainId: 'S8', sigFail: false },
    ],

    trains: [
      { id: 'ICE621', name: 'ICE 621 München→Frankfurt', type: 'HIGH_SPEED', priority: 1, pax: 580, needFull: true, needElec: true, arr: 14 * 60 + 48, dep: 14 * 60 + 58, delay: 18, status: 'APPROACHING', platId: null, blocked: false },
      { id: 'RE50', name: 'RE 50 Frankfurt→Fulda', type: 'REGIONAL', priority: 3, pax: 210, needFull: false, needElec: true, arr: null, dep: 14 * 60 + 52, delay: 0, status: 'AT_PLATFORM', platId: 'G1', blocked: false, holdMax: 8, connPax: 45 },
      { id: 'RB15', name: 'RB 15 Frankfurt→Darmstadt', type: 'REGIONAL', priority: 4, pax: 155, needFull: false, needElec: true, arr: null, dep: 14 * 60 + 55, delay: 0, status: 'AT_PLATFORM', platId: 'G2', blocked: false, holdMax: 5, connPax: 22 },
      { id: 'IC112', name: 'IC 112 Frankfurt→Köln Hbf', type: 'INTERCITY', priority: 2, pax: 340, needFull: true, needElec: true, arr: null, dep: 14 * 60 + 58, delay: 0, status: 'AT_PLATFORM', platId: 'G4', blocked: false, holdMax: 12, connPax: 87 },
      { id: 'S8', name: 'S8 Frankfurt→Wiesbaden', type: 'COMMUTER', priority: 3, pax: 420, needFull: false, needElec: true, arr: null, dep: 14 * 60 + 59, delay: 0, status: 'AT_PLATFORM', platId: 'G10', blocked: false, holdMax: 3, connPax: 5 },
    ],

    // holdMax = max minutes this train can be held before DB policy mandates departure
    // connPax = passengers connecting from ICE621 onto this train

    events: [
      { at: 3, trainId: 'ICE621', type: 'INFO', value: 0, msg: '⚡ ICE 621 delay confirmed: +18 min. ETA now 15:06' },
      { at: 8, trainId: 'ICE621', type: 'DELAY', value: -4, msg: '⚡ ICE 621 recovered 4 min on approach. New ETA: 15:02' },
    ],

    optimalAssign: { ICE621: 'G3' },
    optimalNote:
      'ICE621→G3 (only free full+electric platform). HOLD IC112 only (87 connecting pax, 12-min hold window — largest ROI). Let RE50, RB15, S8 depart: their connection counts and hold windows are too small to justify cascade.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 4 — Clapham Junction (EXPERT)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'CLJ',
    name: 'Clapham Junction',
    subtitle: 'Signal Failure — Evening Peak',
    city: 'London, UK',
    station: 'Clapham Junction',
    difficulty: 'EXPERT',
    duration: 35,
    startTime: 17 * 60 + 15,
    description:
      'Signal failure on departure routes from Platforms A and B during 17:15 peak. Two packed trains are stranded. Three more inbound. Manual authorization required.',
    context:
      "Clapham Junction handles ~2,000 trains/day — Europe's busiest junction. The 2017 signal equipment failure disrupted 400k+ passengers for 4+ hours. Platforms A and B are down; their trains cannot depart until signals restore or are manually authorized.",

    platforms: [
      { id: 'A', label: 'A', full: true, elec: true, status: 'OCCUPIED', trainId: 'SW224', sigFail: true },
      { id: 'B', label: 'B', full: true, elec: true, status: 'OCCUPIED', trainId: 'SW310', sigFail: true },
      { id: 'C', label: 'C', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'D', label: 'D', full: true, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'E', label: 'E', full: false, elec: true, status: 'FREE', trainId: null, sigFail: false },
      { id: 'F', label: 'F', full: true, elec: true, status: 'OCCUPIED', trainId: 'TL445', sigFail: false },
    ],

    trains: [
      { id: 'SW224', name: 'SW 224 Victoria→Woking', type: 'COMMUTER', priority: 2, pax: 520, needFull: true, needElec: true, arr: 17 * 60 + 10, dep: 17 * 60 + 15, delay: 8, status: 'AT_PLATFORM', platId: 'A', blocked: true, blockNote: 'Signal failure — departure route DOWN' },
      { id: 'SW310', name: 'SW 310 Victoria→Basingstoke', type: 'COMMUTER', priority: 2, pax: 480, needFull: true, needElec: true, arr: 17 * 60 + 12, dep: 17 * 60 + 17, delay: 6, status: 'AT_PLATFORM', platId: 'B', blocked: true, blockNote: 'Signal failure — departure route DOWN' },
      { id: 'TL445', name: 'TL 445 Sutton→Blackfriars', type: 'COMMUTER', priority: 2, pax: 390, needFull: true, needElec: true, arr: 17 * 60 + 14, dep: 17 * 60 + 20, delay: 0, status: 'AT_PLATFORM', platId: 'F', blocked: false },
      { id: 'VT591', name: 'VT 591 Victoria→Brighton Express', type: 'INTERCITY', priority: 1, pax: 660, needFull: true, needElec: true, arr: 17 * 60 + 18, dep: 17 * 60 + 35, delay: 12, status: 'APPROACHING', platId: null, blocked: false },
      { id: 'SW288', name: 'SW 288 Waterloo→Epsom', type: 'COMMUTER', priority: 3, pax: 310, needFull: false, needElec: true, arr: 17 * 60 + 22, dep: 17 * 60 + 28, delay: 0, status: 'APPROACHING', platId: null, blocked: false },
      { id: 'LO773', name: 'London Overground 7723', type: 'COMMUTER', priority: 3, pax: 245, needFull: false, needElec: true, arr: 17 * 60 + 25, dep: 17 * 60 + 32, delay: 15, status: 'APPROACHING', platId: null, blocked: false },
    ],

    events: [
      { at: 0, trainId: null, type: 'SIGNAL', value: 0, msg: '⚡ SIGNAL FAILURE: Platforms A & B departure signals DOWN. Manual authorization required.' },
      { at: 8, trainId: null, type: 'SIGNAL', value: 0, msg: '⚡ Platform A signal RESTORED. Platform B still on manual.' },
      { at: 20, trainId: null, type: 'SIGNAL', value: 0, msg: '⚡ All signals RESTORED. Normal operations resumed.' },
    ],

    // sigFail platforms: BLOCKED trains on these platforms auto-unblock when their signal restores
    // Signal restore schedule: A restores at elapsed=8, B restores at elapsed=20

    optimalAssign: { VT591: 'C', SW288: 'D', LO773: 'E' },
    optimalNote:
      'Route VT591→C (priority 1, full, clear signal). SW288→D. LO773→E (short OK). Manually authorize SW224 departure after T+8 (A restored). Reroute SW310 to D after TL445 clears F, or E.',
  },
]

export const TRAIN_TYPE_COLORS = {
  HIGH_SPEED: '#818cf8',
  INTERCITY: '#60a5fa',
  COMMUTER: '#34d399',
  REGIONAL: '#f59e0b',
}

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id)
}
