'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ReferenceLine
} from 'recharts'

const COLORS = { BUY: '#10b981', SELL: '#ef4444', HOLD: '#f59e0b' }
const C = {
  bg: '#0a0e1a', card: '#111827', border: '#1f2937',
  green: '#10b981', red: '#ef4444', yellow: '#f59e0b',
  blue: '#3b82f6', purple: '#8b5cf6', orange: '#f97316',
  text: '#e2e8f0', muted: '#6b7280', dim: '#374151'
}

function KPICard({ label, value, sub, color, mono }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || C.text, fontFamily: mono ? 'JetBrains Mono' : 'Inter', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function SignalBadge({ signal, size = 'md' }) {
  const sz = size === 'lg' ? { fontSize: 22, padding: '8px 28px' } : { fontSize: 12, padding: '3px 12px' }
  return (
    <span style={{
      ...sz, fontWeight: 700, borderRadius: 6,
      background: (COLORS[signal] || C.muted) + '20',
      border: `1px solid ${COLORS[signal] || C.muted}`,
      color: COLORS[signal] || C.muted,
      fontFamily: 'JetBrains Mono',
      letterSpacing: '0.05em'
    }}>{signal}</span>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1f2937', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.text }}>
          {p.name}: {typeof p.value === 'number' && p.value > 1000
            ? `$${p.value.toLocaleString()}`
            : typeof p.value === 'number'
            ? p.value.toFixed(3)
            : p.value}
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [tab, setTab] = useState('overview')
  const [signals, setSignals] = useState([])
  const [trades, setTrades] = useState([])
  const [portfolio, setPortfolio] = useState([])
  const [loading, setLoading] = useState(true)
  const [sentiment, setSentiment] = useState([])
  const [lastUpdate, setLastUpdate] = useState(null)

  const fetchData = useCallback(async () => {
    const [s, t, p, sent] = await Promise.all([
      supabase.from('signals').select('*').order('date', { ascending: true }),
      supabase.from('trades').select('*').order('date', { ascending: true }),
      supabase.from('portfolio_history').select('*').order('date', { ascending: true }),
      supabase.from('sentiment_history').select('*').order('date', { ascending: true }),
    ])
    if (s.data) setSignals(s.data)
    if (t.data) setTrades(t.data)
    if (p.data) setPortfolio(p.data)
    if (sent.data) setSentiment(sent.data)
    setLastUpdate(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  const latest = signals[signals.length - 1] || {}
  const startPortfolio = 5000
  const topup = 37632
  const currentPortfolio = latest.portfolio || 0
  const realPnl = currentPortfolio - startPortfolio - topup
  const realPnlPct = (realPnl / (startPortfolio + topup)) * 100
  const bhPnl = ((latest.price || 0) - 77068) / 77068 * 100

  const chartData = portfolio.map(p => ({
    date: p.date?.slice(5),
    portfolio: p.portfolio,
    btc_price: p.btc_price,
  }))

  // Нормалізуємо дати для обох графіків
  const allDates = [...new Set([
    ...signals.map(s => s.date),
    ...sentiment.map(s => s.date)
  ])].sort()

  const signalChartData = allDates.map(date => {
    const s = signals.find(x => x.date === date) || {}
    const sent = sentiment.find(x => x.date === date) || {}
    return {
      date: date?.slice(5),
      confidence: s.confidence,
      sell: s.sell_prob,
      hold: s.hold_prob,
      buy: s.buy_prob,
      signal: s.signal,
      price: s.price,
      mean: sent.sentiment_mean,
      momentum: sent.sentiment_momentum,
      bear: sent.bear_signal,
      bullish: sent.bullish_ratio,
    }
  })

  const tabs = [
    { id: 'overview', label: 'Огляд' },
    { id: 'signals', label: 'Сигнали' },
    { id: 'trades', label: 'Угоди' },
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

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'linear-gradient(135deg, #f97316, #ef4444)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700
            }}>₿</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>CRAFT Bot</div>
              <div style={{ fontSize: 11, color: C.muted }}>Crypto Recurrent Agent with FinBERT Trading</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
              <span style={{ fontSize: 12, color: C.green }}>Testnet Live</span>
            </div>
            {lastUpdate && (
              <span style={{ fontSize: 11, color: C.muted }}>
                оновлено {lastUpdate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', gap: 0 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: tab === t.id ? `2px solid ${C.orange}` : '2px solid transparent',
              color: tab === t.id ? C.orange : C.muted,
              fontSize: 13, fontWeight: 500, transition: 'all 0.15s'
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px' }}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <KPICard
                label="Поточний портфель"
                value={`$${currentPortfolio.toLocaleString()}`}
                sub={`BTC: ${latest.btc?.toFixed(4)} | USDT: ${latest.usdt?.toFixed(0)}`}
                color={C.green} mono
              />
              <KPICard
                label="Реальний P&L"
                value={`${realPnl >= 0 ? '+' : ''}$${realPnl.toFixed(0)}`}
                sub={`${realPnlPct >= 0 ? '+' : ''}${realPnlPct.toFixed(1)}% від вкладених коштів`}
                color={realPnl >= 0 ? C.green : C.red} mono
              />
              <KPICard
                label="CRAFT vs Buy & Hold"
                value={`+${(realPnlPct - bhPnl).toFixed(1)}%`}
                sub={`B&H за період: ${bhPnl.toFixed(1)}%`}
                color={C.blue} mono
              />
              <KPICard
                label="Ціна BTC"
                value={`$${(latest.price || 0).toLocaleString()}`}
                sub={`RSI ${latest.rsi?.toFixed(1)} | VIX ${latest.vix?.toFixed(1)}`}
                color={C.orange} mono
              />
            </div>

            {/* Signal + Allocation */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12 }}>
              {/* Signal card */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                  Поточний сигнал моделі
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
                  <SignalBadge signal={latest.signal || 'BUY'} size="lg" />
                  <div>
                    <div style={{ fontSize: 13, color: C.muted }}>Confidence</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: (latest.confidence || 0) >= 0.7 ? C.green : C.yellow, fontFamily: 'JetBrains Mono' }}>
                      {((latest.confidence || 0) * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      {(latest.confidence || 0) < 0.7 ? '⚠ нижче порогу 0.70' : '✓ активний сигнал'}
                    </div>
                  </div>
                </div>

                {/* Probability bars */}
                {[
                  { label: 'BUY', value: latest.buy_prob || 0, color: C.green },
                  { label: 'HOLD', value: latest.hold_prob || 0, color: C.yellow },
                  { label: 'SELL', value: latest.sell_prob || 0, color: C.red },
                ].map(p => (
                  <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 36, fontSize: 11, color: p.color, fontWeight: 600, fontFamily: 'JetBrains Mono' }}>{p.label}</div>
                    <div style={{ flex: 1, background: C.bg, borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${p.value * 100}%`, height: '100%', background: p.color, borderRadius: 4, transition: 'width 0.5s ease' }} />
                    </div>
                    <div style={{ width: 44, fontSize: 11, color: C.muted, textAlign: 'right', fontFamily: 'JetBrains Mono' }}>
                      {(p.value * 100).toFixed(1)}%
                    </div>
                  </div>
                ))}

                {/* Market indicators */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
                  {[
                    { label: 'RSI', value: latest.rsi?.toFixed(1), color: (latest.rsi || 0) > 70 ? C.red : (latest.rsi || 0) < 30 ? C.green : C.muted },
                    { label: 'F&G', value: latest.fg, color: (latest.fg || 0) < 25 ? C.red : (latest.fg || 0) > 60 ? C.green : C.muted },
                    { label: 'VIX', value: latest.vix?.toFixed(1), color: (latest.vix || 0) > 25 ? C.red : (latest.vix || 0) > 20 ? C.yellow : C.muted },
                    { label: 'Sent', value: (latest.sent_mom || 0) >= 0 ? `+${latest.sent_mom?.toFixed(3)}` : latest.sent_mom?.toFixed(3), color: (latest.sent_mom || 0) >= 0 ? C.green : C.red },
                  ].map(ind => (
                    <div key={ind.label} style={{ textAlign: 'center', background: C.bg, borderRadius: 8, padding: '10px 6px' }}>
                      <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{ind.label}</div>
                      <div style={{ fontSize: 17, fontWeight: 600, color: ind.color, fontFamily: 'JetBrains Mono' }}>{ind.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Portfolio allocation */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                  Розподіл портфелю
                </div>
                <PieChart width={220} height={180} style={{ margin: '0 auto' }}>
                  <Pie
                    data={[
                      { name: 'BTC', value: (latest.btc || 0) * (latest.price || 0) },
                      { name: 'USDT', value: latest.usdt || 0 },
                    ]}
                    cx={110} cy={90} innerRadius={55} outerRadius={80} dataKey="value"
                    strokeWidth={0}
                  >
                    <Cell fill={C.orange} />
                    <Cell fill={C.blue} />
                  </Pie>
                  <Tooltip formatter={v => `$${v.toLocaleString()}`} contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                </PieChart>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  {[
                    { label: 'BTC', color: C.orange, value: ((latest.btc || 0) * (latest.price || 0)), pct: ((latest.btc || 0) * (latest.price || 0)) / currentPortfolio * 100 },
                    { label: 'USDT', color: C.blue, value: latest.usdt || 0, pct: (latest.usdt || 0) / currentPortfolio * 100 },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: item.color }} />
                        <span style={{ color: C.muted }}>{item.label}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ color: C.text, fontFamily: 'JetBrains Mono' }}>${item.value.toLocaleString()}</span>
                        <span style={{ color: C.muted, marginLeft: 6, fontSize: 11 }}>{item.pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Equity chart */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                Динаміка портфелю (26.05 → сьогодні)
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.green} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} />
                  <YAxis tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={42632} stroke={C.yellow} strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'Поповнення', fill: C.yellow, fontSize: 10 }} />
                  <Area type="monotone" dataKey="portfolio" name="Портфель" stroke={C.green} fill="url(#portGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* SIGNALS */}
        {tab === 'signals' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Confidence chart */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                Probability домінуючого сигналу (BUY/HOLD/SELL) в часі
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={signalChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `${(v*100).toFixed(0)}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0.7} stroke={C.red} strokeDasharray="4 4" label={{ value: 'Поріг 0.70', fill: C.red, fontSize: 10 }} />
                  <Line type="monotone" dataKey="confidence" name="Confidence" stroke={C.purple} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="sell" name="SELL" stroke={C.red} strokeWidth={1} dot={false} strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="buy" name="BUY" stroke={C.green} strokeWidth={1} dot={false} strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Sentiment chart */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                Sentiment новин BTCUSDT (FinBERT аналіз)
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={signalChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} />
                  <YAxis domain={[-0.5, 0.5]} tick={{ fontSize: 10, fill: C.muted }} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke={C.muted} strokeDasharray="2 2" />
                  <ReferenceLine y={-0.15} stroke={C.red} strokeDasharray="3 3" label={{ value: 'Bear -0.15', fill: C.red, fontSize: 9 }} />
                  <Line type="monotone" dataKey="mean" name="Sentiment Mean" stroke={C.blue} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="momentum" name="Momentum" stroke={C.purple} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Bear signal + Bullish ratio */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                Bear Signal та Bullish Ratio
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={signalChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.dim} strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.muted }} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `${(v*100).toFixed(0)}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="bullish" name="Bullish Ratio" stroke={C.green} fill={C.green} fillOpacity={0.2} strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="bear" name="Bear Signal" stroke={C.red} fill={C.red} fillOpacity={0.3} strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
                <div style={{ fontSize: 11, color: C.green }}>● Bullish Ratio (частка позитивних)</div>
                <div style={{ fontSize: 11, color: C.red }}>● Bear Signal (sentiment &lt; -0.15)</div>
              </div>
            </div>

            {/* Signal distribution */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { label: 'BUY сигналів', count: signals.filter(s => s.signal === 'BUY').length, color: C.green },
                { label: 'HOLD сигналів', count: signals.filter(s => s.signal === 'HOLD').length, color: C.yellow },
                { label: 'SELL сигналів', count: signals.filter(s => s.signal === 'SELL').length, color: C.red },
              ].map(s => (
                <div key={s.label} style={{ background: C.card, border: `1px solid ${s.color}30`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{s.label}</div>
                  <div style={{ fontSize: 40, fontWeight: 700, color: s.color, fontFamily: 'JetBrains Mono' }}>{s.count}</div>
                </div>
              ))}
            </div>

            {/* Signal table */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Останні 20 сигналів
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: C.bg }}>
                      {['Дата', 'Сигнал', 'Confidence', 'SELL', 'HOLD', 'BUY', 'Ціна BTC', 'RSI', 'F&G'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...signals].reverse().slice(0, 20).map((s, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.muted, fontFamily: 'JetBrains Mono' }}>{s.date}</td>
                        <td style={{ padding: '11px 16px' }}><SignalBadge signal={s.signal} /></td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: (s.confidence || 0) >= 0.7 ? C.green : C.yellow, fontFamily: 'JetBrains Mono' }}>
                          {((s.confidence || 0) * 100).toFixed(1)}%
                        </td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.red, fontFamily: 'JetBrains Mono' }}>{((s.sell_prob || 0) * 100).toFixed(1)}%</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.yellow, fontFamily: 'JetBrains Mono' }}>{((s.hold_prob || 0) * 100).toFixed(1)}%</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.green, fontFamily: 'JetBrains Mono' }}>{((s.buy_prob || 0) * 100).toFixed(1)}%</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.text, fontFamily: 'JetBrains Mono' }}>${(s.price || 0).toLocaleString()}</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: (s.rsi || 0) > 70 ? C.red : (s.rsi || 0) < 30 ? C.green : C.muted, fontFamily: 'JetBrains Mono' }}>{s.rsi?.toFixed(1)}</td>
                        <td style={{ padding: '11px 16px', fontSize: 12, color: C.muted, fontFamily: 'JetBrains Mono' }}>{s.fg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TRADES */}
        {tab === 'trades' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Trade stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <KPICard label="Всього угод" value={trades.length} color={C.text} mono />
              <KPICard label="BUY угод" value={trades.filter(t => t.type === 'BUY').length} color={C.green} mono />
              <KPICard label="SELL угод" value={trades.filter(t => t.type === 'SELL').length} color={C.red} mono />
              <KPICard
                label="Обсяг торгів"
                value={`$${trades.reduce((s, t) => s + (t.usdt_amount || 0), 0).toLocaleString()}`}
                color={C.blue} mono
              />
            </div>

            {/* Trades table */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Історія угод ({trades.length})
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    {['Дата', 'Тип', 'BTC', 'Ціна', 'USDT', 'Примітка'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...trades].reverse().map((t, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: C.muted, fontFamily: 'JetBrains Mono' }}>{t.date}</td>
                      <td style={{ padding: '12px 16px' }}><SignalBadge signal={t.type} /></td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: C.text, fontFamily: 'JetBrains Mono' }}>{t.btc_amount?.toFixed(6)}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: C.text, fontFamily: 'JetBrains Mono' }}>${(t.price || 0).toLocaleString()}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, fontFamily: 'JetBrains Mono', color: t.type === 'SELL' ? C.green : C.red }}>
                        {t.type === 'SELL' ? '+' : '-'}${(t.usdt_amount || 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 11, color: C.muted }}>{t.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ABOUT */}
        {tab === 'about' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Параметри моделі</div>
                {[
                  ['Назва', 'CRAFT (GRU+Residual)'],
                  ['Архітектура', 'CRAFTModel beh_dim=65'],
                  ['Val accuracy', '71.1%'],
                  ['SELL precision', '79%'],
                  ['Coverage ≥0.7', '70.1%'],
                  ['Навчальний датасет', '14,805 зразків, 10 символів'],
                  ['Датасет новин', '120,709 статей (2013-2026)'],
                  ['Нові ознаки', 'sentiment_negative_ratio, bear_signal'],
                  ['Horizon', '3 дні + drawdown override 14d'],
                  ['Поріг confidence', '0.70'],
                  ['RSI фільтр BUY', 'RSI > 60 → пропуск'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{k}</span>
                    <span style={{ color: C.text, fontFamily: 'JetBrains Mono', fontSize: 11 }}>{v}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Конфігурація</div>
                {[
                  ['Біржа', 'Bybit Testnet SPOT'],
                  ['Символ', 'BTCUSDT'],
                  ['Пайплайн', 'Щодня о 02:00 (launchd)'],
                  ['TWAP', 'Адаптивний 1-3 дні'],
                  ['Sentiment', 'FinBERT інкрементальний'],
                  ['Macro', 'yfinance автооновлення'],
                  ['F&G', 'alternative.me автооновлення'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{k}</span>
                    <span style={{ color: C.text, fontFamily: 'JetBrains Mono', fontSize: 11 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Архітектура системи (6 рівнів)</div>
                {[
                  ['A', 'Збір даних', 'OHLCV + F&G + Macro + News', C.blue],
                  ['B', 'FinBERT NLP', 'Sentiment + [CLS] embeddings', C.purple],
                  ['C', 'CRAFTModel', 'GRU+Residual → BUY/HOLD/SELL', C.orange],
                  ['D', 'Розмір позиції', 'Vol-based sizing + confidence', C.green],
                  ['E', 'Виконання', 'Adaptive TWAP + Bybit API V5', '#06b6d4'],
                  ['F', 'Моніторинг', 'launchd + state + Supabase push', C.muted],
                ].map(([id, name, desc, color]) => (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: color + '20', border: `1px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color, fontWeight: 700, flexShrink: 0 }}>{id}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{name}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Out-of-sample backtest (2025-12 → 2026-06)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Символ', 'CRAFT', 'B&H', 'Перевага'].map(h => (
                        <th key={h} style={{ padding: '6px 0', fontSize: 10, color: C.muted, textAlign: 'left', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['BTCUSDT', '+146.9%', '-12.1%', '+159.1%'],
                      ['ETHUSDT', '+252.5%', '-25.8%', '+278.3%'],
                      ['SOLUSDT', '+198.3%', '-33.0%', '+231.3%'],
                      ['LINKUSDT', '+241.9%', '-22.3%', '+264.1%'],
                      ['AVAXUSDT', '+206.5%', '-27.4%', '+233.9%'],
                    ].map(([sym, craft, bh, adv]) => (
                      <tr key={sym} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 0', fontSize: 11, color: C.muted, fontFamily: 'JetBrains Mono' }}>{sym}</td>
                        <td style={{ padding: '8px 0', fontSize: 11, color: C.green, fontFamily: 'JetBrains Mono' }}>{craft}</td>
                        <td style={{ padding: '8px 0', fontSize: 11, color: C.red, fontFamily: 'JetBrains Mono' }}>{bh}</td>
                        <td style={{ padding: '8px 0', fontSize: 11, color: C.blue, fontFamily: 'JetBrains Mono' }}>{adv}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '10px 0', fontSize: 12, color: C.text, fontWeight: 600 }}>Середнє</td>
                      <td style={{ padding: '10px 0', fontSize: 12, color: C.green, fontWeight: 600, fontFamily: 'JetBrains Mono' }}>+209.2%</td>
                      <td style={{ padding: '10px 0', fontSize: 12, color: C.red, fontWeight: 600, fontFamily: 'JetBrains Mono' }}>-24.1%</td>
                      <td style={{ padding: '10px 0', fontSize: 12, color: C.blue, fontWeight: 600, fontFamily: 'JetBrains Mono' }}>+233.3%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: C.dim, paddingBottom: 24 }}>
          CRAFT Bot v3.2 · Bybit Testnet · Дані оновлюються щодня о 02:00 · Не є фінансовою порадою
        </div>
      </div>
    </div>
  )
}
