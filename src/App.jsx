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
      holdMax: null, connPax: null, platId: null, actualDeparture: null, ...t,
    })),
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
      if (t.arr != null && s.time >= t.arr + t.delay && t.platId) {
        const plat = s.platforms.find((p) => p.id === t.platId)
        if (plat && plat.status === 'OCCUPIED' && plat.trainId && plat.trainId !== t.id) {
          registerConflict(s, `⚠ CONFLICT: ${t.id} reached ${plat.label} but it is occupied by ${plat.trainId}`, conflictKey(t.id, plat.trainId))
          // train stays APPROACHING
        } else if (plat) {
          plat.status = 'OCCUPIED'; plat.trainId = t.id; t.status = 'AT_PLATFORM'
          addLog(s, 'ARR', `▸ ${t.id} arrived at platform ${plat.label}`)
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

// ── Player actions ───────────────────────────────────────────────────────────
export function applyAssign(prev, trainId, platId) {
  const s = cloneState(prev)
  const scenario = getScenario(s.scenarioId)
  const train = s.trains.find((t) => t.id === trainId)
  const plat = s.platforms.find((p) => p.id === platId)
  if (!train || !plat) return prev
  if (train.needFull && !plat.full) {
    addLog(s, 'ERR', `✗ Cannot assign ${train.id} → ${plat.label}: requires FULL-length platform`)
    s.score = calcScore(s, scenario); return s
  }
  if (train.needElec && !plat.elec) {
    addLog(s, 'ERR', `✗ Cannot assign ${train.id} → ${plat.label}: requires ELECTRIFIED platform`)
    s.score = calcScore(s, scenario); return s
  }
  if ((plat.status === 'OCCUPIED' || plat.status === 'RESERVED') && plat.trainId && plat.trainId !== train.id) {
    registerConflict(s, `⚠ CONFLICT: ${plat.label} already holds ${plat.trainId} — cannot assign ${train.id}`, conflictKey(train.id, plat.trainId))
    s.score = calcScore(s, scenario); return s
  }
  // free old platform held by this train
  if (train.platId && train.platId !== plat.id) {
    const old = s.platforms.find((p) => p.id === train.platId)
    if (old && old.trainId === train.id) { old.status = 'FREE'; old.trainId = null }
  }
  plat.trainId = train.id
  plat.status = train.status === 'AT_PLATFORM' ? 'OCCUPIED' : 'RESERVED'
  train.platId = plat.id
  addLog(s, 'ACT', `📍 Assigned ${train.id} → platform ${plat.label} (${plat.status})`)
  s.score = calcScore(s, scenario)
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
  const [sel, setSel] = useState({ action: null, train: null, platform: null })
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
    setSel({ action: null, train: null, platform: null })
    setLlmText(''); setScoreResult(null); setCopied(false)
    setScreen('game')
  }
  function backHome() { setScreen('home'); setGameState(null) }
  function advance() { setGameState((prev) => tickState(prev)) }

  function chooseAction(a) { setSel((s) => ({ action: s.action === a ? null : a, train: null, platform: null })) }
  function chooseTrain(id) { if (mode === 'PLAY' && sel.action) setSel((s) => ({ ...s, train: id })) }
  function choosePlatform(id) { if (mode === 'PLAY' && sel.action === 'ASSIGN') setSel((s) => ({ ...s, platform: id })) }
  function execute() {
    if (!sel.action || !sel.train) return
    if (sel.action === 'ASSIGN') { if (!sel.platform) return; setGameState((prev) => applyAssign(prev, sel.train, sel.platform)) }
    else if (sel.action === 'HOLD') setGameState((prev) => applyHold(prev, sel.train))
    else if (sel.action === 'CLEAR') setGameState((prev) => applyClear(prev, sel.train))
    setSel((s) => ({ action: s.action, train: null, platform: null }))
  }

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

      <TrackYard
        state={gameState} scenario={scenario} platforms={gameState.platforms} trains={gameState.trains}
        mode={mode} sel={sel} onPickTrain={chooseTrain} onPickPlatform={choosePlatform}
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
          {mode === 'PLAY' && <ControlPanel sel={sel} onAction={chooseAction} onExecute={execute} />}
          <PlatformList platforms={gameState.platforms} trains={gameState.trains} mode={mode} sel={sel} onPick={choosePlatform} />
        </div>
        <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column' }}>
          <TrainTable trains={gameState.trains} platforms={gameState.platforms} mode={mode} sel={sel} onPick={chooseTrain} />
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
// Live track yard — the visual centerpiece. SVG rails/throats + HTML train cards
// that animate between approach → platform → departure as the game ticks.
// ─────────────────────────────────────────────────────────────────────────────
function platStatusColor(p) {
  return p.sigFail ? C.red : p.status === 'OCCUPIED' ? C.green : p.status === 'RESERVED' ? C.yellow : C.dim
}

function TrackYard({ state, scenario, platforms, trains, mode, sel, onPickTrain, onPickPlatform, onAdvance, ended }) {
  const n = platforms.length
  const VW = 1000
  const topPad = 56, trackGap = 64, botPad = 30
  const H = topPad + n * trackGap + botPad
  const yFor = (i) => topPad + i * trackGap
  const X = { stage: 78, appStart: 168, platL: 372, island: 520, platR: 700, depart: 936 }
  const yMid = topPad + (n * trackGap) / 2 - trackGap / 2
  const idx = {}
  platforms.forEach((p, i) => { idx[p.id] = i })
  const pct = (x) => `${(x / VW) * 100}%`

  const assignActive = mode === 'PLAY' && sel.action === 'ASSIGN'
  const trainClickable = mode === 'PLAY' && !!sel.action

  // Trains waiting for a platform (and not-yet-arrived) queue in the approach yard.
  const holding = trains
    .filter((t) => t.status === 'SCHEDULED' || (t.status === 'APPROACHING' && !t.platId))
    .sort((a, b) => (a.arr ?? 1e9) - (b.arr ?? 1e9))
  const holdSlot = {}
  holding.forEach((t, k) => { holdSlot[t.id] = k })
  const holdY = (k) => topPad + 4 + k * 50

  function target(t) {
    if (t.status === 'DEPARTED') {
      const i = t.platId != null && idx[t.platId] != null ? idx[t.platId] : Math.floor(n / 2)
      return { x: X.depart, y: yFor(i), op: 0.3 }
    }
    if (t.status === 'AT_PLATFORM') return { x: X.island, y: yFor(idx[t.platId] ?? 0), op: 1 }
    if (t.status === 'APPROACHING' && t.platId != null && idx[t.platId] != null) {
      const arrAt = (t.arr ?? state.time) + t.delay
      const prog = Math.max(0, Math.min(1, (state.time - (arrAt - 6)) / 6))
      return { x: X.appStart + (X.platL - X.appStart) * prog, y: yFor(idx[t.platId]), op: 1 }
    }
    const k = holdSlot[t.id] ?? 0
    return { x: X.stage, y: holdY(k), op: t.status === 'SCHEDULED' ? 0.55 : 1 }
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, margin: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ ...sectionTitle, margin: 0 }}>● LIVE TRACK YARD</span>
        <span style={{ fontSize: 10, color: C.dim }}>◀ approach &nbsp;·&nbsp; platforms &nbsp;·&nbsp; departure ▶</span>
        <div style={{ flex: 1 }} />
        {trainClickable && <span style={{ fontSize: 10, color: C.blue }}>▸ click a {assignActive ? 'train, then a platform' : 'train'} below</span>}
        <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{formatTime(state.time)} · T+{state.elapsed}/{scenario.duration}</span>
        <button onClick={onAdvance} disabled={ended} style={{
          ...btn(ended ? C.border : C.blue, ended ? C.dim : '#fff'),
          background: ended ? C.panel : C.blue, fontWeight: 'bold', cursor: ended ? 'not-allowed' : 'pointer',
        }}>{ended ? '■ ENDED' : '⏭ ADVANCE 1 MIN'}</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', minWidth: 760, height: H }}>
          {/* rails, throats, sleepers */}
          <svg viewBox={`0 0 ${VW} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, display: 'block' }}>
            <rect x={0} y={topPad - 14} width={X.appStart - 6} height={H - topPad - 6} fill={C.bg} opacity={0.5} rx={6} />
            <rect x={X.depart - 8} y={topPad - 14} width={VW - X.depart + 6} height={H - topPad - 6} fill={C.bg} opacity={0.5} rx={6} />
            {platforms.map((p, i) => {
              const y = yFor(i)
              const sc = platStatusColor(p)
              return (
                <g key={p.id}>
                  {/* approach + departure throats */}
                  <line x1={X.appStart} y1={yMid} x2={X.platL} y2={y} stroke={C.border} strokeWidth={1.4} strokeDasharray="4 4" />
                  <line x1={X.platR} y1={y} x2={X.depart} y2={yMid} stroke={C.border} strokeWidth={1.4} strokeDasharray="4 4" />
                  {/* twin rails across the platform road */}
                  <line x1={X.appStart} y1={y - 3} x2={X.depart} y2={y - 3} stroke={C.dim} strokeWidth={1.4} />
                  <line x1={X.appStart} y1={y + 3} x2={X.depart} y2={y + 3} stroke={C.dim} strokeWidth={1.4} />
                  {/* sleepers along the platform segment */}
                  {Array.from({ length: 9 }).map((_, k) => {
                    const sx = X.platL + ((X.platR - X.platL) / 8) * k
                    return <line key={k} x1={sx} y1={y - 5} x2={sx} y2={y + 5} stroke={C.border} strokeWidth={1} />
                  })}
                  {/* platform island slab */}
                  <rect x={X.platL} y={y + 9} width={X.platR - X.platL} height={16} rx={3} fill={sc + '22'} stroke={sc} strokeWidth={1} />
                </g>
              )
            })}
          </svg>

          {/* zone labels */}
          <div style={{ position: 'absolute', left: pct(X.stage), top: topPad - 30, transform: 'translateX(-50%)', fontSize: 9, color: C.dim, whiteSpace: 'nowrap' }}>◀ APPROACH</div>
          <div style={{ position: 'absolute', left: pct(X.island), top: topPad - 30, transform: 'translateX(-50%)', fontSize: 9, color: C.dim }}>PLATFORMS</div>
          <div style={{ position: 'absolute', left: pct(X.depart), top: topPad - 30, transform: 'translateX(-50%)', fontSize: 9, color: C.dim }}>DEPARTURE ▶</div>

          {/* platform island labels + signals (HTML overlay, clickable to assign) */}
          {platforms.map((p, i) => {
            const sc = platStatusColor(p)
            const isTarget = sel.platform === p.id
            const sigColor = p.sigFail ? C.red : p.status === 'OCCUPIED' ? C.green : p.status === 'RESERVED' ? C.yellow : C.green
            return (
              <React.Fragment key={p.id}>
                <div
                  onClick={() => assignActive && onPickPlatform(p.id)}
                  title={`Platform ${p.label}`}
                  style={{
                    position: 'absolute', left: pct(X.platL), width: pct(X.platR - X.platL), top: yFor(i) + 26,
                    boxSizing: 'border-box', padding: '2px 7px', borderRadius: 5,
                    border: `1px solid ${isTarget ? C.blue : 'transparent'}`,
                    background: isTarget ? C.blue + '22' : 'transparent',
                    cursor: assignActive ? 'pointer' : 'default',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
                  }}>
                  <span style={{ color: C.bright, fontWeight: 'bold', fontSize: 11, whiteSpace: 'nowrap' }}>{p.label}</span>
                  <span style={{ color: C.muted, fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.full ? 'FULL' : 'SHORT'}{p.elec ? ' ⚡' : ''}{p.sigFail ? ' ⚠' : ''}
                  </span>
                </div>
                {/* departure signal light */}
                <div style={{ position: 'absolute', left: pct(X.platR + 14), top: yFor(i) - 6, transform: 'translateX(-50%)', width: 11, height: 11, borderRadius: '50%', background: sigColor, boxShadow: `0 0 6px ${sigColor}`, border: `1px solid ${C.bg}` }} />
              </React.Fragment>
            )
          })}

          {/* trains */}
          {trains.map((t) => {
            const tp = target(t)
            const tcol = TRAIN_TYPE_COLORS[t.type]
            const onSigPlat = t.platId && platforms.find((p) => p.id === t.platId)?.sigFail
            const isSel = sel.train === t.id
            const border = isSel ? C.blue : t.blocked ? C.red : tcol
            const subtitle = t.blocked ? '🔒 BLOCKED' : t.status === 'DEPARTED' ? '✓ departed' : `${t.pax}p · P${t.priority}`
            return (
              <div key={t.id}
                onClick={() => trainClickable && onPickTrain(t.id)}
                style={{
                  position: 'absolute', left: pct(tp.x), top: tp.y, width: 138, height: 44,
                  transform: 'translate(-50%, -50%)', transition: 'left .6s ease, top .6s ease, opacity .5s ease',
                  opacity: tp.op, cursor: trainClickable ? 'pointer' : 'default', zIndex: t.status === 'AT_PLATFORM' ? 6 : 5,
                }}>
                <div style={{
                  display: 'flex', height: '100%', background: C.panel, border: `2px solid ${border}`,
                  borderRadius: '7px 13px 13px 7px', overflow: 'hidden',
                  boxShadow: isSel ? `0 0 0 3px ${C.blue}55` : '0 2px 4px #0007',
                }}>
                  <div style={{ width: 6, background: tcol, flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: '3px 6px', minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: C.bright, fontWeight: 'bold', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.id}</span>
                      {t.delay > 0 && <span style={{ color: '#1a1200', background: C.yellow, borderRadius: 5, fontSize: 8, padding: '0 4px', fontWeight: 'bold', flexShrink: 0 }}>+{t.delay}</span>}
                    </div>
                    <div style={{ color: t.blocked ? C.red : C.muted, fontSize: 8.5, fontWeight: t.blocked ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
                  </div>
                  <div style={{ width: 22, background: tcol + '2e', borderLeft: `1px solid ${tcol}`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flexShrink: 0 }}>
                    <div style={{ width: 9, height: 8, background: C.bg, borderRadius: 2, border: `1px solid ${tcol}` }} />
                    {onSigPlat && <span style={{ position: 'absolute', top: -1, right: 0, fontSize: 9 }}>⚠</span>}
                  </div>
                </div>
                <div style={{ position: 'absolute', bottom: -3, left: 16, width: 7, height: 7, borderRadius: '50%', background: C.dim }} />
                <div style={{ position: 'absolute', bottom: -3, right: 26, width: 7, height: 7, borderRadius: '50%', background: C.dim }} />
              </div>
            )
          })}
        </div>
      </div>

      {/* legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.muted }}>
        {Object.entries(TRAIN_TYPE_COLORS).map(([k, v]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, background: v, borderRadius: 2, display: 'inline-block' }} />{k.replace('_', ' ')}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: C.green, display: 'inline-block' }} />clear</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: C.red, display: 'inline-block' }} />signal down</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform list (left panel)
// ─────────────────────────────────────────────────────────────────────────────
function PlatformList({ platforms, trains, mode, sel, onPick }) {
  const clickable = mode === 'PLAY' && sel.action === 'ASSIGN'
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
      <div style={sectionTitle}>PLATFORMS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {platforms.map((p) => {
          const tr = p.trainId ? trains.find((t) => t.id === p.trainId) : null
          const isTarget = sel.platform === p.id
          const statusColor = p.status === 'OCCUPIED' ? C.green : p.status === 'RESERVED' ? C.yellow : C.dim
          return (
            <div key={p.id} onClick={() => clickable && onPick(p.id)} style={{
              border: `1px solid ${isTarget ? C.blue : p.sigFail ? C.red : C.border}`,
              background: isTarget ? C.blue + '18' : C.panel, borderRadius: 6, padding: '7px 9px',
              cursor: clickable ? 'pointer' : 'default',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.bright, fontWeight: 'bold', fontSize: 13 }}>Platform {p.label}</span>
                <span style={{ fontSize: 10, color: statusColor, fontWeight: 'bold' }}>{p.status}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 10, color: C.muted, marginTop: 3 }}>
                <span>{p.full ? 'FULL' : 'SHORT'}</span>
                <span>{p.elec ? '⚡ AC' : 'no power'}</span>
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
      {clickable && <div style={{ fontSize: 10, color: C.blue, marginTop: 8 }}>▸ Click a platform to set the assignment target</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Control panel (PLAY mode)
// ─────────────────────────────────────────────────────────────────────────────
function ControlPanel({ sel, onAction, onExecute }) {
  const canExec = sel.action && sel.train && (sel.action !== 'ASSIGN' || sel.platform)
  const actBtn = (a, label, color) => (
    <button onClick={() => onAction(a)} style={{
      ...btn(sel.action === a ? color : C.border, sel.action === a ? '#fff' : C.body),
      background: sel.action === a ? color : C.panel, textAlign: 'left', width: '100%',
    }}>{label}</button>
  )
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
      <div style={sectionTitle}>CONTROL PANEL</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {actBtn('ASSIGN', '📍 Assign Platform', C.blue)}
        {actBtn('HOLD', '⏸ Hold +5 min', C.yellow)}
        {actBtn('CLEAR', '🟢 Priority Clear', C.green)}
      </div>
      {sel.action && (
        <div style={{ marginTop: 8, fontSize: 11, color: C.muted, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, lineHeight: 1.7 }}>
          <div>Action: <b style={{ color: C.bright }}>{sel.action}</b></div>
          <div>Train: <b style={{ color: sel.train ? C.bright : C.dim }}>{sel.train || '— click a train row —'}</b></div>
          {sel.action === 'ASSIGN' && <div>Platform: <b style={{ color: sel.platform ? C.bright : C.dim }}>{sel.platform || '— click a platform —'}</b></div>}
        </div>
      )}
      {canExec && (
        <button onClick={onExecute} style={{ ...btn(C.green, '#fff'), background: C.green, width: '100%', marginTop: 8, fontWeight: 'bold' }}>
          ✓ EXECUTE {sel.action}
        </button>
      )}
      <div style={{ marginTop: 10, fontSize: 10, color: C.dim, lineHeight: 1.5 }}>
        Select an action, click a train in the yard (and a platform for assign), then EXECUTE.
        Advance time with ⏭ in the yard toolbar above.
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
  const clickable = mode === 'PLAY' && !!sel.action
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
      {clickable && <div style={{ fontSize: 10, color: C.blue, padding: '6px 10px' }}>▸ Click a train row to select it for {sel.action}</div>}
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
