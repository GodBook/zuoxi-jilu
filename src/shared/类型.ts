export type SleepKind = 'main' | 'nap'
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other'
export type ThemeMode = 'system' | 'light' | 'dark'
export type RecordType = 'sleep' | 'meal'

export interface SleepRecord {
  id: string
  startAt: string
  endAt: string
  startOffset: number
  endOffset: number
  recordDate: string
  kind: SleepKind
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface MealRecord {
  id: string
  eatenAt: string
  offset: number
  recordDate: string
  mealType: MealType
  foods: string[]
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface DayData {
  date: string
  sleeps: SleepRecord[]
  meals: MealRecord[]
  foodSuggestions: string[]
}

export interface CalendarDay {
  date: string
  sleepMinutes: number
  sleepCount: number
  mealCount: number
}

export interface TrashItem {
  recordType: RecordType
  id: string
  title: string
  detail: string
  deletedAt: string
  recordDate: string
}

export interface AppSettings {
  theme: ThemeMode
}

export interface DateRange {
  start: string
  end: string
}

export interface DailyAnalysis {
  date: string
  mainMinutes: number
  napMinutes: number
  bedtimeMinutes: number | null
  wakeMinutes: number | null
  mealCount: number
}

export interface MealTypeAnalysis {
  mealType: MealType
  recordedDays: number
  unrecordedDays: number
  averageTimeMinutes: number | null
  deviationMinutes: number | null
  stability: 'stable' | 'variable' | 'highly-variable' | 'insufficient'
}

export interface FoodFrequency {
  name: string
  count: number
}

export interface AnalysisResult {
  range: DateRange
  totalDays: number
  recordedDays: number
  daily: DailyAnalysis[]
  averageSleepMinutes: number | null
  medianSleepMinutes: number | null
  bedtimeAverage: number | null
  bedtimeDeviation: number | null
  wakeAverage: number | null
  wakeDeviation: number | null
  bedtimeStability: MealTypeAnalysis['stability']
  wakeStability: MealTypeAnalysis['stability']
  meals: MealTypeAnalysis[]
  topFoods: FoodFrequency[]
  insights: string[]
}

export interface BackupResult {
  canceled: boolean
  path?: string
}

export interface ExportResult extends BackupResult {
  directory?: string
}

export interface RestoreResult extends BackupResult {
  restored?: boolean
}

export interface AppApi {
  getDay(date: string): Promise<DayData>
  upsertSleep(record: Pick<SleepRecord, 'id' | 'startAt' | 'endAt' | 'startOffset' | 'endOffset' | 'kind'>): Promise<SleepRecord>
  upsertMeal(record: Pick<MealRecord, 'id' | 'eatenAt' | 'offset' | 'mealType' | 'foods'>): Promise<MealRecord>
  deleteRecord(type: RecordType, id: string, permanent?: boolean): Promise<void>
  restoreRecord(type: RecordType, id: string): Promise<void>
  listCalendar(range: DateRange): Promise<CalendarDay[]>
  listTrash(): Promise<TrashItem[]>
  getAnalysis(range: DateRange): Promise<AnalysisResult>
  exportCsv(range: DateRange): Promise<ExportResult>
  createBackup(): Promise<BackupResult>
  restoreBackup(): Promise<RestoreResult>
  getSettings(): Promise<AppSettings>
  setTheme(theme: ThemeMode): Promise<AppSettings>
}

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
  other: '其他'
}

export const SLEEP_LABELS: Record<SleepKind, string> = {
  main: '主睡眠',
  nap: '小睡'
}
