import React, { useState, useMemo, useEffect } from 'react'
import { SCENARIOS, TRAIN_TYPE_COLORS, getScenario } from './scenarios.js'

// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#080d14', card: '#0d1520', panel: '#0f1c2d', border: '#1a2c40',
  dim: '#3a5068', muted: '#5a7a94', body: '#c8dae8', bright: '#e8f4ff',
  green: '#22c55e', yellow: '#f59e0b', red: '#ef4444', blue: '#3b82f6', purple: '#a78bfa',
}
const FONT = 'monospace'

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0')
function formatTime(min) {
  if (min == null) return '—'
  const t = ((min % 1440) + 1440) % 1440
  return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60)
}
function padR(s, n) { s = String(s); if (s.length > n) s = s.slice(0, n); return s.padEnd(n) }
function diffColor(d) { return d === 'EASY' ? C.green : d === 'MEDIUM' ? C.blue : d === 'HARD' ? C.yellow : C.red }
function totalColor(t) { return t >= 75 ? C.green : t >= 45 ? C.yellow : C.red }
function gradeFor(total) { return total >= 90 ? 'S' : total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : total >= 30 ? 'D' : 'F' }
function gradeColor(g) { return ({ S: C.purple, A: C.green, B: C.blue, C: C.yellow, D: '#f97316', F: C.red })[g] || C.muted }
function conflictKey(a, b) { return [a, b].sort().join('|') }
function platLabel(platforms, id) { const p = platforms.find((p) => p.id === id); return p ? p.label : id }
function btn(borderColor, textColor) {
  return { fontFamily: FONT, fontSize: 11, padding: '6px 12px', background: 'transparent', color: textColor, border: `1px solid ${borderColor}`, borderRadius: 6, cursor: 'pointer' }
}
const sectionTitle = { fontSize: 11, color: C.muted, fontWeight: 'bold', letterSpacing: 1, marginBottom: 8 }
const cellStyle = { padding: '5px 8px', whiteSpace: 'nowrap' }

// ─────────────────────────────────────────────────────────────────────────────
// Game state engine (pure functions — never mutate `prev`)
// ─────────────────────────────────────────────────────────────────────────────
function cloneState(prev) {
  return {
    ...prev,
    platforms: prev.platforms.map((p) => ({ ...p })),
    trains: prev.trains.map((t) => ({ ...t })),
    switches: prev.switches.map((sw) => ({ ...sw })),
    log: [...prev.log],
    firedEvents: new Set(prev.firedEvents),
    conflictKeys: new Set(prev.conflictKeys),
    score: { ...prev.score },
  }
}

function addLog(s, type, msg) {
  s.log = [{ time: s.time, type, msg }, ...s.log].slice(0, 80)
}

function registerConflict(s, msg, key) {
  if (key && s.conflictKeys.has(key)) {
    addLog(s, 'ERR', msg + ' [conflict already counted]')
    return
  }
  if (key) s.conflictKeys.add(key)
  s.conflicts += 1
  addLog(s, 'CONFLICT', msg)
}

function handleSignal(s) {
  // Clapham signal restore schedule keyed off elapsed minute.
  if (s.elapsed === 8) {
    const pa = s.platforms.find((p) => p.id === 'A')
    if (pa) pa.sigFail = false
    const t = s.trains.find((t) => t.id === 'SW224')
    if (t && t.blocked) { t.blocked = false; t.blockNote = ''; addLog(s, 'SIGNAL', '✓ SW224 departure authorized — Platform A signal restored') }
  }
  if (s.elapsed === 20) {
    const pb = s.platforms.find((p) => p.id === 'B')
    if (pb) pb.sigFail = false
    const t = s.trains.find((t) => t.id === 'SW310')
    if (t && t.blocked) { t.blocked = false; t.blockNote = ''; addLog(s, 'SIGNAL', '✓ SW310 departure authorized — Platform B signal restored') }
  }
}

function fireEvents(s, scenario) {
  scenario.events.forEach((ev, idx) => {
    if (ev.at === s.elapsed && !s.firedEvents.has(idx)) {
      s.firedEvents.add(idx)
      const logType = ev.type === 'SIGNAL' ? 'SIGNAL' : ev.type === 'DELAY' ? 'DELAY' : 'INFO'
      addLog(s, logType, ev.msg)
      if (ev.type === 'DELAY' && ev.trainId) {
        const t = s.trains.find((t) => t.id === ev.trainId)
        if (t) t.delay = Math.max(0, t.delay + ev.value)
      }
      if (ev.type === 'SIGNAL') handleSignal(s)
    }
  })
}

function calcScore(s, scenario) {
  const safety = Math.max(0, 40 - s.conflicts * 15)
  let efficiency = 0
  s.trains.filter((t) => t.status === 'DEPARTED').forEach((t) => {
    // Terminating trains have no scheduled departure to be late against.
    const lateness = t.dep == null ? 0 : (t.actualDeparture ?? t.dep) - t.dep
    if (lateness <= 0) efficiency += 15
    else if (lateness <= 5) efficiency += 10
    else if (lateness <= 15) efficiency += 5
    else efficiency += 2
  })
  efficiency = Math.min(40, efficiency)
  const throughput = Math.round((s.departed / scenario.trains.length) * 20)
  return { safety, efficiency, throughput, total: safety + efficiency + throughput }
}

export function initGame(scenario) {
  const s = {
    scenarioId: scenario.id,
    time: scenario.startTime,
    elapsed: 0,
    platforms: scenario.platforms.map((p) => ({ sigFail: false, ...p })),
    trains: scenario.trains.map((t) => ({
      delay: 0, blocked: false, blockNote: '', terminates: false,
      holdMax: null, connPax: null, platId: null, actualDeparture: null, routeSet: false, ...t,
    })),
    // Interlocking: a ladder of points (turnouts), one diverging to each platform.
    // To reach platform k the operator lines turnouts 0..k-1 NORMAL and turnout k REVERSE.
    switches: scenario.platforms.map((p, i) => ({ id: 'SW' + (i + 1), platIdx: i, platId: p.id, pos: 'N', locked: false, owner: null })),
    log: [],
    firedEvents: new Set(),
    conflictKeys: new Set(),
    conflicts: 0,
    departed: 0,
    ended: false,
    score: { safety: 40, efficiency: 0, throughput: 0, total: 40 },
  }
  addLog(s, 'INFO', `● Control session opened — ${scenario.name} (${scenario.station})`)
  fireEvents(s, scenario) // fire any at:0 events
  s.score = calcScore(s, scenario)
  return s
}

export function tickState(prev) {
  if (prev.ended) return prev
  const s = cloneState(prev)
  const scenario = getScenario(s.scenarioId)
  s.time += 1
  s.elapsed += 1
  fireEvents(s, scenario)

  s.trains.forEach((t) => {
    if (t.status === 'SCHEDULED') {
      if (t.arr != null && s.time >= t.arr + t.delay - 5) {
        t.status = 'APPROACHING'
        addLog(s, 'INFO', `${t.id} entering approach`)
      }
    } else if (t.status === 'APPROACHING') {
      // A train only proceeds when its route is SET — i.e. the operator has lined
      // the points to a platform and the signal has cleared. Otherwise it is held.
      if (t.arr != null && s.time >= t.arr + t.delay && t.platId && t.routeSet) {
        const plat = s.platforms.find((p) => p.id === t.platId)
        if (plat && plat.status === 'OCCUPIED' && plat.trainId && plat.trainId !== t.id) {
          registerConflict(s, `⚠ CONFLICT: ${t.id} reached ${plat.label} but it is occupied by ${plat.trainId}`, conflictKey(t.id, plat.trainId))
          // train stays APPROACHING
        } else if (plat) {
          plat.status = 'OCCUPIED'; plat.trainId = t.id; t.status = 'AT_PLATFORM'; t.routeSet = false
          // train has cleared the throat — release the points it held
          s.switches.forEach((sw) => { if (sw.owner === t.id) { sw.locked = false; sw.owner = null } })
          addLog(s, 'ARR', `▸ ${t.id} arrived at platform ${plat.label} — route normalised`)
          if (t.terminates) {
            t.status = 'DEPARTED'; t.actualDeparture = s.time
            plat.status = 'FREE'; plat.trainId = null
            s.departed += 1
            addLog(s, 'DEP', `◂ ${t.id} TERMINATED at ${plat.label} — ${t.pax} pax detrained`)
          }
        }
      }
    } else if (t.status === 'AT_PLATFORM') {
      if (!t.blocked && t.dep != null && s.time >= t.dep + t.delay) {
        const plat = s.platforms.find((p) => p.id === t.platId)
        if (plat) { plat.status = 'FREE'; plat.trainId = null }
        t.status = 'DEPARTED'; t.actualDeparture = s.time; s.departed += 1
        addLog(s, 'DEP', `◂ ${t.id} departed platform ${plat ? plat.label : '?'}`)
      }
    }
  })

  s.score = calcScore(s, scenario)
  if (s.elapsed >= scenario.duration && !s.ended) {
    s.ended = true
    addLog(s, 'INFO', `■ Scenario window closed (T+${s.elapsed}). Final score ${s.score.total}/100.`)
  }
  return s
}

// ── Interlocking helpers + player actions ────────────────────────────────────
// The throat is a ladder of turnouts. The first turnout set to REVERSE peels the
// route off the ladder onto its platform; turnouts before it must be NORMAL.
export function linedDest(switches) {
  const sw = switches.find((x) => x.pos === 'R')
  return sw ? sw.platIdx : null
}

function releaseTrainRoute(s, trainId) {
  s.switches.forEach((sw) => { if (sw.owner === trainId) { sw.locked = false; sw.owner = null } })
}

// Throw a single point (NORMAL ⇄ REVERSE). Rejected if locked under a set route.
export function throwSwitch(prev, swId) {
  const s = cloneState(prev)
  const sw = s.switches.find((x) => x.id === swId)
  if (!sw) return prev
  if (sw.locked) {
    addLog(s, 'ERR', `✗ ${sw.id} is LOCKED under a set route — release the route first`)
    return s
  }
  sw.pos = sw.pos === 'N' ? 'R' : 'N'
  const dest = linedDest(s.switches)
  addLog(s, 'ACT', `🔀 ${sw.id} → ${sw.pos === 'R' ? 'REVERSE' : 'NORMAL'}${dest != null ? `, points now line to ${s.platforms[dest].label}` : ', ladder runs straight through'}`)
  return s
}

// Convenience: line every unlocked ladder point toward platform index k.
export function lineToPlatform(prev, platIdx) {
  const s = cloneState(prev)
  const path = s.switches.filter((sw) => sw.platIdx <= platIdx)
  const locked = path.find((sw) => sw.locked && sw.owner)
  if (locked) {
    addLog(s, 'ERR', `✗ Cannot line to ${s.platforms[platIdx].label}: ${locked.id} is locked by ${locked.owner}`)
    return s
  }
  s.switches.forEach((sw) => { if (!sw.locked && sw.platIdx <= platIdx) sw.pos = sw.platIdx === platIdx ? 'R' : 'N' })
  addLog(s, 'ACT', `🔀 Points lined toward ${s.platforms[platIdx].label}`)
  return s
}

// Commit the currently-lined route to a train: lock the points, reserve the platform.
export function setRoute(prev, trainId) {
  const s = cloneState(prev)
  const scenario = getScenario(s.scenarioId)
  const t = s.trains.find((x) => x.id === trainId)
  if (!t) return prev
  if (t.status === 'AT_PLATFORM' || t.status === 'DEPARTED') {
    addLog(s, 'ERR', `✗ ${t.id} is not on approach — no arrival route to set`); return s
  }
  const dest = linedDest(s.switches)
  if (dest == null) {
    addLog(s, 'ERR', `✗ No route lined — throw a point to REVERSE to choose a platform for ${t.id}`); return s
  }
  const plat = s.platforms[dest]
  if (t.needFull && !plat.full) { addLog(s, 'ERR', `✗ ${t.id} → ${plat.label}: needs a FULL-length platform`); return s }
  if (t.needElec && !plat.elec) { addLog(s, 'ERR', `✗ ${t.id} → ${plat.label}: needs an ELECTRIFIED platform`); return s }
  if ((plat.status === 'OCCUPIED' || plat.status === 'RESERVED') && plat.trainId && plat.trainId !== t.id) {
    registerConflict(s, `⚠ CONFLICT: route set into ${plat.label} which already holds ${plat.trainId}`, conflictKey(t.id, plat.trainId))
    s.score = calcScore(s, scenario); return s
  }
  const path = s.switches.filter((sw) => sw.platIdx <= dest)
  const clash = path.find((sw) => sw.locked && sw.owner && sw.owner !== t.id)
  if (clash) { addLog(s, 'ERR', `✗ Interlocking: ${clash.id} is already locked by ${clash.owner}'s route`); return s }
  releaseTrainRoute(s, t.id)
  if (t.platId && t.platId !== plat.id) {
    const old = s.platforms.find((p) => p.id === t.platId)
    if (old && old.trainId === t.id && old.status === 'RESERVED') { old.status = 'FREE'; old.trainId = null }
  }
  path.forEach((sw) => { sw.pos = sw.platIdx === dest ? 'R' : 'N'; sw.locked = true; sw.owner = t.id })
  plat.status = 'RESERVED'; plat.trainId = t.id
  t.platId = plat.id; t.routeSet = true
  addLog(s, 'ACT', `✅ Route set & locked: ${t.id} → ${plat.label} — signal cleared`)
  s.score = calcScore(s, scenario)
  return s
}

// Release a not-yet-consumed route, freeing its points and platform reservation.
export function releaseRoute(prev, trainId) {
  const s = cloneState(prev)
  const t = s.trains.find((x) => x.id === trainId)
  if (!t) return prev
  if (t.status === 'AT_PLATFORM') { addLog(s, 'ERR', `✗ ${t.id} already berthed — route consumed`); return s }
  releaseTrainRoute(s, t.id)
  if (t.platId) {
    const p = s.platforms.find((x) => x.id === t.platId)
    if (p && p.trainId === t.id && p.status === 'RESERVED') { p.status = 'FREE'; p.trainId = null }
  }
  t.platId = null; t.routeSet = false
  addLog(s, 'ACT', `↩ Route released for ${t.id} — points free`)
  return s
}

export function applyHold(prev, trainId) {
  const s = cloneState(prev)
  const scenario = getScenario(s.scenarioId)
  const t = s.trains.find((t) => t.id === trainId)
  if (!t) return prev
  t.delay += 5
  addLog(s, 'ACT', `⏸ Held ${t.id} +5 min (delay now +${t.delay}m)`)
  s.score = calcScore(s, scenario)
  return s
}

export function applyClear(prev, trainId) {
  const s = cloneState(prev)
  const scenario = getScenario(s.scenarioId)
  const t = s.trains.find((t) => t.id === trainId)
  if (!t) return prev
  if (t.blocked) {
    addLog(s, 'ERR', `✗ Cannot clear ${t.id}: train is BLOCKED (${t.blockNote || 'fault'})`)
    s.score = calcScore(s, scenario); return s
  }
  t.delay = Math.max(0, t.delay - 3)
  addLog(s, 'ACT', `🟢 Priority-cleared ${t.id} (delay now +${t.delay}m)`)
  s.score = calcScore(s, scenario)
  return s
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM prompt generator
// ─────────────────────────────────────────────────────────────────────────────
export function buildPrompt(state, scenario) {
  const L = []
  L.push('╔═══════════════════════════════════════════════════════════════════════╗')
  L.push('║          RAIL OPERATIONS BENCHMARK v1.0 — LIVE CONTROL EXERCISE      ║')
  L.push('╚═══════════════════════════════════════════════════════════════════════╝')
  L.push(`SCENARIO   : ${scenario.name}  |  ${scenario.subtitle}`)
  L.push(`STATION    : ${scenario.station}, ${scenario.city}`)
  L.push(`GAME TIME  : ${formatTime(state.time)}  (T+${state.elapsed}/${scenario.duration} min)`)
  L.push(`DIFFICULTY : ${scenario.difficulty}`)
  L.push('')
  L.push('SITUATION')
  L.push('─────────────────────────────────────────────────')
  L.push(scenario.description)
  L.push('')
  L.push(scenario.context)
  L.push('')
  L.push('RECENT EVENTS / ALERTS')
  L.push('─────────────────────────────────────────────────')
  const fired = scenario.events.filter((ev, idx) => state.firedEvents.has(idx))
  if (fired.length === 0) L.push('  (none yet)')
  else fired.forEach((ev) => L.push('  • ' + ev.msg))
  L.push('')
  L.push('PLATFORM STATUS')
  L.push('─────────────────────────────────────────────────')
  L.push('  ' + padR('ID', 8) + padR('SIZE', 8) + padR('PWR', 7) + padR('STATUS', 11) + 'OCCUPANT')
  state.platforms.forEach((p) => {
    let flags = ''
    if (p.trainId) {
      const tr = state.trains.find((t) => t.id === p.trainId)
      if (tr && tr.blocked) flags += ` [BLOCKED: ${tr.blockNote || 'fault'}]`
    }
    if (p.sigFail) flags += ' [⚠ SIGNAL_FAIL]'
    L.push('  ' + padR(p.id, 8) + padR(p.full ? 'FULL' : 'SHORT', 8) + padR(p.elec ? 'AC' : 'NONE', 7) + padR(p.status, 11) + (p.trainId || '—') + flags)
  })
  L.push('')
  L.push('TRAIN STATUS')
  L.push('─────────────────────────────────────────────────')
  L.push('  ' + padR('ID', 9) + padR('NAME', 34) + padR('TYPE', 11) + padR('STATUS', 12) + padR('PRI', 5) + padR('ETA', 7) + padR('DEP', 7) + padR('DELAY', 7) + padR('PAX', 6) + padR('PLATFORM', 11) + 'FLAGS')
  state.trains.forEach((t) => {
    const eta = t.arr == null ? '—' : formatTime(t.arr + t.delay)
    const dep = t.dep == null ? '—' : formatTime(t.dep)
    const delay = t.delay > 0 ? `+${t.delay}m` : t.delay < 0 ? `${t.delay}m` : '0'
    const flags = []
    if (t.blocked) flags.push('BLOCKED')
    if (t.terminates) flags.push('TERMINATES')
    if (t.holdMax != null) flags.push(`MAX_HOLD:${t.holdMax}m`)
    if (t.connPax != null) flags.push(`CONN_PAX:${t.connPax}`)
    L.push('  ' + padR(t.id, 9) + padR(t.name, 34) + padR(t.type, 11) + padR(t.status, 12) + padR('P' + t.priority, 5) + padR(eta, 7) + padR(dep, 7) + padR(delay, 7) + padR(t.pax, 6) + padR(t.platId || '—', 11) + flags.join(' '))
  })
  L.push('')
  L.push('HARD CONSTRAINTS')
  L.push('─────────────────────────────────────────────────')
  L.push('  • SHORT platforms cannot accept trains that require FULL platforms')
  L.push('  • Non-electrified (NONE) platforms cannot accept electric trains')
  L.push('  • Two trains cannot share a platform simultaneously [SAFETY VIOLATION]')
  L.push('  • BLOCKED trains cannot depart until fault is cleared')
  L.push('  • Priority 1 = highest; route highest-priority trains preferentially')
  L.push('')
  L.push('AVAILABLE ACTIONS')
  L.push('─────────────────────────────────────────────────')
  L.push('  ASSIGN_PLATFORM  — assign a train to a specific platform')
  L.push("  HOLD_TRAIN       — increase a train's departure delay by N minutes")
  L.push('  CLEAR_DEPART     — priority-clear a non-blocked train (subtracts 3 min delay)')
  L.push('  REROUTE          — reassign an already-assigned train to a different platform')
  L.push('')
  L.push('SCORING (100pt total)')
  L.push('─────────────────────────────────────────────────')
  L.push('  SAFETY (40pt)     — 0 conflicts, 0 constraint violations')
  L.push('  EFFICIENCY (40pt) — minimize total passenger delay minutes')
  L.push('  THROUGHPUT (20pt) — maximize trains departed within scenario window')
  L.push('')
  L.push('RESPOND WITH THIS JSON ONLY — no markdown fences, no prose outside the JSON:')
  L.push('{')
  L.push('  "reasoning": "2-4 sentence analysis of the situation, key constraints, and your strategy",')
  L.push('  "decisions": [')
  L.push('    {')
  L.push('      "action": "ASSIGN_PLATFORM | HOLD_TRAIN | CLEAR_DEPART | REROUTE",')
  L.push('      "train_id": "...",')
  L.push('      "platform_id": "...",')
  L.push('      "hold_minutes": 0,')
  L.push('      "reason": "one-line justification"')
  L.push('    }')
  L.push('  ],')
  L.push('  "risk_level": "LOW | MEDIUM | HIGH | CRITICAL",')
  L.push('  "predicted_delay_passenger_minutes": 0,')
  L.push('  "confidence": 0.0')
  L.push('}')
  return L.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM response scorer
// ─────────────────────────────────────────────────────────────────────────────
function parseLLMJson(raw) {
  let txt = (raw || '').trim()
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) txt = fence[1].trim()
  try { return JSON.parse(txt) } catch (e) { /* fall through */ }
  const first = txt.indexOf('{'), last = txt.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(txt.slice(first, last + 1)) } catch (e) { /* fall through */ }
  }
  return null
}

export function scoreLLMResponse(raw, scenario) {
  const feedback = []
  const obj = parseLLMJson(raw)

  // 1. FORMAT (15)
  let format = 0
  if (obj) { format += 5; feedback.push({ icon: '✅', text: 'Valid JSON parsed' }) }
  else feedback.push({ icon: '❌', text: 'Could not parse JSON (check for stray prose / fences)' })
  const hasReasoning = obj && obj.reasoning != null && String(obj.reasoning).trim().length > 0
  if (hasReasoning) { format += 5; feedback.push({ icon: '✅', text: 'reasoning field present' }) }
  else if (obj) feedback.push({ icon: '⚠️', text: 'Missing / empty reasoning field' })
  const decisions = obj && Array.isArray(obj.decisions) ? obj.decisions : []
  if (decisions.length > 0) { format += 5; feedback.push({ icon: '✅', text: `${decisions.length} decision(s) provided` }) }
  else if (obj) feedback.push({ icon: '⚠️', text: 'Empty / missing decisions array' })

  // 2. SAFETY (35) — start at 25
  let safety = 25
  const assignedPlat = {} // platform_id -> train_id
  decisions.forEach((d, i) => {
    const action = String(d.action || '').toUpperCase()
    const train = scenario.trains.find((t) => t.id === d.train_id)
    const plat = scenario.platforms.find((p) => p.id === d.platform_id)
    if (action === 'ASSIGN_PLATFORM' || action === 'REROUTE') {
      let ok = true
      if (!train) { safety -= 5; ok = false; feedback.push({ icon: '❌', text: `D${i + 1}: unknown train "${d.train_id}"` }) }
      if (!plat) { safety -= 5; ok = false; feedback.push({ icon: '❌', text: `D${i + 1}: unknown platform "${d.platform_id}"` }) }
      if (train && plat) {
        if (train.needFull && !plat.full) { safety -= 10; ok = false; feedback.push({ icon: '❌', text: `D${i + 1}: ${train.id} too long for SHORT platform ${plat.id}` }) }
        if (train.needElec && !plat.elec) { safety -= 10; ok = false; feedback.push({ icon: '❌', text: `D${i + 1}: non-electric platform ${plat.id} for electric ${train.id}` }) }
        if (assignedPlat[plat.id] && assignedPlat[plat.id] !== train.id) { safety -= 15; ok = false; feedback.push({ icon: '❌', text: `D${i + 1}: CONFLICT — ${plat.id} already given to ${assignedPlat[plat.id]}` }) }
        assignedPlat[plat.id] = train.id
        if (ok) { safety += 2; feedback.push({ icon: '✅', text: `D${i + 1}: ${train.id} → ${plat.id} valid` }) }
      }
    } else if (action === 'CLEAR_DEPART') {
      if (train && train.blocked) { safety -= 15; feedback.push({ icon: '❌', text: `D${i + 1}: safety violation — CLEAR_DEPART on BLOCKED ${train.id}` }) }
      else if (train) feedback.push({ icon: '✅', text: `D${i + 1}: clear-depart ${train.id}` })
      else feedback.push({ icon: '⚠️', text: `D${i + 1}: CLEAR_DEPART on unknown train "${d.train_id}"` })
    } else if (action === 'HOLD_TRAIN') {
      if (train) feedback.push({ icon: '✅', text: `D${i + 1}: hold ${train.id}${d.hold_minutes ? ' ' + d.hold_minutes + 'm' : ''}` })
      else feedback.push({ icon: '⚠️', text: `D${i + 1}: HOLD_TRAIN on unknown train "${d.train_id}"` })
    } else {
      feedback.push({ icon: '⚠️', text: `D${i + 1}: unrecognized action "${d.action}"` })
    }
  })
  safety = Math.max(0, Math.min(35, safety))

  // 3. DECISION QUALITY (35)
  const optimal = scenario.optimalAssign || {}
  const optKeys = Object.keys(optimal)
  let matches = 0
  optKeys.forEach((tid) => {
    const hit = decisions.find((d) => d.train_id === tid && ['ASSIGN_PLATFORM', 'REROUTE'].includes(String(d.action || '').toUpperCase()) && d.platform_id === optimal[tid])
    if (hit) matches += 1
  })
  const matchScore = optKeys.length ? (matches / optKeys.length) * 30 : 0
  const unassigned = scenario.trains.filter((t) => !t.platId)
  const addressed = new Set(decisions.map((d) => d.train_id))
  const covered = unassigned.filter((t) => addressed.has(t.id)).length
  const coverage = unassigned.length ? covered / unassigned.length : 0
  const decision = Math.min(35, matchScore + coverage * 5)
  feedback.push({ icon: matches === optKeys.length ? '✅' : matches > 0 ? '⚠️' : '❌', text: `Optimal assignments matched: ${matches}/${optKeys.length}` })
  feedback.push({ icon: coverage >= 0.999 ? '✅' : coverage > 0 ? '⚠️' : '❌', text: `Coverage of unassigned trains: ${covered}/${unassigned.length}` })

  // 4. REASONING (10)
  const rtext = hasReasoning ? String(obj.reasoning) : ''
  const words = rtext.trim().split(/\s+/).filter(Boolean)
  let reasoning = words.length >= 30 ? 8 : words.length >= 15 ? 5 : 2
  const keywords = ['priority', 'conflict', 'delay', 'platform', 'passenger', 'connection', 'capacity', 'signal', 'safety', 'block']
  const lower = rtext.toLowerCase()
  const used = keywords.filter((k) => lower.includes(k))
  if (used.length >= 4) reasoning = Math.min(10, reasoning + 2)
  feedback.push({ icon: reasoning >= 8 ? '✅' : reasoning >= 5 ? '⚠️' : '❌', text: `Reasoning: ${words.length} words, ${used.length} domain keyword(s)` })

  // 5. RISK (5)
  const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
  const expMap = { EASY: 'LOW', MEDIUM: 'MEDIUM', HARD: 'HIGH', EXPERT: 'CRITICAL' }
  const expected = expMap[scenario.difficulty] || 'MEDIUM'
  const respRisk = obj && obj.risk_level ? String(obj.risk_level).toUpperCase().trim() : ''
  const ei = order.indexOf(expected), ri = order.indexOf(respRisk)
  let risk
  if (ri === -1) { risk = 1; feedback.push({ icon: '❌', text: `Risk level missing/invalid (expected ${expected})` }) }
  else {
    const dist = Math.abs(ri - ei)
    risk = dist === 0 ? 5 : dist === 1 ? 3 : 1
    feedback.push({ icon: dist === 0 ? '✅' : dist === 1 ? '⚠️' : '❌', text: `Risk: "${respRisk}" vs expected "${expected}"` })
  }

  const fmt = Math.round(format), saf = Math.round(safety), dec = Math.round(decision), rea = Math.round(reasoning), rsk = Math.round(risk)
  const total = fmt + saf + dec + rea + rsk
  return { format: fmt, safety: saf, decision: dec, reasoning: rea, risk: rsk, total, grade: gradeFor(total), feedback, expected, respRisk }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live LLM API client (browser → model endpoint)
// ─────────────────────────────────────────────────────────────────────────────
const API_DEFAULT_BASE = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1' }

function loadApiCfg() {
  const fallback = { provider: 'openai', baseUrl: '', apiKey: '', model: '' }
  try {
    const s = JSON.parse(localStorage.getItem('trainbench_api') || '{}')
    return { ...fallback, ...s }
  } catch (e) { return fallback }
}

// Calls an OpenAI-compatible (/chat/completions) or Anthropic (/messages) endpoint.
// Returns the raw text content of the model's reply (to be fed to scoreLLMResponse).
export async function callLLM(cfg, prompt) {
  const provider = cfg.provider || 'openai'
  const base = (cfg.baseUrl || API_DEFAULT_BASE[provider] || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('Missing base URL')
  if (!cfg.apiKey) throw new Error('Missing API key / token')
  if (!cfg.model) throw new Error('Missing model name')

  if (provider === 'anthropic') {
    const res = await fetch(base + '/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`)
    const data = await res.json()
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
  }

  // OpenAI-compatible (OpenAI, Azure-style gateways, OpenRouter, LiteLLM, vLLM, Ollama, …)
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a rail operations controller. Respond with ONLY the requested JSON.' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`)
  const data = await res.json()
  const msg = data.choices && data.choices[0] && data.choices[0].message
  return ((msg && (typeof msg.content === 'string' ? msg.content : (msg.content || []).map((c) => c.text || '').join('\n'))) || '').trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState('home')
  const [mode, setMode] = useState('PLAY')
  const [gameState, setGameState] = useState(null)
  const [sel, setSel] = useState({ train: null })
  const [llmText, setLlmText] = useState('')
  const [scoreResult, setScoreResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [apiCfg, setApiCfg] = useState(loadApiCfg)
  const [apiState, setApiState] = useState({ running: false, error: '' })
  const [runs, setRuns] = useState([])

  useEffect(() => {
    try { localStorage.setItem('trainbench_api', JSON.stringify(apiCfg)) } catch (e) { /* ignore */ }
  }, [apiCfg])

  const scenario = gameState ? getScenario(gameState.scenarioId) : null
  const promptText = useMemo(
    () => (gameState && scenario && mode === 'BENCHMARK' ? buildPrompt(gameState, scenario) : ''),
    [gameState, scenario, mode]
  )

  function startScenario(id) {
    setGameState(initGame(getScenario(id)))
    setSel({ train: null })
    setLlmText(''); setScoreResult(null); setCopied(false)
    setScreen('game')
  }
  function backHome() { setScreen('home'); setGameState(null) }
  function advance() { setGameState((prev) => tickState(prev)) }

  // Signal-box interactions (PLAY mode, direct manipulation).
  const playable = mode === 'PLAY' && gameState && !gameState.ended
  function selectTrain(id) { if (mode === 'PLAY') setSel((s) => ({ train: s.train === id ? null : id })) }
  function doThrow(swId) { if (playable) setGameState((prev) => throwSwitch(prev, swId)) }
  function doLine(platIdx) { if (playable) setGameState((prev) => lineToPlatform(prev, platIdx)) }
  function doSetRoute() { if (playable && sel.train) setGameState((prev) => setRoute(prev, sel.train)) }
  function doRelease() { if (playable && sel.train) setGameState((prev) => releaseRoute(prev, sel.train)) }
  function doHold() { if (playable && sel.train) setGameState((prev) => applyHold(prev, sel.train)) }
  function doClear() { if (playable && sel.train) setGameState((prev) => applyClear(prev, sel.train)) }

  function copyPrompt() {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(promptText).then(done).catch(done)
    else done()
  }
  function scoreResponse() { setScoreResult(scoreLLMResponse(llmText, scenario)) }

  async function runOnModel() {
    setApiState({ running: true, error: '' })
    setScoreResult(null)
    try {
      const text = await callLLM(apiCfg, promptText)
      setLlmText(text)
      const result = scoreLLMResponse(text, scenario)
      setScoreResult(result)
      setRuns((rs) => [{ model: apiCfg.model || '(model)', total: result.total, grade: result.grade, scenario: scenario.id, at: Date.now() }, ...rs].slice(0, 15))
      setApiState({ running: false, error: '' })
    } catch (e) {
      const msg = String((e && e.message) || e)
      const hint = /Failed to fetch|NetworkError|CORS/i.test(msg)
        ? ' — likely CORS/network. The endpoint must allow browser (cross-origin) calls; many gateways do, api.openai.com does not.'
        : ''
      setApiState({ running: false, error: msg + hint })
    }
  }

  if (screen === 'home') return <Home mode={mode} setMode={setMode} onStart={startScenario} />

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.body, fontFamily: FONT }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20 }}>
        <Header scenario={scenario} gameState={gameState} mode={mode} setMode={setMode} onBack={backHome} />
        <ScoreBar score={gameState.score} />
      </div>

      <InterlockingYard
        state={gameState} scenario={scenario} mode={mode} sel={sel}
        onPickTrain={selectTrain} onLine={doLine} onThrow={doThrow}
        onAdvance={advance} ended={gameState.ended}
      />

      {mode === 'BENCHMARK' && (
        <BenchmarkPanel
          promptText={promptText} copied={copied} onCopy={copyPrompt}
          llmText={llmText} setLlmText={setLlmText} onScore={scoreResponse} scoreResult={scoreResult}
          apiCfg={apiCfg} setApiCfg={setApiCfg} apiState={apiState} onRun={runOnModel} runs={runs}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 300, flexShrink: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'PLAY' && (
            <SignalBox
              state={gameState} sel={sel}
              onSetRoute={doSetRoute} onRelease={doRelease} onHold={doHold} onClear={doClear}
            />
          )}
          <PlatformList platforms={gameState.platforms} trains={gameState.trains} switches={gameState.switches} mode={mode} onPick={doLine} />
        </div>
        <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column' }}>
          <TrainTable trains={gameState.trains} platforms={gameState.platforms} mode={mode} sel={sel} onPick={selectTrain} />
          <EventLog log={gameState.log} />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Home screen
// ─────────────────────────────────────────────────────────────────────────────
function ModeToggle({ mode, setMode, small }) {
  const opt = (val, label) => {
    const active = mode === val
    const accent = val === 'PLAY' ? C.blue : C.purple
    return (
      <button onClick={() => setMode(val)} style={{
        cursor: 'pointer', fontFamily: FONT, fontSize: small ? 11 : 13, fontWeight: 'bold',
        padding: small ? '6px 12px' : '10px 22px', background: active ? accent : 'transparent',
        color: active ? '#fff' : C.muted, border: 'none', borderRight: val === 'PLAY' ? `1px solid ${C.border}` : 'none',
      }}>{label}</button>
    )
  }
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {opt('PLAY', '▶ PLAY')}{opt('BENCHMARK', '🤖 BENCHMARK')}
    </div>
  )
}

function ScenarioCard({ s, onStart }) {
  const [hover, setHover] = useState(false)
  return (
    <div onClick={() => onStart(s.id)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ cursor: 'pointer', background: C.card, border: `1px solid ${hover ? diffColor(s.difficulty) : C.border}`, borderRadius: 10, padding: 18, transition: 'border-color .15s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: C.bright }}>{s.name}</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{s.subtitle}</div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 'bold', color: diffColor(s.difficulty), border: `1px solid ${diffColor(s.difficulty)}`, borderRadius: 4, padding: '3px 8px' }}>{s.difficulty}</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, margin: '10px 0', lineHeight: 1.5 }}>{s.description}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
        <span>📍 {s.city}</span><span>⏱ {s.duration}m</span><span>🚆 {s.trains.length} trains</span><span>🚉 {s.platforms.length} platforms</span>
      </div>
    </div>
  )
}

function Home({ mode, setMode, onStart }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.body, fontFamily: FONT, padding: '40px 24px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', fontSize: 42, fontWeight: 'bold', color: C.bright, letterSpacing: 1 }}>🚂 TrainBench</div>
        <div style={{ textAlign: 'center', color: C.muted, margin: '8px 0 28px', fontSize: 14 }}>
          LLM-agnostic operational benchmark · Human-playable · Fully scorable (100pt)
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <ModeToggle mode={mode} setMode={setMode} />
        </div>
        {mode === 'BENCHMARK' && (
          <div style={{ maxWidth: 720, margin: '0 auto 28px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
            <span style={{ color: C.purple, fontWeight: 'bold' }}>BENCHMARK MODE · </span>
            Select a scenario → Copy the auto-generated prompt → Paste into any LLM (GPT-4o, Claude, Gemini, Llama 3, Mistral…) → Paste the JSON response back → Score out of 100. Compare models objectively.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {SCENARIOS.map((s) => <ScenarioCard key={s.id} s={s} onStart={onStart} />)}
        </div>
        <div style={{ textAlign: 'center', color: C.dim, fontSize: 11, marginTop: 28 }}>
          v1.0 · {mode === 'PLAY' ? 'PLAY MODE — you control the station' : 'BENCHMARK MODE — generate a prompt for any model'}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Game header + score bar
// ─────────────────────────────────────────────────────────────────────────────
function Header({ scenario, gameState, mode, setMode, onBack }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.panel, flexShrink: 0 }}>
      <button onClick={onBack} style={btn(C.border, C.muted)}>← BACK</button>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontWeight: 'bold', color: C.bright, fontSize: 15 }}>
          {scenario.name} <span style={{ color: C.muted, fontWeight: 'normal', fontSize: 12 }}>· {scenario.subtitle}</span>
        </span>
        <span style={{ fontSize: 11, color: C.dim }}>{scenario.station}, {scenario.city}</span>
      </div>
      <div style={{ flex: 1 }} />
      {gameState.ended && <span style={{ fontSize: 11, fontWeight: 'bold', color: C.red, border: `1px solid ${C.red}`, borderRadius: 4, padding: '3px 8px' }}>■ ENDED</span>}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 18, color: C.bright, fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>{formatTime(gameState.time)}</div>
        <div style={{ fontSize: 11, color: C.muted }}>T+{gameState.elapsed} / {scenario.duration} min</div>
      </div>
      <ModeToggle mode={mode} setMode={setMode} small />
    </div>
  )
}

function ScoreBar({ score }) {
  const seg = (label, val, max, color) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 14px', borderRight: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: C.muted }}>{label}</span>
        <span style={{ color, fontWeight: 'bold' }}>{val}/{max}</span>
      </div>
      <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(val / max) * 100}%`, background: color }} />
      </div>
    </div>
  )
  return (
    <div style={{ display: 'flex', background: C.card, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      {seg('SAFETY', score.safety, 40, C.green)}
      {seg('EFFICIENCY', score.efficiency, 40, C.blue)}
      {seg('THROUGHPUT', score.throughput, 20, C.purple)}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 14px', justifyContent: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span style={{ color: C.muted }}>TOTAL</span>
          <span style={{ color: totalColor(score.total), fontWeight: 'bold', fontSize: 14 }}>{score.total}/100</span>
        </div>
        <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${score.total}%`, background: totalColor(score.total) }} />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Realistic interlocking yard — a ladder of points (turnouts) the operator throws
// to line routes from the approach into platforms. Track blocks show occupancy,
// signals show aspects, and trains follow whatever route has been set for them.
// ─────────────────────────────────────────────────────────────────────────────
function blockColor(p) {
  // signalling convention: occupied track = red, set route = green, free = dark
  return p.sigFail ? C.red : p.status === 'OCCUPIED' ? C.red : p.status === 'RESERVED' ? C.green : C.dim
}

function SignalLamp({ x, y, color, label }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, border: `1px solid ${C.bg}` }} />
      {label && <span style={{ fontSize: 7, color: C.dim, marginTop: 1 }}>{label}</span>}
    </div>
  )
}

function InterlockingYard({ state, scenario, mode, sel, onPickTrain, onLine, onThrow, onAdvance, ended }) {
  const { platforms, trains, switches } = state
  const n = platforms.length
  const gap = 60, top = 100, bottom = 58, receptionY = 30
  const Tx = (i) => 150 + i * 72
  const yFor = (i) => top + i * gap
  const platRight = Tx(n - 1) + 340
  const exitX = platRight + 108
  const W = exitX + 36
  const H = yFor(n - 1) + bottom
  const E = { x: 56, y: yFor(0) - 26 }
  const berthX = (i) => Tx(i) + 150
  const yMidE = yFor(0) + ((n - 1) * gap) / 2
  const idxOf = {}; platforms.forEach((p, i) => { idxOf[p.id] = i })
  const dest = linedDest(switches)
  const playable = mode === 'PLAY' && !ended
  const anyRouteSet = trains.some((t) => t.routeSet)

  const holding = trains
    .filter((t) => t.status === 'SCHEDULED' || (t.status === 'APPROACHING' && !t.routeSet))
    .sort((a, b) => (a.arr ?? 1e9) - (b.arr ?? 1e9))
  const holdSlot = {}; holding.forEach((t, k) => { holdSlot[t.id] = k })
  const holdX = (k) => 150 + k * 176

  const lerp = (a, b, t) => a + (b - a) * t
  function pointAlong(pts, t) {
    if (t <= 0) return pts[0]
    if (t >= 1) return pts[pts.length - 1]
    const segs = []; let total = 0
    for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); segs.push(d); total += d }
    let target = t * total
    for (let i = 0; i < segs.length; i++) { if (target <= segs[i]) { const f = segs[i] ? target / segs[i] : 0; return { x: lerp(pts[i].x, pts[i + 1].x, f), y: lerp(pts[i].y, pts[i + 1].y, f) } } target -= segs[i] }
    return pts[pts.length - 1]
  }
  function routePath(k) {
    const pts = [E]
    for (let i = 0; i <= k; i++) pts.push({ x: Tx(i), y: yFor(i) })
    pts.push({ x: berthX(k), y: yFor(k) })
    return pts
  }
  function trainPos(t) {
    if (t.status === 'DEPARTED') { const i = idxOf[t.platId] ?? Math.floor(n / 2); return { x: exitX, y: yFor(i), op: 0.28 } }
    if (t.status === 'AT_PLATFORM') { const i = idxOf[t.platId] ?? 0; return { x: berthX(i), y: yFor(i), op: 1 } }
    if (t.status === 'APPROACHING' && t.routeSet && idxOf[t.platId] != null) {
      const i = idxOf[t.platId]; const arrAt = (t.arr ?? state.time) + t.delay
      const prog = Math.max(0, Math.min(1, (state.time - (arrAt - 6)) / 6))
      return { ...pointAlong(routePath(i), prog), op: 1 }
    }
    const k = holdSlot[t.id] ?? 0; return { x: holdX(k), y: receptionY + 14, op: t.status === 'SCHEDULED' ? 0.5 : 1 }
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, margin: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ ...sectionTitle, margin: 0 }}>⊟ INTERLOCKING — {scenario.station}</span>
        {playable && (
          <span style={{ fontSize: 10, color: C.dim }}>points lined to:{' '}
            <b style={{ color: dest != null ? C.green : C.dim }}>{dest != null ? platforms[dest].label : '— none (ladder runs straight) —'}</b>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{formatTime(state.time)} · T+{state.elapsed}/{scenario.duration}</span>
        <button onClick={onAdvance} disabled={ended} style={{ ...btn(ended ? C.border : C.blue, ended ? C.dim : '#fff'), background: ended ? C.panel : C.blue, fontWeight: 'bold', cursor: ended ? 'not-allowed' : 'pointer' }}>{ended ? '■ ENDED' : '⏭ ADVANCE 1 MIN'}</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: W, height: H }}>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, display: 'block' }}>
            <rect x={130} y={receptionY - 6} width={Math.max(60, holding.length * 176)} height={42} rx={6} fill={C.bg} stroke={C.border} strokeDasharray="3 3" />
            {/* approach line into the ladder */}
            <line x1={20} y1={E.y} x2={E.x} y2={E.y} stroke={C.muted} strokeWidth={3} />
            <line x1={E.x} y1={E.y} x2={Tx(0)} y2={yFor(0)} stroke={anyRouteSet ? C.green : C.dim} strokeWidth={3} />
            {/* ladder through-segments */}
            {platforms.slice(0, n - 1).map((_, i) => {
              const through = switches[i].locked && switches[i].pos === 'N'
              return <line key={i} x1={Tx(i)} y1={yFor(i)} x2={Tx(i + 1)} y2={yFor(i + 1)} stroke={through ? C.green : C.dim} strokeWidth={3} />
            })}
            {/* buffer past the last turnout */}
            <line x1={Tx(n - 1)} y1={yFor(n - 1)} x2={Tx(n - 1) + 28} y2={yFor(n - 1) + 20} stroke={C.dim} strokeWidth={2.5} />
            {/* per-platform diverge blade, twin rails, sleepers, east connector */}
            {platforms.map((p, i) => {
              const y = yFor(i); const bc = blockColor(p)
              const rev = switches[i].pos === 'R'
              const divColor = switches[i].locked ? C.green : rev ? C.yellow : C.dim
              return (
                <g key={p.id}>
                  <line x1={Tx(i)} y1={y} x2={Tx(i) + 26} y2={y} stroke={divColor} strokeWidth={rev ? 3 : 1.6} strokeDasharray={rev ? '0' : '3 3'} />
                  <line x1={Tx(i) + 24} y1={y - 3} x2={platRight} y2={y - 3} stroke={bc} strokeWidth={2} />
                  <line x1={Tx(i) + 24} y1={y + 3} x2={platRight} y2={y + 3} stroke={bc} strokeWidth={2} />
                  {Array.from({ length: 10 }).map((_, k) => { const sx = Tx(i) + 44 + k * ((platRight - Tx(i) - 54) / 9); return <line key={k} x1={sx} y1={y - 5} x2={sx} y2={y + 5} stroke={C.border} strokeWidth={1} /> })}
                  <line x1={platRight} y1={y} x2={exitX} y2={yMidE} stroke={C.border} strokeWidth={1.3} strokeDasharray="4 4" />
                </g>
              )
            })}
            <line x1={exitX} y1={yMidE} x2={W - 8} y2={yMidE} stroke={C.muted} strokeWidth={3} />
          </svg>

          <div style={{ position: 'absolute', left: 18, top: receptionY - 22, fontSize: 9, color: C.dim }}>◀ APPROACH / RECEPTION</div>
          <div style={{ position: 'absolute', left: exitX - 26, top: yMidE - 26, fontSize: 9, color: C.dim }}>DEPARTURE ▶</div>
          <SignalLamp x={E.x - 6} y={E.y - 20} color={anyRouteSet ? C.green : C.red} label="entry" />

          {/* turnouts (clickable) + platform labels + signals */}
          {platforms.map((p, i) => {
            const sw = switches[i]; const y = yFor(i); const bc = blockColor(p)
            const routeIn = p.status === 'RESERVED' ? C.green : p.sigFail ? C.red : p.status === 'OCCUPIED' ? C.red : C.dim
            const occ = p.trainId ? trains.find((t) => t.id === p.trainId) : null
            const startCol = p.sigFail ? C.red : occ && occ.blocked ? C.red : occ ? C.green : C.dim
            const lit = dest === i
            return (
              <React.Fragment key={p.id}>
                <button onClick={() => playable && onThrow(sw.id)} title={`${sw.id} — ${sw.pos === 'R' ? 'REVERSE' : 'NORMAL'}${sw.locked ? ' (locked)' : ''}`}
                  style={{
                    position: 'absolute', left: Tx(i) - 16, top: y - 14, width: 32, height: 28, borderRadius: 6,
                    cursor: playable ? 'pointer' : 'default', padding: 0,
                    background: sw.locked ? C.green + '22' : lit ? C.yellow + '22' : C.panel,
                    border: `1px solid ${sw.locked ? C.green : lit ? C.yellow : C.border}`,
                    color: sw.pos === 'R' ? C.yellow : C.muted, fontFamily: FONT, fontSize: 11, fontWeight: 'bold',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{sw.locked ? '🔒' : sw.pos}</button>
                <SignalLamp x={Tx(i) + 30} y={y - 18} color={routeIn} />
                <div onClick={() => playable && onLine(i)} title={`Line points toward ${p.label}`}
                  style={{
                    position: 'absolute', left: platRight - 96, top: y - 11, padding: '2px 7px', borderRadius: 5,
                    border: `1px solid ${lit ? C.yellow : C.border}`, background: C.panel, cursor: playable ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  }}>
                  <span style={{ color: bc === C.dim ? C.bright : bc, fontWeight: 'bold', fontSize: 11 }}>{p.label}</span>
                  <span style={{ color: C.muted, fontSize: 8.5 }}>{p.full ? 'FULL' : 'SHORT'}{p.elec ? ' ⚡' : ''}{p.sigFail ? ' ⚠' : ''}</span>
                </div>
                <SignalLamp x={platRight + 6} y={y - 5} color={startCol} />
              </React.Fragment>
            )
          })}

          {/* trains */}
          {trains.map((t) => {
            const tp = trainPos(t); const tcol = TRAIN_TYPE_COLORS[t.type]
            const onSig = t.platId && platforms.find((p) => p.id === t.platId)?.sigFail
            const isSel = sel.train === t.id
            const border = isSel ? C.blue : t.blocked ? C.red : tcol
            const sub = t.blocked ? '🔒 BLOCKED' : t.status === 'DEPARTED' ? '✓ departed' : t.routeSet ? `▶ routed → ${t.platId}` : `${t.pax}p · P${t.priority}`
            return (
              <div key={t.id} onClick={() => mode === 'PLAY' && onPickTrain(t.id)}
                style={{ position: 'absolute', left: tp.x, top: tp.y, width: 150, height: 42, transform: 'translate(-50%,-50%)', transition: 'left .6s ease, top .6s ease, opacity .5s', opacity: tp.op, cursor: mode === 'PLAY' ? 'pointer' : 'default', zIndex: t.status === 'AT_PLATFORM' ? 6 : 5 }}>
                <div style={{ display: 'flex', height: '100%', background: C.panel, border: `2px solid ${border}`, borderRadius: '6px 12px 12px 6px', overflow: 'hidden', boxShadow: isSel ? `0 0 0 3px ${C.blue}55` : '0 2px 4px #0007' }}>
                  <div style={{ width: 6, background: tcol }} />
                  <div style={{ flex: 1, padding: '3px 6px', minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{ color: C.bright, fontWeight: 'bold', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.id}</span>
                      {t.delay > 0 && <span style={{ color: '#1a1200', background: C.yellow, borderRadius: 5, fontSize: 8, padding: '0 4px', fontWeight: 'bold' }}>+{t.delay}</span>}
                    </div>
                    <div style={{ color: t.blocked ? C.red : C.muted, fontSize: 8.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
                  </div>
                  <div style={{ width: 20, background: tcol + '2e', borderLeft: `1px solid ${tcol}`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <div style={{ width: 8, height: 7, background: C.bg, borderRadius: 2, border: `1px solid ${tcol}` }} />
                    {onSig && <span style={{ position: 'absolute', top: -1, right: 0, fontSize: 9 }}>⚠</span>}
                  </div>
                </div>
                <div style={{ position: 'absolute', bottom: -3, left: 14, width: 7, height: 7, borderRadius: '50%', background: C.dim }} />
                <div style={{ position: 'absolute', bottom: -3, right: 24, width: 7, height: 7, borderRadius: '50%', background: C.dim }} />
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.muted }}>
        {Object.entries(TRAIN_TYPE_COLORS).map(([k, v]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, background: v, borderRadius: 2 }} />{k.replace('_', ' ')}</span>
        ))}
        <span style={{ flex: 1 }} />
        <span><b style={{ color: C.muted }}>N/R</b> point normal/reverse · 🔒 locked</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: C.green }} />route/clear</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: C.red }} />occupied/blocked</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform list (left panel)
// ─────────────────────────────────────────────────────────────────────────────
function PlatformList({ platforms, trains, switches, mode, onPick }) {
  const clickable = mode === 'PLAY'
  const dest = switches ? linedDest(switches) : null
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
      <div style={sectionTitle}>PLATFORMS / BLOCKS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {platforms.map((p, i) => {
          const tr = p.trainId ? trains.find((t) => t.id === p.trainId) : null
          const sw = switches ? switches[i] : null
          const lit = dest === i
          const statusColor = p.sigFail ? C.red : p.status === 'OCCUPIED' ? C.red : p.status === 'RESERVED' ? C.green : C.dim
          return (
            <div key={p.id} onClick={() => clickable && onPick(i)} style={{
              border: `1px solid ${lit ? C.yellow : p.sigFail ? C.red : C.border}`,
              background: lit ? C.yellow + '14' : C.panel, borderRadius: 6, padding: '7px 9px',
              cursor: clickable ? 'pointer' : 'default',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.bright, fontWeight: 'bold', fontSize: 13 }}>Platform {p.label}</span>
                <span style={{ fontSize: 10, color: statusColor, fontWeight: 'bold' }}>{p.status}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 10, color: C.muted, marginTop: 3, flexWrap: 'wrap' }}>
                <span>{p.full ? 'FULL' : 'SHORT'}</span>
                <span>{p.elec ? '⚡ AC' : 'no power'}</span>
                {sw && <span style={{ color: sw.locked ? C.green : sw.pos === 'R' ? C.yellow : C.dim }}>pts {sw.locked ? '🔒' : sw.pos}</span>}
                {p.sigFail && <span style={{ color: C.red }}>⚠ SIG FAIL</span>}
              </div>
              {tr && (
                <div style={{ fontSize: 10, color: C.body, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>
                  {tr.id} · {tr.name}{tr.blocked ? ' · 🔒 BLOCKED' : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {clickable && <div style={{ fontSize: 10, color: C.blue, marginTop: 8 }}>▸ Click a platform to line the points toward its block</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal box (PLAY mode) — route setting + train regulation
// ─────────────────────────────────────────────────────────────────────────────
function SignalBox({ state, sel, onSetRoute, onRelease, onHold, onClear }) {
  const t = sel.train ? state.trains.find((x) => x.id === sel.train) : null
  const dest = linedDest(state.switches)
  const onApproach = t && (t.status === 'APPROACHING' || t.status === 'SCHEDULED')
  const Btn = (label, onClick, color, enabled) => (
    <button onClick={() => enabled && onClick()} disabled={!enabled} style={{
      ...btn(enabled ? color : C.border, enabled ? '#fff' : C.dim),
      background: enabled ? color : C.panel, width: '100%', textAlign: 'left', fontWeight: 'bold',
      marginBottom: 6, cursor: enabled ? 'pointer' : 'not-allowed',
    }}>{label}</button>
  )
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
      <div style={sectionTitle}>⊟ SIGNAL BOX</div>
      <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
        1 · select a train. 2 · throw points <b style={{ color: C.bright }}>N/R</b> in the yard (or click a platform) to line a route. 3 · SET ROUTE — the train runs when its signal clears.
      </div>
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, marginBottom: 8, fontSize: 11, lineHeight: 1.7 }}>
        <div>Train: <b style={{ color: t ? C.bright : C.dim }}>{t ? t.id : '— none selected —'}</b></div>
        <div>Points lined to: <b style={{ color: dest != null ? C.green : C.dim }}>{dest != null ? state.platforms[dest].label : '— none —'}</b></div>
        {t && <div>Status: <b style={{ color: t.blocked ? C.red : C.body }}>{t.blocked ? 'BLOCKED' : t.status}{t.routeSet ? ' · route set' : ''}</b></div>}
      </div>
      {Btn(dest != null && onApproach ? `✅ SET ROUTE → ${state.platforms[dest].label}` : '✅ SET ROUTE', onSetRoute, C.green, !!(t && onApproach && dest != null))}
      {Btn('↩ RELEASE ROUTE', onRelease, C.yellow, !!(t && t.routeSet))}
      {Btn('⏸ HOLD +5 min', onHold, C.blue, !!t)}
      {Btn('🟢 PRIORITY CLEAR −3 min', onClear, C.purple, !!(t && !t.blocked))}
      <div style={{ fontSize: 9.5, color: C.dim, lineHeight: 1.5, marginTop: 2 }}>
        Points lock under a set route; release it before re-lining. Advance time with ⏭ in the yard.
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Train table (right panel)
// ─────────────────────────────────────────────────────────────────────────────
function TrainTable({ trains, platforms, mode, sel, onPick }) {
  const th = (label) => (
    <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontSize: 10, fontWeight: 'normal', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: C.card }}>{label}</th>
  )
  const clickable = mode === 'PLAY'
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, margin: 12, overflow: 'hidden' }}>
      <div style={{ ...sectionTitle, padding: '8px 10px 0', margin: 0 }}>TRAINS</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead><tr>{['ID', 'NAME', 'TYPE', 'STATUS', 'ETA', 'DEP', 'DELAY', 'PAX', 'PRI', 'PLATFORM'].map((h) => <React.Fragment key={h}>{th(h)}</React.Fragment>)}</tr></thead>
          <tbody>
            {trains.map((t) => {
              const tcol = TRAIN_TYPE_COLORS[t.type]
              const departed = t.status === 'DEPARTED'
              const statusColor = t.blocked ? C.red : departed ? C.muted : tcol
              const isSel = sel.train === t.id
              return (
                <tr key={t.id} onClick={() => clickable && onPick(t.id)} style={{
                  cursor: clickable ? 'pointer' : 'default', opacity: departed ? 0.45 : 1,
                  background: isSel ? C.blue + '22' : 'transparent', borderBottom: `1px solid ${C.border}`,
                }}>
                  <td style={cellStyle}><b style={{ color: t.blocked ? C.red : C.bright }}>{t.id}</b></td>
                  <td style={{ ...cellStyle, color: C.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</td>
                  <td style={cellStyle}><span style={{ color: tcol, fontSize: 10 }}>{t.type}</span></td>
                  <td style={cellStyle}><span style={{ color: statusColor, fontWeight: t.blocked ? 'bold' : 'normal', fontSize: 10 }}>{t.blocked ? 'BLOCKED' : t.status}</span></td>
                  <td style={{ ...cellStyle, color: C.body }}>{t.arr == null ? '—' : formatTime(t.arr + t.delay)}</td>
                  <td style={{ ...cellStyle, color: C.body }}>{t.dep == null ? '—' : formatTime(t.dep)}</td>
                  <td style={{ ...cellStyle, color: t.delay > 0 ? C.yellow : C.dim }}>{t.delay > 0 ? `+${t.delay}` : '0'}</td>
                  <td style={{ ...cellStyle, color: C.body }}>{t.pax}</td>
                  <td style={{ ...cellStyle, color: C.muted }}>P{t.priority}</td>
                  <td style={cellStyle}>{t.platId ? <span style={{ color: C.bright }}>{platLabel(platforms, t.platId)}</span> : <span style={{ color: C.dim }}>—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {clickable && <div style={{ fontSize: 10, color: C.blue, padding: '6px 10px' }}>▸ Click a train row to select it in the signal box</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark panel + score result
// ─────────────────────────────────────────────────────────────────────────────
function BenchmarkPanel({ promptText, copied, onCopy, llmText, setLlmText, onScore, scoreResult, apiCfg, setApiCfg, apiState, onRun, runs }) {
  const ta = { width: '100%', boxSizing: 'border-box', resize: 'vertical', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: FONT, lineHeight: 1.4, padding: 8 }
  const inp = { boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.bright, fontFamily: FONT, fontSize: 11, padding: '7px 8px', width: '100%' }
  const set = (k) => (e) => setApiCfg({ ...apiCfg, [k]: e.target.value })
  const defBase = API_DEFAULT_BASE[apiCfg.provider] || ''
  return (
    <div style={{ margin: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Live model runner */}
      <div style={{ background: C.card, border: `1px solid ${C.purple}66`, borderRadius: 8, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ color: C.purple, fontWeight: 'bold', fontSize: 13 }}>🤖 RUN ON A LIVE MODEL</span>
          <span style={{ fontSize: 10, color: C.dim }}>calls your endpoint from the browser and scores the reply automatically</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px,170px) 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <select value={apiCfg.provider} onChange={set('provider')} style={{ ...inp, cursor: 'pointer' }}>
            <option value="openai">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input value={apiCfg.baseUrl} onChange={set('baseUrl')} placeholder={`Base URL — default ${defBase}`} style={inp} />
          <input value={apiCfg.model} onChange={set('model')} placeholder="Model id (e.g. gpt-4o-mini, claude-sonnet-4-5, llama-3.3-70b)" style={inp} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={apiCfg.apiKey} onChange={set('apiKey')} type="password" placeholder="API key / token" style={{ ...inp, flex: '1 1 240px', width: 'auto' }} />
          <button onClick={onRun} disabled={apiState.running} style={{ ...btn(C.purple, '#fff'), background: apiState.running ? C.panel : C.purple, fontWeight: 'bold', minWidth: 160, cursor: apiState.running ? 'wait' : 'pointer' }}>
            {apiState.running ? '⏳ RUNNING…' : '▶ RUN & SCORE'}
          </button>
        </div>
        {apiState.error && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.red, background: C.red + '14', border: `1px solid ${C.red}55`, borderRadius: 6, padding: '7px 9px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>⚠ {apiState.error}</div>
        )}
        <div style={{ marginTop: 8, fontSize: 9.5, color: C.dim }}>API key is stored only in this browser (localStorage). The endpoint must permit cross-origin (CORS) browser requests.</div>
        {runs.length > 0 && (
          <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 5 }}>RUN HISTORY · this session</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {runs.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 11, alignItems: 'center' }}>
                  <span style={{ color: gradeColor(r.grade), fontWeight: 'bold', width: 16 }}>{r.grade}</span>
                  <span style={{ color: C.bright, width: 38, fontVariantNumeric: 'tabular-nums' }}>{r.total}/100</span>
                  <span style={{ color: C.dim, width: 38 }}>{r.scenario}</span>
                  <span style={{ color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.model}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Prompt + manual response */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 380px', minWidth: 280, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: C.purple, fontWeight: 'bold', fontSize: 12 }}>① GENERATED PROMPT</span>
          <button onClick={onCopy} style={{ ...btn(copied ? C.green : C.border, copied ? '#fff' : C.body), background: copied ? C.green : C.panel }}>{copied ? '✓ COPIED' : '⧉ COPY'}</button>
        </div>
        <textarea readOnly value={promptText} style={{ ...ta, color: C.body, height: 320, fontSize: 10.5 }} />
      </div>
      <div style={{ flex: '1 1 380px', minWidth: 280, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: C.blue, fontWeight: 'bold', fontSize: 12 }}>② PASTE LLM RESPONSE</span>
          <button onClick={onScore} style={{ ...btn(C.blue, '#fff'), background: C.blue }}>⚖ SCORE</button>
        </div>
        <textarea value={llmText} onChange={(e) => setLlmText(e.target.value)} placeholder="Paste the model's JSON response here…" style={{ ...ta, color: C.bright, height: scoreResult ? 130 : 320, fontSize: 11 }} />
        {scoreResult && <ScoreResult r={scoreResult} />}
      </div>
      </div>
    </div>
  )
}

function ScoreResult({ r }) {
  const dim = (label, val, max) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 9, color: C.muted }}>{label}</div>
      <div style={{ fontSize: 13, color: C.bright, fontWeight: 'bold' }}>{val}<span style={{ color: C.dim, fontSize: 9 }}>/{max}</span></div>
      <div style={{ height: 4, background: C.bg, borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${(val / max) * 100}%`, background: gradeColor(r.grade) }} /></div>
    </div>
  )
  return (
    <div style={{ marginTop: 10, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 30, fontWeight: 'bold', color: gradeColor(r.grade), lineHeight: 1 }}>{r.grade}</div>
        <div>
          <div style={{ fontSize: 20, color: C.bright, fontWeight: 'bold' }}>{r.total}<span style={{ fontSize: 12, color: C.muted }}>/100</span></div>
          <div style={{ fontSize: 10, color: C.muted }}>Risk: {r.respRisk || '—'} (expected {r.expected})</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {dim('FORMAT', r.format, 15)}{dim('SAFETY', r.safety, 35)}{dim('DECISION', r.decision, 35)}{dim('REASONING', r.reasoning, 10)}{dim('RISK', r.risk, 5)}
      </div>
      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {r.feedback.map((f, i) => (
          <div key={i} style={{ fontSize: 10.5, color: C.body, lineHeight: 1.4 }}><span style={{ marginRight: 6 }}>{f.icon}</span>{f.text}</div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Event log
// ─────────────────────────────────────────────────────────────────────────────
function EventLog({ log }) {
  const colorFor = (type) => ({ ARR: C.green, DEP: C.purple, ACT: C.blue, CONFLICT: C.red, ERR: C.red, SIGNAL: C.yellow, DELAY: C.yellow, INFO: C.muted }[type] || C.muted)
  return (
    <div style={{ margin: '0 12px 12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
      <div style={sectionTitle}>EVENT LOG</div>
      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
        {log.length === 0 && <div style={{ color: C.dim }}>No events yet.</div>}
        {log.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, lineHeight: 1.5, borderBottom: `1px solid ${C.bg}`, padding: '2px 0' }}>
            <span style={{ color: C.dim, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{formatTime(e.time)}</span>
            <span style={{ color: colorFor(e.type), flexShrink: 0, width: 64, fontSize: 10 }}>{e.type}</span>
            <span style={{ color: C.body }}>{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
