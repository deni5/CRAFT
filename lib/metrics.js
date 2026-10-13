// Розрахунки показників дашборду CRAFT (без жорстко прописаних констант).
// TWR: r_t = (V_t − F_t) / V_{t−1} − 1, де F_t — рух капіталу (capital_flows) у день t.

export const MODEL_SWITCHES = [
  { date: '2026-10-08', label: 'v4.0' },
]

const NON_TRADE = /Поповнення|Перший вхід|Міграц/i

export function isRealTrade(t) {
  return (t.btc_amount || 0) > 0 && !NON_TRADE.test(t.note || '')
}

export function dedupeByDate(rows) {
  const m = new Map()
  rows.forEach(r => m.set(r.date, r))
  return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

export function computePerformance(portfolioRows, flows) {
  const port = dedupeByDate(portfolioRows).filter(p => p.portfolio > 0)
  if (port.length < 2) return null
  const flowByDate = {}
  let initial = null
  flows.forEach(f => {
    const a = Number(f.amount_usdt) || 0
    if (f.type === 'initial') { initial = (initial || 0) + a; return }
    flowByDate[f.date] = (flowByDate[f.date] || 0) + a
  })
  let nav = 1, peak = 1, maxDD = 0
  const p0 = port[0].btc_price
  const series = [{ date: port[0].date, craft: 100, bh: 100, value: port[0].portfolio }]
  for (let i = 1; i < port.length; i++) {
    const f = flowByDate[port[i].date] || 0
    const r = (port[i].portfolio - f) / port[i - 1].portfolio - 1
    nav *= 1 + r
    peak = Math.max(peak, nav)
    maxDD = Math.min(maxDD, nav / peak - 1)
    series.push({ date: port[i].date, craft: nav * 100, bh: (port[i].btc_price / p0) * 100, value: port[i].portfolio, flow: f || null })
  }
  const last = port[port.length - 1]
  const netContrib = (initial ?? port[0].portfolio) + Object.values(flowByDate).reduce((s, v) => s + v, 0)
  const twr = (nav - 1) * 100
  const bh = (last.btc_price / p0 - 1) * 100
  return {
    twr, bh, excess: twr - bh, maxDD: maxDD * 100,
    netContrib, pnl: last.portfolio - netContrib, pnlPct: (last.portfolio / netContrib - 1) * 100,
    start: port[0].date, end: last.date, series,
  }
}

export function summarizeModels(obs, models) {
  const byModel = {}
  obs.forEach(o => { (byModel[o.model] = byModel[o.model] || []).push(o) })
  const meta = Object.fromEntries((models || []).map(m => [m.model, m]))
  const names = Object.keys(byModel).sort((a, b) => (meta[a]?.sort_order ?? 99) - (meta[b]?.sort_order ?? 99))
  const rows = names.map(name => {
    const g = byModel[name].sort((a, b) => (a.date < b.date ? -1 : 1))
    let peak = 0, dd = 0
    g.forEach(r => { peak = Math.max(peak, r.nav); dd = Math.min(dd, r.nav / peak - 1) })
    const last = g[g.length - 1]
    return {
      model: name, title: meta[name]?.title || name, description: meta[name]?.description || '', kind: meta[name]?.kind || '',
      days: g.length, start: g[0].date, end: last.date,
      ret: (last.nav - 1) * 100, maxDD: dd * 100, position: last.position, signal: last.signal,
      trades: g.filter(r => (r.trade || 0) > 1e-9).length,
    }
  })
  const dates = [...new Set(obs.map(o => o.date))].sort()
  const chart = dates.map(d => {
    const row = { date: d.slice(5) }
    obs.filter(o => o.date === d).forEach(o => { row[o.model] = (o.nav - 1) * 100 })
    return row
  })
  return { rows, chart, names }
}
