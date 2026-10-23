'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { computePerformance, summarizeModels, isRealTrade, dedupeByDate, MODEL_SWITCHES } from '../lib/metrics'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ReferenceLine, ReferenceArea
} from 'recharts'

const COLORS = { BUY: '#10b981', SELL: '#ef4444', HOLD: '#f59e0b', LONG: '#10b981', FLAT: '#6b7280' }
const C = {
  bg: '#0a0e1a', card: '#111827', border: '#1f2937',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  blue: '#3b82f6', purple: '#8b5cf6', orange: '#f97316',
  text: '#e2e8f0', muted: '#6b7280', dim: '#374151'
}
// Фіксований колір за моделлю (не за рангом)
const MODEL_COLORS = {
  v4_live: '#f97316', gru_noemb: '#3987e5', logreg_noemb: '#d55181',
  tsmom_vt: '#199e70', vt_bh: '#c98500', bh: '#9ca3af',
  v4_t045: '#fdba74', v4_t040: '#ea580c', v4_t035: '#9a3412',
  v4_edge02: '#a78bfa', v4_edge05: '#6d28d9', gru_t045: '#93c5fd', gru_t040: '#1d4ed8',
}
// Групи на вкладці «Моделі»: основні моделі і підбір порогу рішення (бойова v4 і B&H — як орієнтири)
const MODEL_GROUPS = [
  { key: 'main', title: 'Основні моделі', pick: r => r.kind !== 'threshold' },
  { key: 'thr', title: 'Підбір порогу рішення (з 19.10.2026)', pick: r => r.kind === 'threshold' || r.model === 'v4_live' || r.model === 'bh',
    intro: 'Варіанти використовують той самий щоденний прогноз, що й бойова модель, і відрізняються лише правилом рішення. «Поріг» — мінімальна впевненість моделі для угоди за правилами бота (бойовий поріг 0.70 модель v4 практично не досягає). «Перевага BUY над SELL» — тримати BTC, коли ймовірність зростання перевищує ймовірність падіння на задану величину. Всі варіанти ведуться з 08.10 з тією самою стартовою позицією, що й бойовий портфель.' },
]
const FLOW_LABEL = { initial: 'Стартовий капітал', deposit: 'Поповнення', withdrawal: 'Вилучення', testnet_reset: 'Скидання testnet', correction: 'Коригування балансу' }
const grid = min => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 })
const cardStyle = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }
const titleStyle = { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }
const mono = { fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace" }
const pct = (v, d = 1) => (v == null || isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`)
const usd = (v, d = 0) => (v == null || isNaN(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })}`)
const fmtDate = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '')

function KPICard({ label, value, sub, color, hint }) {
  return (
    <div title={hint} style={{ ...cardStyle, padding: '20px 24px', cursor: hint ? 'help' : 'default' }}>
      <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || C.text, ...mono, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

function SignalBadge({ signal, size = 'md' }) {
  const sz = size === 'lg' ? { fontSize: 22, padding: '8px 28px' } : { fontSize: 12, padding: '3px 12px' }
  const col = COLORS[signal] || C.muted
  return (
    <span style={{ ...sz, fontWeight: 700, borderRadius: 6, background: col + '20', border: `1px solid ${col}`, color: col, ...mono, letterSpacing: '0.05em' }}>{signal}</span>
  )
}

const CustomTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1f2937', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.text }}>
          {p.name}: {typeof p.value === 'number'
            ? unit === '%' ? pct(p.value, 2) : unit === 'p' ? `${(p.value * 100).toFixed(1)}%` : unit === '$' ? usd(p.value) : p.value.toFixed(3)
            : p.value}
        </div>
      ))}
    </div>
  )
}

const Note = ({ children }) => <div style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>{children}</div>

export default function Dashboard() {
  const [tab, setTab] = useState('overview')
  const [signals, setSignals] = useState([])
  const [trades, setTrades] = useState([])
  const [portfolio, setPortfolio] = useState([])
  const [sentiment, setSentiment] = useState([])
  const [flows, setFlows] = useState([])
  const [obs, setObs] = useState([])
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    // Supabase віддає щонайбільше 1000 рядків за запит — читаємо всі сторінки
    const q = async t => {
      const all = []
      for (let from = 0; ; from += 1000) {
        const r = await supabase.from(t).select('*').order('date', { ascending: true }).range(from, from + 999)
        if (r.error) return all.length ? { data: all } : r
        all.push(...(r.data || []))
        if (!r.data || r.data.length < 1000) return { data: all }
      }
    }
    const [s, t, p, sent, f, o, m] = await Promise.all([
      q('signals'), q('trades'), q('portfolio_history'), q('sentiment_history'),
      q('capital_flows'), q('model_observations'), supabase.from('models').select('*'),
    ])
    if (s.data) setSignals(dedupeByDate(s.data))
    if (t.data) setTrades(t.data)
    if (p.data) setPortfolio(p.data)
    if (sent.data) setSentiment(sent.data)
    if (f.data) setFlows(f.data)
    if (o.data) setObs(o.data)
    if (m.data) setModels(m.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 300000)
    return () => clearInterval(interval)
  }, [fetchData])

  const latest = signals[signals.length - 1] || {}
  const perf = computePerformance(portfolio, flows)
  const realTrades = trades.filter(isRealTrade)
  const todayTrades = realTrades.filter(t => t.date === latest.date)
  const lastRun = latest.created_at ? new Date(latest.created_at) : null
  const runAgeH = lastRun ? (Date.now() - lastRun.getTime()) / 3.6e6 : null
  const currentPortfolio = latest.portfolio || 0
  const thr = latest.signal === 'SELL' ? 0.5 : 0.7
  const action = todayTrades.length
    ? `Виконано: ${todayTrades.map(t => `${t.type} ${t.btc_amount.toFixed(6)} BTC`).join(', ')}`
    : latest.signal === 'HOLD' ? 'Сьогодні без угоди: сигнал HOLD'
    : (latest.confidence || 0) < thr ? `Сьогодні без угоди: впевненість нижче порогу ${thr.toFixed(2)}`
    : 'Сигнал активний'
  const switchDates = MODEL_SWITCHES.map(s => s.date.slice(5))
  const firstSwitch = MODEL_SWITCHES[0]

  const signalChartData = (() => {
    const sentMap = {}
    sentiment.forEach(s => { sentMap[s.date] = s })
    return signals.map(s => {
      const sent = sentMap[s.date] || {}
      return {
        date: s.date?.slice(5), confidence: s.confidence, sell: s.sell_prob, hold: s.hold_prob, buy: s.buy_prob, price: s.price,
        mean: sent.sentiment_mean ?? null, momentum: sent.sentiment_momentum ?? null,
        bear: sent.bear_signal ?? null, bullish: sent.bullish_ratio ?? null,
      }
    })
  })()
  const perfChart = (perf?.series || []).map(r => ({ ...r, date: r.date.slice(5) }))
  const ms = summarizeModels(obs, models)

  const tabs = [
    { id: 'overview', label: 'Огляд' },
    { id: 'signals', label: 'Сигнали' },
    { id: 'trades', label: 'Угоди і капітал' },
    { id: 'models', label: 'Моделі' },
    { id: 'about', label: 'Про систему' },
  ]

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: C.bg }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>₿</div>
        <div style={{ color: C.muted, fontSize: 14 }}>Завантаження даних...</div>
      </div>
    </div>
  )

  const switchMarkers = switchDates.map(d => (
    <ReferenceLine key={d} x={d} stroke={C.orange} strokeDasharray="4 3" label={{ value: `модель ${MODEL_SWITCHES.find(s => s.date.slice(5) === d).label}`, fill: C.orange, fontSize: 10, position: 'insideTopRight' }} />
  ))
  const legendStyle = { fontSize: 11, color: C.muted, paddingTop: 8 }

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 16px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, minHeight: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #f97316, #ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>₿</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>CRAFT Bot <span style={{ fontSize: 11, color: C.orange, ...mono, marginLeft: 6 }}>модель {firstSwitch.label}</span></div>
              <div style={{ fontSize: 11, color: C.muted }}>Crypto Recurrent Agent with FinBERT Trading</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: runAgeH != null && runAgeH < 30 ? C.green : C.yellow }} />
              <span style={{ fontSize: 12, color: runAgeH != null && runAgeH < 30 ? C.green : C.yellow }}>
                Binance Testnet · {runAgeH != null && runAgeH < 30 ? 'працює' : 'немає свіжого запуску'}
              </span>
            </div>
            {lastRun && (
              <span style={{ fontSize: 11, color: C.muted }}>
                останній запуск {lastRun.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', gap: 0, overflowX: 'auto' }}>
          {tabs.map(tabItem => (
            <button key={tabItem.id} onClick={() => setTab(tabItem.id)} style={{
              padding: '12px 18px', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: tab === tabItem.id ? `2px solid ${C.orange}` : '2px solid transparent',
              color: tab === tabItem.id ? C.orange : C.muted, fontSize: 13, fontWeight: 500,
            }}>{tabItem.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>

        {/* ОГЛЯД */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={grid(230)}>
              <KPICard label="Поточний портфель" value={usd(currentPortfolio, 2)}
                sub={`BTC: ${latest.btc?.toFixed(4)} · USDT: ${latest.usdt?.toFixed(0)}`} color={C.green} />
              <KPICard label="Дохідність бота (TWR)" value={pct(perf?.twr)}
                sub={`з ${fmtDate(perf?.start)} · без впливу поповнень і скидань testnet`}
                color={(perf?.twr || 0) >= 0 ? C.green : C.red}
                hint="Time-Weighted Return: ланцюгова дохідність, з якої виключено рух капіталу (таблиця «Угоди і капітал»)" />
              <KPICard label="Порівняно з BTC" value={`${(perf?.excess || 0) >= 0 ? '+' : ''}${(perf?.excess || 0).toFixed(1)} п.п.`}
                sub={`бот ${pct(perf?.twr)} · купити й тримати BTC ${pct(perf?.bh)}`} color={C.blue}
                hint="Різниця між TWR бота і дохідністю BTC за той самий період (від ціни закриття першого дня)" />
              <KPICard label="Результат у доларах" value={usd(perf?.pnl)}
                sub={`${pct(perf?.pnlPct)} до чистих внесків ${usd(perf?.netContrib)}`}
                color={(perf?.pnl || 0) >= 0 ? C.green : C.red}
                hint="Поточний портфель мінус сума всіх рухів капіталу (старт + поповнення − скидання testnet)" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              {/* Signal card */}
              <div style={cardStyle}>
                <div style={titleStyle}>Сигнал моделі {firstSwitch.label} · запуск {fmtDate(latest.date)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
                  <SignalBadge signal={latest.signal || 'HOLD'} size="lg" />
                  <div>
                    <div style={{ fontSize: 13, color: C.muted }}>Впевненість</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: (latest.confidence || 0) >= thr ? C.green : C.text, ...mono }}>
                      {((latest.confidence || 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: todayTrades.length ? C.green : C.text, background: C.bg, borderRadius: 8, padding: '10px 12px', marginBottom: 18 }}>
                  {action}
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Пороги угоди: BUY ≥ 70% (і RSI ≤ 60), SELL ≥ 50%</div>
                </div>
                {[
                  { label: 'BUY', value: latest.buy_prob || 0, color: C.green },
                  { label: 'HOLD', value: latest.hold_prob || 0, color: C.yellow },
                  { label: 'SELL', value: latest.sell_prob || 0, color: C.red },
                ].map(p => (
                  <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 36, fontSize: 11, color: p.color, fontWeight: 600, ...mono }}>{p.label}</div>
                    <div style={{ flex: 1, background: C.bg, borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${p.value * 100}%`, height: '100%', background: p.color, borderRadius: 4 }} />
                    </div>
                    <div style={{ width: 44, fontSize: 11, color: C.muted, textAlign: 'right', ...mono }}>{(p.value * 100).toFixed(1)}%</div>
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                  {[
                    { label: 'RSI', value: latest.rsi?.toFixed(1), hint: 'Relative Strength Index: >70 перекупленість, <30 перепроданість' },
                    { label: 'F&G', value: latest.fg, hint: 'Fear & Greed Index 0–100: <25 страх, >75 жадібність' },
                    { label: 'VIX', value: latest.vix?.toFixed(1), hint: 'Індекс волатильності ринку акцій США: <15 спокійно, >25 паніка' },
                    { label: 'Ціна', value: latest.price ? `${(latest.price / 1000).toFixed(1)}k` : '—', hint: 'Ціна BTC на момент запуску' },
                  ].map(ind => (
                    <div key={ind.label} title={ind.hint} style={{ textAlign: 'center', background: C.bg, borderRadius: 8, padding: '10px 6px', cursor: 'help' }}>
                      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{ind.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: C.text, ...mono }}>{ind.value ?? '—'}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Allocation */}
              <div style={cardStyle}>
                <div style={titleStyle}>Розподіл портфеля</div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <PieChart width={220} height={180}>
                    <Pie data={[{ name: 'BTC', value: (latest.btc || 0) * (latest.price || 0) }, { name: 'USDT', value: latest.usdt || 0 }]}
                      cx={110} cy={90} innerRadius={55} outerRadius={80} dataKey="value" stroke={C.card} strokeWidth={2}>
                      <Cell fill={C.orange} /><Cell fill={C.blue} />
                    </Pie>
                    <Tooltip formatter={v => usd(v, 2)} contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </div>
                {[
                  { label: 'BTC', color: C.orange, value: (latest.btc || 0) * (latest.price || 0) },
                  { label: 'USDT', color: C.blue, value: latest.usdt || 0 },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: item.color }} />
                      <span style={{ color: C.muted }}>{item.label}</span>
                    </div>
                    <div><span style={{ color: C.text, ...mono }}>{usd(item.value)}</span>
                      <span style={{ color: C.muted, marginLeft: 6, fontSize: 11 }}>{currentPortfolio ? (item.value / currentPortfolio * 100).toFixed(1) : 0}%</span></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Performance chart */}
            <div style={cardStyle}>
              <div style={titleStyle}>Дохідність бота проти BTC (індекс, старт = 100)</div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={perfChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: C.muted }} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={100} stroke={C.dim} />
                  {switchMarkers}
                  <Line isAnimationActive={false} type="linear" dataKey="craft" name="CRAFT (TWR)" stroke={C.green} strokeWidth={2} dot={false} />
                  <Line isAnimationActive={false} type="linear" dataKey="bh" name="Купити й тримати BTC" stroke={C.muted} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                  <Legend wrapperStyle={legendStyle} />
                </LineChart>
              </ResponsiveContainer>
              <Note>Поповнення і скидання балансу testnet виключено з дохідності (див. «Угоди і капітал»). Testnet — тестова біржа без реальних коштів.</Note>
            </div>
          </div>
        )}

        {/* СИГНАЛИ */}
        {tab === 'signals' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={cardStyle}>
              <div style={titleStyle}>Ймовірності сигналів моделі за днями</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={signalChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} minTickGap={24} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip content={<CustomTooltip unit="p" />} />
                  {signalChartData.length > 0 && <ReferenceArea x1={signalChartData[0].date} x2={switchDates[0]} fill={C.muted} fillOpacity={0.12} />}
                  <ReferenceLine y={0.7} stroke={C.red} strokeDasharray="4 4" label={{ value: 'поріг BUY 70%', fill: C.red, fontSize: 10, position: 'insideBottomLeft' }} />
                  {switchMarkers}
                  <Line isAnimationActive={false} type="linear" dataKey="buy" name="BUY" stroke={C.green} strokeWidth={1.5} dot={false} />
                  <Line isAnimationActive={false} type="linear" dataKey="hold" name="HOLD" stroke={C.yellow} strokeWidth={1.5} dot={false} />
                  <Line isAnimationActive={false} type="linear" dataKey="sell" name="SELL" stroke={C.red} strokeWidth={1.5} dot={false} />
                  <Legend wrapperStyle={legendStyle} />
                </LineChart>
              </ResponsiveContainer>
              <Note>Сіра зона — модель v3.2 (до {fmtDate(firstSwitch.date)}): її висока впевненість була завищена через витік майбутніх цін у вхідні ознаки. З {fmtDate(firstSwitch.date)} працює виправлена модель v4, тому ймовірності помірніші.</Note>
            </div>

            <div style={cardStyle}>
              <div style={titleStyle}>Сентимент новин BTC (FinBERT)</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={signalChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} minTickGap={24} />
                  <YAxis domain={[-0.5, 0.5]} tick={{ fontSize: 10, fill: C.muted }} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke={C.muted} strokeDasharray="2 2" />
                  <ReferenceLine y={-0.15} stroke={C.red} strokeDasharray="3 3" label={{ value: 'ведмежий поріг −0.15', fill: C.red, fontSize: 9, position: 'insideBottomRight' }} />
                  <Line isAnimationActive={false} type="linear" dataKey="mean" name="Середній сентимент дня" stroke={C.blue} strokeWidth={2} dot={false} connectNulls={false} />
                  <Line isAnimationActive={false} type="linear" dataKey="momentum" name="Імпульс (зміна за тиждень)" stroke={C.purple} strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls={false} />
                  <Legend wrapperStyle={legendStyle} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={cardStyle}>
              <div style={titleStyle}>Ціна BTC/USDT</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={signalChartData}>
                  <defs>
                    <linearGradient id="btcGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.orange} stopOpacity={0.3} /><stop offset="95%" stopColor={C.orange} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip unit="$" />} />
                  {switchMarkers}
                  <Area isAnimationActive={false} type="linear" dataKey="price" name="BTC" stroke={C.orange} fill="url(#btcGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, ...titleStyle, marginBottom: 0 }}>Останні 20 сигналів</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: C.bg }}>
                    {['Дата', 'Модель', 'Сигнал', 'Впевненість', 'SELL', 'HOLD', 'BUY', 'Ціна BTC', 'RSI', 'F&G'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600 }}>{h}</th>))}
                  </tr></thead>
                  <tbody>
                    {[...signals].reverse().slice(0, 20).map((s, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.muted, ...mono }}>{s.date}</td>
                        <td style={{ padding: '10px 14px', fontSize: 11, color: C.muted, ...mono }}>{s.date >= firstSwitch.date ? firstSwitch.label : 'v3.2'}</td>
                        <td style={{ padding: '10px 14px' }}><SignalBadge signal={s.signal} /></td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.text, ...mono }}>{((s.confidence || 0) * 100).toFixed(1)}%</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.muted, ...mono }}>{((s.sell_prob || 0) * 100).toFixed(1)}%</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.muted, ...mono }}>{((s.hold_prob || 0) * 100).toFixed(1)}%</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.muted, ...mono }}>{((s.buy_prob || 0) * 100).toFixed(1)}%</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.text, ...mono }}>{usd(s.price)}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.muted, ...mono }}>{s.rsi?.toFixed(1)}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: C.muted, ...mono }}>{s.fg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* УГОДИ І КАПІТАЛ */}
        {tab === 'trades' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={grid(200)}>
              <KPICard label="Торгових угод" value={realTrades.length} sub={`BUY ${realTrades.filter(t => t.type === 'BUY').length} · SELL ${realTrades.filter(t => t.type === 'SELL').length}`} />
              <KPICard label="Обсяг торгів" value={usd(realTrades.reduce((s, t) => s + (t.usdt_amount || 0), 0))} color={C.blue} sub="без поповнень і першого входу" />
              <KPICard label="Чисті внески" value={usd(perf?.netContrib)} color={C.muted} sub="старт + поповнення − скидання testnet" />
              <KPICard label="Остання угода" value={realTrades.length ? fmtDate(realTrades[realTrades.length - 1].date) : '—'} sub={realTrades.length ? `${realTrades[realTrades.length - 1].type} ${usd(realTrades[realTrades.length - 1].usdt_amount)}` : ''} />
            </div>

            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, ...titleStyle, marginBottom: 0 }}>Рух капіталу</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: C.bg }}>
                    {['Дата', 'Тип', 'Сума', 'Пояснення', 'Джерело'].map(h => (<th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600 }}>{h}</th>))}
                  </tr></thead>
                  <tbody>
                    {[...flows].reverse().map((f, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.muted, ...mono }}>{f.date}</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.text }}>{FLOW_LABEL[f.type] || f.type}</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.text, ...mono }}>{Number(f.amount_usdt) >= 0 ? '+' : ''}{usd(Number(f.amount_usdt), 2)}</td>
                        <td style={{ padding: '11px 16px', fontSize: 11, color: C.muted }}>{f.note}</td>
                        <td style={{ padding: '11px 16px', fontSize: 11, color: C.muted }}>{f.source === 'auto' ? 'автоматично' : 'вручну'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '0 20px 16px' }}><Note>Binance Testnet періодично скидає баланси до стандартних значень; такі дні фіксуються тут і виключаються з дохідності бота.</Note></div>
            </div>

            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, ...titleStyle, marginBottom: 0 }}>Торгові угоди ({realTrades.length})</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: C.bg }}>
                    {['Дата', 'Тип', 'BTC', 'Ціна', 'USDT', 'Примітка'].map(h => (<th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600 }}>{h}</th>))}
                  </tr></thead>
                  <tbody>
                    {[...realTrades].reverse().map((trade, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.muted, ...mono }}>{trade.date}</td>
                        <td style={{ padding: '11px 16px' }}><SignalBadge signal={trade.type} /></td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.text, ...mono }}>{trade.btc_amount?.toFixed(6)}</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.text, ...mono }}>{usd(trade.price, 1)}</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.text, ...mono }}>{trade.type === 'SELL' ? '+' : '−'}{usd(trade.usdt_amount, 2).replace('−', '')}</td>
                        <td style={{ padding: '11px 16px', fontSize: 11, color: C.muted }}>{trade.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* МОДЕЛІ */}
        {tab === 'models' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...cardStyle, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
              Поруч із бойовою моделлю щодня працюють моделі-спостерігачі. Вони отримують ті самі дані, але не торгують:
              для кожної ведеться віртуальний портфель з 1.0 від {fmtDate(ms.rows[0]?.start) || '08.10'}, з комісією 0.15% за кожну зміну позиції.
              На біржі торгує лише модель v4.
            </div>
            {ms.rows.length === 0 ? (
              <div style={{ ...cardStyle, color: C.muted, fontSize: 13 }}>Дані спостережень з'являться після першої нічної синхронізації.</div>
            ) : (<>
              {MODEL_GROUPS.map(gr => {
                const rows = ms.rows.filter(gr.pick)
                if (!rows.length) return null
                const names = rows.map(r => r.model)
                return (
                  <div key={gr.key} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ fontSize: 15, color: C.text, fontWeight: 600, marginTop: 8 }}>{gr.title}</div>
                    {gr.intro && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{gr.intro}</div>}
                    <div style={cardStyle}>
                      <div style={titleStyle}>Дохідність віртуальних портфелів, %</div>
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={ms.chart}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} />
                          <YAxis tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                          <Tooltip content={<CustomTooltip unit="%" />} />
                          <ReferenceLine y={0} stroke={C.dim} />
                          {names.map(n => (
                            <Line key={n} isAnimationActive={false} type="linear" dataKey={n} name={rows.find(r => r.model === n)?.title || n}
                              stroke={MODEL_COLORS[n] || C.purple} strokeWidth={n === 'v4_live' ? 2.5 : 1.5}
                              strokeDasharray={n === 'bh' ? '5 3' : undefined} dot={ms.chart.length < 30 ? { r: 2 } : false} />
                          ))}
                          <Legend wrapperStyle={legendStyle} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr style={{ background: C.bg }}>
                            {['Модель', 'Як працює', 'Дохідність', 'Макс. просадка', 'Частка BTC', 'Сигнал', 'Угод', 'Днів'].map(h => (
                              <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600 }}>{h}</th>))}
                          </tr></thead>
                          <tbody>
                            {rows.map(r => (
                              <tr key={r.model} style={{ borderTop: `1px solid ${C.border}` }}>
                                <td style={{ padding: '12px 14px', fontSize: 13, color: C.text, whiteSpace: 'nowrap' }}>
                                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: MODEL_COLORS[r.model] || C.purple, marginRight: 8 }} />{r.title}
                                </td>
                                <td style={{ padding: '12px 14px', fontSize: 11, color: C.muted, maxWidth: 360 }}>{r.description}</td>
                                <td style={{ padding: '12px 14px', fontSize: 12, color: C.text, ...mono }}>{pct(r.ret, 2)}</td>
                                <td style={{ padding: '12px 14px', fontSize: 12, color: C.muted, ...mono }}>{pct(r.maxDD, 2)}</td>
                                <td style={{ padding: '12px 14px', fontSize: 12, color: C.text, ...mono }}>{(r.position * 100).toFixed(0)}%</td>
                                <td style={{ padding: '12px 14px' }}><SignalBadge signal={r.signal} /></td>
                                <td style={{ padding: '12px 14px', fontSize: 12, color: C.muted, ...mono }}>{r.trades}</td>
                                <td style={{ padding: '12px 14px', fontSize: 12, color: C.muted, ...mono }}>{r.days}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )
              })}
              <Note>Короткий період спостережень не дозволяє робити висновків: різниця в кілька відсотків за тижні зазвичай статистично незначуща. Критерій вибору порогу визначено заздалегідь: коефіцієнт Шарпа і максимальна просадка порівняно з бойовою моделлю та «купити й тримати» за щонайменше 90 днів спостережень, з урахуванням того, що порівнюється кілька варіантів одночасно.</Note>
            </>)}
          </div>
        )}

        {/* ПРО СИСТЕМУ */}
        {tab === 'about' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={cardStyle}>
                <div style={titleStyle}>Модель v4.0 (з 08.10.2026)</div>
                {[
                  ['Архітектура', 'GRU + Residual + Attention'],
                  ['Вхідні ознаки', '17 цінових + 48 поведінкових'],
                  ['Поведінкові', 'F&G (4), сентимент (12), [CLS] (32)'],
                  ['Вікно', '20 днів'],
                  ['Ціль прогнозу', 'дохідність за 3 дні, поріг ±1.5%'],
                  ['Навчання', '10 монет, 14 361 зразок, 02.2021–10.2026'],
                  ['Поріг угоди', 'BUY ≥ 0.70 · SELL ≥ 0.50'],
                  ['Фільтр BUY', 'RSI > 60 → пропуск'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{k}</span><span style={{ color: C.text, ...mono, fontSize: 11, textAlign: 'right' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={cardStyle}>
                <div style={titleStyle}>Конфігурація</div>
                {[
                  ['Біржа', 'Binance Testnet SPOT (з 31.07; до того Bybit Testnet)'],
                  ['Символ', 'BTCUSDT'],
                  ['Розклад', 'щодня о 02:00 за Києвом'],
                  ['Виконання', 'адаптивний TWAP 1–3 дні'],
                  ['Сентимент', 'FinBERT, інкрементально'],
                  ['Ринкові дані', 'Fear & Greed, VIX, DXY'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{k}</span><span style={{ color: C.text, ...mono, fontSize: 11, textAlign: 'right' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={cardStyle}>
                <div style={titleStyle}>Перевірка на історії (walk-forward 01.2024–10.2026)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Варіант', 'IC', 'Long/flat', 'Sharpe'].map(h => (
                    <th key={h} style={{ padding: '6px 0', fontSize: 10, color: C.muted, textAlign: 'left', fontWeight: 600 }}>{h}</th>))}</tr></thead>
                  <tbody>
                    {[
                      ['GRU v4 (бойова)', '+0.020', '−0.3%', '0.22'],
                      ['GRU без ембедингів', '+0.052', '+34.9%', '0.47'],
                      ['Логістична регресія', '+0.035', '+14.2%', '0.32'],
                      ['Купити й тримати', '—', '−10.8%', '0.26'],
                    ].map(r => (
                      <tr key={r[0]} style={{ borderTop: `1px solid ${C.border}` }}>
                        {r.map((c, j) => <td key={j} style={{ padding: '8px 0', fontSize: 11, color: j ? C.text : C.muted, ...(j ? mono : {}) }}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Note>
                  Середнє по BTC, ETH, SOL, LINK, AVAX; модель перенавчається щокварталу лише на минулих даних; комісія 0.15%.
                  IC — кореляція прогнозу з фактичною 3-денною дохідністю. Жоден варіант не показав статистично значущої переваги.
                  Попередні результати (точність 73–82%, бектест +209%) були завищені: у вхідні ознаки моделі v3.2 потрапляли майбутні ціни; виявлено й виправлено 07.10.2026.
                </Note>
              </div>
              <div style={cardStyle}>
                <div style={titleStyle}>Архітектура системи</div>
                {[
                  ['A', 'Збір даних', 'ціни + Fear & Greed + VIX/DXY + новини', C.blue],
                  ['B', 'FinBERT NLP', 'сентимент + [CLS]-ембединги', C.purple],
                  ['C', 'CRAFTModel', 'GRU+Residual → BUY/HOLD/SELL', C.orange],
                  ['D', 'Розмір позиції', 'волатильність + впевненість', C.green],
                  ['E', 'Виконання', 'адаптивний TWAP + Binance API', '#06b6d4'],
                  ['F', 'Моніторинг', 'launchd + Supabase + моделі-спостерігачі', C.muted],
                ].map(([id, name, desc, color]) => (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: color + '20', border: `1px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color, fontWeight: 700, flexShrink: 0 }}>{id}</div>
                    <div><div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{name}</div><div style={{ fontSize: 11, color: C.muted }}>{desc}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: C.dim, paddingBottom: 24 }}>
          CRAFT Bot · модель {firstSwitch.label} · Binance Testnet · дані оновлюються щодня о 02:00 · не є фінансовою порадою
        </div>
      </div>
    </div>
  )
}
