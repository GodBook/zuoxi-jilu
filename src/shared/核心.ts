import type {
  AnalysisResult,
  DateRange,
  DailyAnalysis,
  MealRecord,
  MealType,
  MealTypeAnalysis,
  SleepRecord
} from './类型'

const DAY_MS = 86_400_000

export function normalizeFood(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function normalizeFoods(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const food = normalizeFood(raw)
    const key = food.toLocaleLowerCase('zh-CN')
    if (food && !seen.has(key)) {
      seen.add(key)
      result.push(food)
    }
  }
  return result
}

export function localDateOf(value: string): string {
  return value.slice(0, 10)
}

export function timeMinutes(value: string): number {
  const time = value.slice(11, 16)
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function parseLocalDateTime(value: string, offsetMinutes: number): number {
  const [date, time] = value.split('T')
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return Date.UTC(year, month - 1, day, hours, minutes) - offsetMinutes * 60_000
}

export function sleepDurationMinutes(record: Pick<SleepRecord, 'startAt' | 'endAt' | 'startOffset' | 'endOffset'>): number {
  return Math.round((parseLocalDateTime(record.endAt, record.endOffset) - parseLocalDateTime(record.startAt, record.startOffset)) / 60_000)
}

export function validateSleep(
  record: Pick<SleepRecord, 'id' | 'startAt' | 'endAt' | 'startOffset' | 'endOffset' | 'kind'>,
  existing: SleepRecord[]
): string | null {
  if (!record.startAt || !record.endAt) return '请填写入睡和起床时间'
  const duration = sleepDurationMinutes(record)
  if (duration <= 0) return '起床时间必须晚于入睡时间'
  if (duration > 48 * 60) return '单段睡眠不能超过 48 小时'
  const start = parseLocalDateTime(record.startAt, record.startOffset)
  const end = parseLocalDateTime(record.endAt, record.endOffset)
  for (const item of existing.filter((item) => item.id !== record.id && !item.deletedAt)) {
    const otherStart = parseLocalDateTime(item.startAt, item.startOffset)
    const otherEnd = parseLocalDateTime(item.endAt, item.endOffset)
    if (start < otherEnd && end > otherStart) return '这段时间与已有睡眠记录重叠'
  }
  const recordDate = localDateOf(record.endAt)
  if (record.kind === 'main' && existing.some((item) => item.id !== record.id && !item.deletedAt && item.kind === 'main' && item.recordDate === recordDate)) {
    return '同一起床日只能有一段主睡眠'
  }
  return null
}

export function dateRangeDays(range: DateRange): string[] {
  const result: string[] = []
  const start = new Date(`${range.start}T00:00:00Z`).getTime()
  const end = new Date(`${range.end}T00:00:00Z`).getTime()
  for (let time = start; time <= end; time += DAY_MS) result.push(new Date(time).toISOString().slice(0, 10))
  return result
}

export function circularAverage(values: number[]): number | null {
  if (!values.length) return null
  const radians = values.map((value) => (value / 1440) * Math.PI * 2)
  const x = radians.reduce((sum, value) => sum + Math.cos(value), 0) / values.length
  const y = radians.reduce((sum, value) => sum + Math.sin(value), 0) / values.length
  const angle = Math.atan2(y, x)
  return Math.round((((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) * 1440)) % 1440
}

export function circularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b)
  return Math.min(diff, 1440 - diff)
}

export function circularDeviation(values: number[], average = circularAverage(values)): number | null {
  if (!values.length || average === null) return null
  return Math.round(values.reduce((sum, value) => sum + circularDistance(value, average), 0) / values.length)
}

function stability(deviation: number | null, count: number): MealTypeAnalysis['stability'] {
  if (count < 3 || deviation === null) return 'insufficient'
  if (deviation <= 30) return 'stable'
  if (deviation <= 60) return 'variable'
  return 'highly-variable'
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function signedCircularShift(from: number, to: number): number {
  let diff = to - from
  if (diff > 720) diff -= 1440
  if (diff < -720) diff += 1440
  return diff
}

export function analyzeRecords(range: DateRange, sleeps: SleepRecord[], meals: MealRecord[]): AnalysisResult {
  const days = dateRangeDays(range)
  const activeSleeps = sleeps.filter((item) => !item.deletedAt && item.recordDate >= range.start && item.recordDate <= range.end)
  const activeMeals = meals.filter((item) => !item.deletedAt && item.recordDate >= range.start && item.recordDate <= range.end)
  const daily: DailyAnalysis[] = days.map((date) => {
    const dateSleeps = activeSleeps.filter((item) => item.recordDate === date)
    const main = dateSleeps.find((item) => item.kind === 'main')
    return {
      date,
      mainMinutes: dateSleeps.filter((item) => item.kind === 'main').reduce((sum, item) => sum + sleepDurationMinutes(item), 0),
      napMinutes: dateSleeps.filter((item) => item.kind === 'nap').reduce((sum, item) => sum + sleepDurationMinutes(item), 0),
      bedtimeMinutes: main ? timeMinutes(main.startAt) : null,
      wakeMinutes: main ? timeMinutes(main.endAt) : null,
      mealCount: activeMeals.filter((item) => item.recordDate === date).length
    }
  })
  const sleepTotals = daily.map((item) => item.mainMinutes + item.napMinutes).filter((value) => value > 0)
  const bedtimes = daily.flatMap((item) => item.bedtimeMinutes === null ? [] : [item.bedtimeMinutes])
  const wakeTimes = daily.flatMap((item) => item.wakeMinutes === null ? [] : [item.wakeMinutes])
  const bedtimeAverage = circularAverage(bedtimes)
  const wakeAverage = circularAverage(wakeTimes)
  const bedtimeDeviation = circularDeviation(bedtimes, bedtimeAverage)
  const wakeDeviation = circularDeviation(wakeTimes, wakeAverage)
  const mealTypes: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other']
  const mealAnalysis = mealTypes.map((mealType): MealTypeAnalysis => {
    const selected = activeMeals.filter((item) => item.mealType === mealType)
    const recordedDates = new Set(selected.map((item) => item.recordDate))
    const times = selected.map((item) => timeMinutes(item.eatenAt))
    const average = circularAverage(times)
    const deviation = circularDeviation(times, average)
    return {
      mealType,
      recordedDays: recordedDates.size,
      unrecordedDays: Math.max(0, days.length - recordedDates.size),
      averageTimeMinutes: average,
      deviationMinutes: deviation,
      stability: stability(deviation, times.length)
    }
  })
  const foodCounts = new Map<string, { name: string; count: number }>()
  for (const meal of activeMeals) {
    for (const food of meal.foods) {
      const key = normalizeFood(food).toLocaleLowerCase('zh-CN')
      const current = foodCounts.get(key)
      foodCounts.set(key, { name: current?.name ?? food, count: (current?.count ?? 0) + 1 })
    }
  }
  const insights: string[] = []
  const midpoint = Math.ceil(days.length / 2)
  const firstDays = new Set(days.slice(0, midpoint))
  const secondDays = new Set(days.slice(midpoint))
  const firstSleep = daily.filter((item) => firstDays.has(item.date) && item.mainMinutes + item.napMinutes > 0)
  const secondSleep = daily.filter((item) => secondDays.has(item.date) && item.mainMinutes + item.napMinutes > 0)
  if (firstSleep.length >= 2 && secondSleep.length >= 2) {
    const firstAvg = firstSleep.reduce((sum, item) => sum + item.mainMinutes + item.napMinutes, 0) / firstSleep.length
    const secondAvg = secondSleep.reduce((sum, item) => sum + item.mainMinutes + item.napMinutes, 0) / secondSleep.length
    const diff = Math.round(secondAvg - firstAvg)
    if (Math.abs(diff) >= 30) insights.push(`后半段的平均睡眠时长比前半段${diff > 0 ? '增加' : '减少'}了约 ${Math.abs(diff)} 分钟。`)
  }
  const firstBed = daily.filter((item) => firstDays.has(item.date)).flatMap((item) => item.bedtimeMinutes === null ? [] : [item.bedtimeMinutes])
  const secondBed = daily.filter((item) => secondDays.has(item.date)).flatMap((item) => item.bedtimeMinutes === null ? [] : [item.bedtimeMinutes])
  if (firstBed.length >= 2 && secondBed.length >= 2) {
    const firstAvg = circularAverage(firstBed)
    const secondAvg = circularAverage(secondBed)
    if (firstAvg !== null && secondAvg !== null) {
      const shift = Math.round(signedCircularShift(firstAvg, secondAvg))
      if (Math.abs(shift) >= 30) insights.push(`后半段的平均入睡时间比前半段${shift > 0 ? '推后' : '提前'}了约 ${Math.abs(shift)} 分钟。`)
    }
  }
  if (bedtimeDeviation !== null && bedtimes.length >= 3) insights.push(`入睡时间${stability(bedtimeDeviation, bedtimes.length) === 'stable' ? '较稳定' : stability(bedtimeDeviation, bedtimes.length) === 'variable' ? '有一定波动' : '波动较大'}，平均偏差约 ${bedtimeDeviation} 分钟。`)
  for (const type of ['breakfast', 'lunch', 'dinner'] as MealType[]) {
    const info = mealAnalysis.find((item) => item.mealType === type)!
    if (info.unrecordedDays > 0) {
      const label = type === 'breakfast' ? '早餐' : type === 'lunch' ? '午餐' : '晚餐'
      insights.push(`所选范围内有 ${info.unrecordedDays} 天未记录${label}。`)
    }
  }
  if (!insights.length) insights.push('记录还不够形成趋势，继续记录几天后再来看。')
  return {
    range,
    totalDays: days.length,
    recordedDays: new Set([...activeSleeps.map((item) => item.recordDate), ...activeMeals.map((item) => item.recordDate)]).size,
    daily,
    averageSleepMinutes: sleepTotals.length ? Math.round(sleepTotals.reduce((sum, value) => sum + value, 0) / sleepTotals.length) : null,
    medianSleepMinutes: median(sleepTotals),
    bedtimeAverage,
    bedtimeDeviation,
    wakeAverage,
    wakeDeviation,
    bedtimeStability: stability(bedtimeDeviation, bedtimes.length),
    wakeStability: stability(wakeDeviation, wakeTimes.length),
    meals: mealAnalysis,
    topFoods: [...foodCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')).slice(0, 10),
    insights
  }
}

export function formatMinutes(value: number | null): string {
  if (value === null) return '—'
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`
}

export function formatClock(minutes: number | null): string {
  if (minutes === null) return '—'
  const normalized = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}
