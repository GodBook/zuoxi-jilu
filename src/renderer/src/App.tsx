import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArchiveRestore, BarChart3, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Clock3, Download, FileArchive, Moon, Plus, RotateCcw, Settings, Sun, Trash2, Utensils, X
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnalysisResult, AppSettings, CalendarDay, DateRange, DayData, MealRecord, MealType, SleepRecord, ThemeMode, TrashItem } from '../../shared/类型'
import { formatClock, formatMinutes, sleepDurationMinutes, timeMinutes, validateSleep } from '../../shared/核心'
import { defaultOffset, defaultRecordId } from '../../shared/默认值'

type Page = 'today' | 'history' | 'analysis' | 'trash' | 'settings'
type ToastState = { message: string; action?: () => Promise<void>; actionLabel?: string }
const localDateString = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const today = () => localDateString(new Date())
const dateTimeFor = (date: string, hour: number, minute = 0) => `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
const formatDate = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T00:00:00`))
const dateRange = (days: number): DateRange => { const end = today(); const startDate = new Date(`${end}T00:00:00`); startDate.setDate(startDate.getDate() - days + 1); return { start: localDateString(startDate), end } }

function App() {
  const [page, setPage] = useState<Page>('today')
  const [selectedDate, setSelectedDate] = useState(today())
  const [day, setDay] = useState<DayData | null>(null)
  const [settings, setSettings] = useState<AppSettings>({ theme: 'system' })
  const [toast, setToast] = useState<ToastState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const notify = useCallback((message: string, action?: () => Promise<void>, actionLabel = '撤销') => { setToast({ message, action, actionLabel }); window.setTimeout(() => setToast(null), 8000) }, [])
  const loadDay = useCallback(async (date = selectedDate) => {
    setLoading(true)
    try { setDay(await window.作息记录.getDay(date)); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '读取记录失败') } finally { setLoading(false) }
  }, [selectedDate])

  useEffect(() => { void Promise.all([loadDay(), window.作息记录.getSettings().then(setSettings)]); }, [loadDay])
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme])
  useEffect(() => { if (page === 'today') void loadDay() }, [page, loadDay])

  const navigateDay = (delta: number) => { const next = new Date(`${selectedDate}T00:00:00`); next.setDate(next.getDate() + delta); setSelectedDate(localDateString(next)) }
  const goToDay = (date: string) => { setSelectedDate(date); setPage('today') }
  const updateTheme = async (theme: ThemeMode) => { try { setSettings(await window.作息记录.setTheme(theme)); notify('主题已更新') } catch { notify('主题保存失败') } }
  const refresh = useCallback(async () => { await loadDay() }, [loadDay])

  return <div className="app-shell">
    <aside className="sidebar" aria-label="主导航">
      <div className="brand-mark"><span className="brand-sun" aria-hidden="true" /><div><strong>作息记录</strong><small>看见自己的节律</small></div></div>
      <nav className="main-nav">
        <NavButton active={page === 'today'} icon={<Clock3 size={17} />} label="今日记录" onClick={() => setPage('today')} />
        <NavButton active={page === 'history'} icon={<CalendarDays size={17} />} label="历史日历" onClick={() => setPage('history')} />
        <NavButton active={page === 'analysis'} icon={<BarChart3 size={17} />} label="规律分析" onClick={() => setPage('analysis')} />
        <NavButton active={page === 'trash'} icon={<Trash2 size={17} />} label="回收站" onClick={() => setPage('trash')} />
      </nav>
      <div className="sidebar-bottom">
        <NavButton active={page === 'settings'} icon={<Settings size={17} />} label="设置与备份" onClick={() => setPage('settings')} />
        <div className="offline-status"><span className="status-dot" />仅保存在这台电脑</div>
      </div>
    </aside>
    <main className="main-content" id="main-content">
      {error && <div className="error-banner" role="alert"><CircleHelp size={17} />{error}<button className="icon-button" aria-label="关闭错误" onClick={() => setError(null)}><X size={16} /></button></div>}
      {page === 'today' && <TodayPage day={day} date={selectedDate} loading={loading} onDateChange={setSelectedDate} onNavigate={navigateDay} onReload={refresh} onNotify={notify} />}
      {page === 'history' && <HistoryPage selectedDate={selectedDate} onSelect={goToDay} />}
      {page === 'analysis' && <AnalysisPage onNotify={notify} />}
      {page === 'trash' && <TrashPage onNotify={notify} />}
      {page === 'settings' && <SettingsPage settings={settings} onTheme={updateTheme} onNotify={notify} />}
    </main>
    {toast && <div className="toast" role="status"><span>{toast.message}</span>{toast.action && <button className="toast-action" onClick={async () => { await toast.action?.(); setToast(null) }}>{toast.actionLabel}</button>}</div>}
  </div>
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{label}</span></button>
}

function TodayPage({ day, date, loading, onDateChange, onNavigate, onReload, onNotify }: { day: DayData | null; date: string; loading: boolean; onDateChange: (date: string) => void; onNavigate: (delta: number) => void; onReload: () => Promise<void>; onNotify: (message: string, action?: () => Promise<void>) => void }) {
  const sleeps = day?.sleeps ?? []
  const meals = day?.meals ?? []
  const [newSleep, setNewSleep] = useState(false)
  const [newMeal, setNewMeal] = useState(false)
  const saveSleep = useCallback(async (record: SleepRecord) => { try { await window.作息记录.upsertSleep(record); await onReload(); onNotify('睡眠已保存') } catch (err) { onNotify(err instanceof Error ? err.message : '睡眠保存失败') } }, [onNotify, onReload])
  const saveMeal = useCallback(async (record: MealRecord) => { try { await window.作息记录.upsertMeal(record); await onReload(); onNotify('饮食已保存') } catch (err) { onNotify(err instanceof Error ? err.message : '饮食保存失败') } }, [onNotify, onReload])
  const remove = useCallback(async (type: 'sleep' | 'meal', id: string) => { try { await window.作息记录.deleteRecord(type, id); await onReload(); onNotify('已移入回收站', async () => { await window.作息记录.restoreRecord(type, id); await onReload(); onNotify('记录已恢复') }) } catch { onNotify('删除失败') } }, [onNotify, onReload])
  return <div className="page page-today">
    <header className="page-header">
      <div><p className="eyebrow">今天，先从看见开始</p><h1>{formatDate(date)}</h1><p className="muted">记录睡眠、吃饭，以及它们之间的节奏。</p></div>
      <div className="date-controls"><button className="icon-button" aria-label="前一天" onClick={() => onNavigate(-1)}><ChevronLeft size={19} /></button><input aria-label="选择日期" type="date" value={date} onChange={(event) => onDateChange(event.target.value)} /><button className="icon-button" aria-label="后一天" onClick={() => onNavigate(1)}><ChevronRight size={19} /></button></div>
    </header>
    {loading && <div className="loading-line">正在读取这一天的记录…</div>}
    <RhythmRail date={date} sleeps={sleeps} meals={meals} />
    <section className="record-grid" aria-label="每日记录">
      <section className="section-block"><div className="section-heading"><div><span className="section-kicker">01 / 睡眠</span><h2>睡眠段</h2></div><button className="text-button" onClick={() => setNewSleep(true)}><Plus size={16} />添加睡眠</button></div>
        <div className="entry-list">
          {sleeps.map((record) => <SleepEditor key={record.id} record={record} all={sleeps} onSave={saveSleep} onDelete={() => remove('sleep', record.id)} />)}
          {newSleep && <NewSleepEditor date={date} all={sleeps} onSave={async (record) => { setNewSleep(false); await saveSleep(record) }} onCancel={() => setNewSleep(false)} />}
          {!sleeps.length && !newSleep && <EmptySection icon={<Moon size={23} />} title="还没有睡眠记录" copy="把入睡和起床时间放在这里，节律会慢慢显形。" action="添加第一段" onClick={() => setNewSleep(true)} />}
        </div>
      </section>
      <section className="section-block"><div className="section-heading"><div><span className="section-kicker">02 / 饮食</span><h2>用餐记录</h2></div><button className="text-button" onClick={() => setNewMeal(true)}><Plus size={16} />添加一餐</button></div>
        <div className="entry-list">
          {meals.map((record) => <MealEditor key={record.id} record={record} suggestions={day?.foodSuggestions ?? []} onSave={saveMeal} onDelete={() => remove('meal', record.id)} />)}
          {newMeal && <NewMealEditor date={date} suggestions={day?.foodSuggestions ?? []} onSave={async (record) => { setNewMeal(false); await saveMeal(record) }} onCancel={() => setNewMeal(false)} />}
          {!meals.length && !newMeal && <EmptySection icon={<Utensils size={23} />} title="今天还没有用餐记录" copy="不需要记得很完整，先留下你愿意记录的一餐。" action="添加第一餐" onClick={() => setNewMeal(true)} />}
        </div>
      </section>
    </section>
  </div>
}

function RhythmRail({ date, sleeps, meals }: { date: string; sleeps: SleepRecord[]; meals: MealRecord[] }) {
  const segments: { left: number; width: number; kind: string; label: string }[] = []
  const points: { left: number; label: string }[] = []
  for (const sleep of sleeps) {
    const start = timeMinutes(sleep.startAt) / 1440
    const end = timeMinutes(sleep.endAt) / 1440
    const width = end >= start ? end - start : 1 - start + end
    segments.push({ left: start * 100, width: width * 100, kind: sleep.kind, label: sleep.kind === 'main' ? '主睡眠' : '小睡' })
    if (end < start) segments.push({ left: 0, width: end * 100, kind: sleep.kind, label: sleep.kind === 'main' ? '主睡眠' : '小睡' })
  }
  meals.forEach((meal) => points.push({ left: (timeMinutes(meal.eatenAt) / 1440) * 100, label: meal.foods.join('、') }))
  return <section className="rhythm-rail" aria-label="24 小时节律时间轨"><div className="rail-header"><span>24 小时节律</span><span className="rail-caption">睡眠区段与用餐时刻</span></div><div className="rail-track"><div className="rail-line" />{segments.map((segment, index) => <div key={`${segment.label}-${index}`} className={`sleep-segment ${segment.kind}`} title={segment.label} style={{ left: `${segment.left}%`, width: `${segment.width}%` }} />)}{points.map((point, index) => <div key={`${point.label}-${index}`} className="meal-point" title={point.label} style={{ left: `${point.left}%` }} />)}</div><div className="rail-labels"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></section>
}

function EmptySection({ icon, title, copy, action, onClick }: { icon: ReactNode; title: string; copy: string; action: string; onClick: () => void }) { return <div className="empty-section"><div className="empty-icon">{icon}</div><div><h3>{title}</h3><p>{copy}</p><button className="outline-button" onClick={onClick}><Plus size={15} />{action}</button></div></div> }

function SleepEditor({ record, all, onSave, onDelete }: { record: SleepRecord; all: SleepRecord[]; onSave: (record: SleepRecord) => Promise<void>; onDelete: () => Promise<void> }) {
  const [draft, setDraft] = useState(record)
  const [status, setStatus] = useState('')
  const first = useRef(true)
  useEffect(() => { setDraft(record) }, [record])
  useEffect(() => { if (first.current) { first.current = false; return } if (draft.startAt === record.startAt && draft.endAt === record.endAt && draft.startOffset === record.startOffset && draft.endOffset === record.endOffset && draft.kind === record.kind) return; const timer = window.setTimeout(async () => { const message = validateSleep(draft, all); if (message) { setStatus(message); return } setStatus('保存中'); await onSave(draft); setStatus('已保存') }, 600); return () => window.clearTimeout(timer) }, [draft, record, all, onSave])
  return <article className="entry-row"><div className={`entry-marker ${record.kind}`} /><div className="entry-main"><div className="entry-title"><select aria-label="睡眠类型" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as 'main' | 'nap' })}><option value="main">主睡眠</option><option value="nap">小睡</option></select><span className="duration-chip">{formatMinutes(sleepDurationMinutes(draft))}</span></div><div className="field-row"><label>入睡<input type="datetime-local" value={draft.startAt} onChange={(event) => setDraft({ ...draft, startAt: event.target.value })} /></label><label>起床<input type="datetime-local" value={draft.endAt} onChange={(event) => setDraft({ ...draft, endAt: event.target.value })} /></label></div>{status && <span className={`save-status ${status === '已保存' ? 'ok' : status.includes('保存中') ? 'saving' : 'invalid'}`}>{status}</span>}</div><button className="icon-button danger-hover" aria-label="删除睡眠记录" onClick={() => void onDelete()}><Trash2 size={16} /></button></article>
}

function NewSleepEditor({ date, all, onSave, onCancel }: { date: string; all: SleepRecord[]; onSave: (record: SleepRecord) => Promise<void>; onCancel: () => void }) {
  const previousDate = useMemo(() => { const value = new Date(`${date}T00:00:00`); value.setDate(value.getDate() - 1); return localDateString(value) }, [date])
  const [kind, setKind] = useState<'main' | 'nap'>('main'); const [startAt, setStartAt] = useState(dateTimeFor(previousDate, 23)); const [endAt, setEndAt] = useState(dateTimeFor(date, 7)); const [message, setMessage] = useState('')
  const save = async () => { const record = { id: defaultRecordId(), startAt, endAt, startOffset: defaultOffset(), endOffset: defaultOffset(), kind }; const error = validateSleep(record, all); if (error) { setMessage(error); return } await onSave(record as SleepRecord) }
  return <article className="entry-row draft-row"><div className="entry-marker draft" /><div className="entry-main"><div className="entry-title"><select aria-label="新睡眠类型" value={kind} onChange={(event) => setKind(event.target.value as 'main' | 'nap')}><option value="main">主睡眠</option><option value="nap">小睡</option></select><span className="muted">填写后自动保存</span></div><div className="field-row"><label>入睡<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label><label>起床<input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} /></label></div>{message && <span className="save-status invalid">{message}</span>}<div className="draft-actions"><button className="solid-button" onClick={() => void save()}>保存这段</button><button className="quiet-button" onClick={onCancel}>放弃</button></div></div></article>
}

function MealEditor({ record, suggestions, onSave, onDelete }: { record: MealRecord; suggestions: string[]; onSave: (record: MealRecord) => Promise<void>; onDelete: () => Promise<void> }) {
  const [draft, setDraft] = useState(record); const [foodText, setFoodText] = useState(''); const [status, setStatus] = useState(''); const first = useRef(true)
  useEffect(() => { setDraft(record) }, [record])
  useEffect(() => { if (first.current) { first.current = false; return } if (draft.eatenAt === record.eatenAt && draft.offset === record.offset && draft.mealType === record.mealType && draft.foods.join('\u001f') === record.foods.join('\u001f')) return; const timer = window.setTimeout(async () => { if (!draft.foods.length) { setStatus('至少填写一种食物'); return } setStatus('保存中'); await onSave(draft); setStatus('已保存') }, 600); return () => window.clearTimeout(timer) }, [draft, record, onSave])
  const addFood = () => { const value = foodText.trim(); if (!value) return; if (!draft.foods.some((food) => food.toLocaleLowerCase() === value.toLocaleLowerCase())) setDraft({ ...draft, foods: [...draft.foods, value] }); setFoodText('') }
  return <article className="entry-row"><div className="entry-marker meal" /><div className="entry-main"><div className="entry-title"><select aria-label="餐别" value={draft.mealType} onChange={(event) => setDraft({ ...draft, mealType: event.target.value as MealType })}><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option><option value="snack">加餐</option><option value="other">其他</option></select><input className="meal-time" aria-label="用餐时间" type="datetime-local" value={draft.eatenAt} onChange={(event) => setDraft({ ...draft, eatenAt: event.target.value })} /></div><div className="food-input"><div className="food-chips">{draft.foods.map((food) => <span className="food-chip" key={food}>{food}<button aria-label={`移除${food}`} onClick={() => setDraft({ ...draft, foods: draft.foods.filter((item) => item !== food) })}><X size={12} /></button></span>)}</div><input list="food-suggestions" value={foodText} placeholder="输入食物后按回车" onChange={(event) => setFoodText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFood() } }} onBlur={addFood} /><datalist id="food-suggestions">{suggestions.map((item) => <option key={item} value={item} />)}</datalist></div>{status && <span className={`save-status ${status === '已保存' ? 'ok' : status === '保存中' ? 'saving' : 'invalid'}`}>{status}</span>}</div><button className="icon-button danger-hover" aria-label="删除饮食记录" onClick={() => void onDelete()}><Trash2 size={16} /></button></article>
}

function NewMealEditor({ date, suggestions, onSave, onCancel }: { date: string; suggestions: string[]; onSave: (record: MealRecord) => Promise<void>; onCancel: () => void }) {
  const [mealType, setMealType] = useState<MealType>('breakfast'); const [eatenAt, setEatenAt] = useState(dateTimeFor(date, 8)); const [foods, setFoods] = useState<string[]>([]); const [foodText, setFoodText] = useState(''); const [message, setMessage] = useState('')
  const addFood = () => { const value = foodText.trim(); if (value && !foods.includes(value)) setFoods([...foods, value]); setFoodText('') }
  const save = async () => { addFood(); if (!foods.length && !foodText.trim()) { setMessage('至少填写一种食物'); return } await onSave({ id: defaultRecordId(), eatenAt, offset: defaultOffset(), recordDate: date, mealType, foods: foodText.trim() ? [...foods, foodText.trim()] : foods, createdAt: '', updatedAt: '', deletedAt: null }) }
  return <article className="entry-row draft-row"><div className="entry-marker meal" /><div className="entry-main"><div className="entry-title"><select aria-label="新餐别" value={mealType} onChange={(event) => setMealType(event.target.value as MealType)}><option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option><option value="snack">加餐</option><option value="other">其他</option></select><input className="meal-time" aria-label="新用餐时间" type="datetime-local" value={eatenAt} onChange={(event) => setEatenAt(event.target.value)} /></div><div className="food-input"><div className="food-chips">{foods.map((food) => <span className="food-chip" key={food}>{food}<button aria-label={`移除${food}`} onClick={() => setFoods(foods.filter((item) => item !== food))}><X size={12} /></button></span>)}</div><input list="new-food-suggestions" value={foodText} placeholder="输入食物后按回车" onChange={(event) => setFoodText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFood() } }} /><datalist id="new-food-suggestions">{suggestions.map((item) => <option key={item} value={item} />)}</datalist></div>{message && <span className="save-status invalid">{message}</span>}<div className="draft-actions"><button className="solid-button" onClick={() => void save()}>保存这餐</button><button className="quiet-button" onClick={onCancel}>放弃</button></div></div></article>
}

function HistoryPage({ selectedDate, onSelect }: { selectedDate: string; onSelect: (date: string) => void }) {
  const [month, setMonth] = useState(selectedDate.slice(0, 7)); const [days, setDays] = useState<CalendarDay[]>([])
  useEffect(() => { const start = `${month}-01`; const endDate = new Date(`${start}T00:00:00`); endDate.setMonth(endDate.getMonth() + 1); endDate.setDate(0); void window.作息记录.listCalendar({ start, end: endDate.toISOString().slice(0, 10) }).then(setDays) }, [month])
  const dayMap = useMemo(() => new Map(days.map((item) => [item.date, item])), [days]); const first = new Date(`${month}-01T00:00:00`); const offset = (first.getDay() + 6) % 7; const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(); const cells = Array.from({ length: offset + count }, (_, index) => index < offset ? null : `${month}-${String(index - offset + 1).padStart(2, '0')}`)
  const shiftMonth = (delta: number) => { const date = new Date(`${month}-01T00:00:00`); date.setMonth(date.getMonth() + delta); setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`) }
  return <div className="page"><header className="page-header"><div><p className="eyebrow">回看时间，不是回看自己</p><h1>历史日历</h1><p className="muted">有记录的日子会在这里留下轻微的痕迹。</p></div><div className="date-controls"><button className="icon-button" aria-label="上个月" onClick={() => shiftMonth(-1)}><ChevronLeft size={19} /></button><strong className="month-label">{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(first)}</strong><button className="icon-button" aria-label="下个月" onClick={() => shiftMonth(1)}><ChevronRight size={19} /></button></div></header><section className="calendar-wrap"><div className="weekday-row">{['一', '二', '三', '四', '五', '六', '日'].map((item) => <span key={item}>周{item}</span>)}</div><div className="calendar-grid">{cells.map((date, index) => { const info = date ? dayMap.get(date) : undefined; return <button key={index} className={`calendar-cell ${date === selectedDate ? 'selected' : ''} ${info ? 'has-data' : ''}`} disabled={!date} onClick={() => date && onSelect(date)}>{date && <><span>{Number(date.slice(-2))}</span>{info && <small><i className="calendar-sleep" />{info.sleepMinutes ? `${Math.round(info.sleepMinutes / 60)}h` : ''}<b>{info.mealCount ? ` ${info.mealCount} 餐` : ''}</b></small>}</>}</button> })}</div></section></div>
}

function AnalysisPage({ onNotify }: { onNotify: (message: string) => void }) {
  const [range, setRange] = useState<DateRange>(dateRange(7)); const [analysis, setAnalysis] = useState<AnalysisResult | null>(null); const [loading, setLoading] = useState(true)
  const load = useCallback(async () => { setLoading(true); try { setAnalysis(await window.作息记录.getAnalysis(range)) } finally { setLoading(false) } }, [range]); useEffect(() => { void load() }, [load])
  const chartData = analysis?.daily.map((item) => ({ ...item, label: item.date.slice(5), total: Math.round((item.mainMinutes + item.napMinutes) / 60 * 10) / 10, bedtime: item.bedtimeMinutes === null ? null : Math.round(item.bedtimeMinutes / 60 * 10) / 10, wake: item.wakeMinutes === null ? null : Math.round(item.wakeMinutes / 60 * 10) / 10 })) ?? []
  return <div className="page"><header className="page-header"><div><p className="eyebrow">让记录说话</p><h1>规律分析</h1><p className="muted">只描述已经发生的记录，不替你下健康结论。</p></div><div className="range-controls"><button className={range.start === dateRange(7).start ? 'range-button active' : 'range-button'} onClick={() => setRange(dateRange(7))}>近 7 天</button><button className={range.start === dateRange(30).start ? 'range-button active' : 'range-button'} onClick={() => setRange(dateRange(30))}>近 30 天</button><label className="range-date">从<input type="date" value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} />到<input type="date" value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} /></label></div></header>{loading && <div className="loading-line">正在整理这段时间…</div>}{analysis && <><div className="metric-strip"><Metric label="平均睡眠" value={formatMinutes(analysis.averageSleepMinutes)} /><Metric label="中位睡眠" value={formatMinutes(analysis.medianSleepMinutes)} /><Metric label="入睡平均偏差" value={analysis.bedtimeDeviation === null ? '—' : `${analysis.bedtimeDeviation} 分钟`} /><Metric label="有记录的天数" value={`${analysis.recordedDays} / ${analysis.totalDays}`} /></div><section className="analysis-band"><div className="band-heading"><span><Moon size={16} />睡眠总量</span><small>小时</small></div><div className="chart-box"><ResponsiveContainer width="100%" height={260}><BarChart data={chartData}><CartesianGrid vertical={false} stroke="var(--line)" /><XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={32} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 2 }} formatter={(value) => [`${value} 小时`, '总睡眠']} /><Bar dataKey="total" fill="var(--green)" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div></section><section className="analysis-band"><div className="band-heading"><span><Clock3 size={16} />作息时间</span><small>横轴为当天时间</small></div><div className="chart-box"><ResponsiveContainer width="100%" height={250}><LineChart data={chartData}><CartesianGrid vertical={false} stroke="var(--line)" /><XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis domain={[0, 24]} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={32} /><Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 2 }} formatter={(value, name) => [`${value} 点`, name === 'bedtime' ? '入睡' : '起床']} /><Line type="monotone" dataKey="bedtime" stroke="var(--amber)" strokeWidth={2} dot={{ r: 3 }} connectNulls /><Line type="monotone" dataKey="wake" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} connectNulls /></LineChart></ResponsiveContainer></div></section><div className="analysis-columns"><section className="analysis-band"><div className="band-heading"><span><Utensils size={16} />餐次记录</span><small>未记录不等于没吃</small></div><div className="meal-analysis-list">{analysis.meals.slice(0, 3).map((item) => <div className="meal-analysis-row" key={item.mealType}><span>{item.mealType === 'breakfast' ? '早餐' : item.mealType === 'lunch' ? '午餐' : '晚餐'}</span><strong>{item.recordedDays} 天</strong><em>{item.averageTimeMinutes === null ? '—' : formatClock(item.averageTimeMinutes)} · {item.deviationMinutes === null ? '数据不足' : `偏差 ${item.deviationMinutes} 分钟`}</em></div>)}</div></section><section className="analysis-band"><div className="band-heading"><span>常见食物</span><small>按记录次数</small></div><div className="food-ranking">{analysis.topFoods.length ? analysis.topFoods.map((item, index) => <div className="ranking-row" key={item.name}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><i>{item.count} 次</i></div>) : <p className="muted">还没有足够的食物记录。</p>}</div></section></div><section className="insight-band"><div className="band-heading"><span>这段时间的提示</span><small>中性描述</small></div>{analysis.insights.map((insight) => <p key={insight}>{insight}</p>)}</section><button className="outline-button export-analysis" onClick={async () => { const result = await window.作息记录.exportCsv(range); if (!result.canceled) onNotify(`已导出到 ${result.directory}`) }}><Download size={16} />导出这段时间的 CSV</button></>}</div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div> }

function TrashPage({ onNotify }: { onNotify: (message: string) => void }) {
  const [items, setItems] = useState<TrashItem[]>([]); const load = useCallback(() => window.作息记录.listTrash().then(setItems), []); useEffect(() => { void load() }, [load])
  const restore = async (item: TrashItem) => { await window.作息记录.restoreRecord(item.recordType, item.id); await load(); onNotify('记录已恢复') }
  const remove = async (item: TrashItem) => { if (!window.confirm('永久删除后无法恢复，确定继续吗？')) return; await window.作息记录.deleteRecord(item.recordType, item.id, true); await load(); onNotify('记录已永久删除') }
  return <div className="page"><header className="page-header"><div><p className="eyebrow">留一条后路</p><h1>回收站</h1><p className="muted">删除的记录会留在这里，直到你决定恢复或永久清理。</p></div></header>{!items.length ? <EmptySection icon={<ArchiveRestore size={23} />} title="回收站是空的" copy="这里暂时没有需要处理的记录。" action="回到今天" onClick={() => { window.location.reload() }} /> : <div className="trash-list">{items.map((item) => <article className="trash-row" key={`${item.recordType}-${item.id}`}><div><strong>{item.title}</strong><span>{item.detail}</span><small>删除于 {item.deletedAt.replace('T', ' ').slice(0, 16)}</small></div><div className="trash-actions"><button className="quiet-button" onClick={() => void restore(item)}><RotateCcw size={15} />恢复</button><button className="quiet-button danger-text" onClick={() => void remove(item)}><Trash2 size={15} />永久删除</button></div></article>)}</div>}</div>
}

function SettingsPage({ settings, onTheme, onNotify }: { settings: AppSettings; onTheme: (theme: ThemeMode) => Promise<void>; onNotify: (message: string) => void }) {
  const [exporting, setExporting] = useState(false)
  return <div className="page"><header className="page-header"><div><p className="eyebrow">让软件适应你</p><h1>设置与备份</h1><p className="muted">所有数据都留在本机，不需要账号，也不会上传。</p></div></header><section className="settings-list"><div className="setting-row"><div><strong>主题</strong><span>跟随 Windows，或固定一种颜色模式。</span></div><div className="segmented-control">{(['system', 'light', 'dark'] as ThemeMode[]).map((theme) => <button key={theme} className={settings.theme === theme ? 'selected' : ''} onClick={() => void onTheme(theme)}>{theme === 'system' ? '跟随系统' : theme === 'light' ? <><Sun size={15} />浅色</> : <><Moon size={15} />深色</>}</button>)}</div></div><div className="setting-row"><div><strong>完整备份</strong><span>保存睡眠、饮食、回收站与主题设置。</span></div><button className="outline-button" onClick={async () => { const result = await window.作息记录.createBackup(); if (!result.canceled) onNotify('备份已保存') }}><FileArchive size={16} />导出备份</button></div><div className="setting-row"><div><strong>恢复备份</strong><span>恢复前会在数据目录自动保留一份当前备份。</span></div><button className="outline-button" disabled={exporting} onClick={async () => { setExporting(true); try { const result = await window.作息记录.restoreBackup(); if (!result.canceled) { onNotify('备份已恢复，重新读取记录'); window.location.reload() } } catch (err) { onNotify(err instanceof Error ? err.message : '恢复失败') } finally { setExporting(false) } }}><ArchiveRestore size={16} />{exporting ? '恢复中…' : '选择备份恢复'}</button></div><div className="setting-row"><div><strong>关于作息记录</strong><span>版本 1.0.0 · 离线桌面版</span></div><span className="about-mark">◌</span></div></section></div>
}

export default App
