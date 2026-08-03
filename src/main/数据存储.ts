import { app } from 'electron'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import type {
  AppSettings,
  CalendarDay,
  DateRange,
  DayData,
  MealRecord,
  MealType,
  RecordType,
  SleepRecord,
  TrashItem,
  ThemeMode
} from '../shared/类型'
import { analyzeRecords, localDateOf, normalizeFoods, parseLocalDateTime, sleepDurationMinutes } from '../shared/核心'

const SCHEMA_VERSION = 1

function now(): string {
  return new Date().toISOString()
}

function localDateTimeNow(): string {
  const current = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}T${pad(current.getHours())}:${pad(current.getMinutes())}`
}

function offsetNow(): number {
  return -new Date().getTimezoneOffset()
}

function rowValue<T>(value: unknown): T {
  return value as T
}

function rowToSleep(row: Record<string, unknown>): SleepRecord {
  return {
    id: rowValue<string>(row.id),
    startAt: rowValue<string>(row.start_at),
    endAt: rowValue<string>(row.end_at),
    startOffset: rowValue<number>(row.start_offset),
    endOffset: rowValue<number>(row.end_offset),
    recordDate: rowValue<string>(row.record_date),
    kind: rowValue<'main' | 'nap'>(row.kind),
    createdAt: rowValue<string>(row.created_at),
    updatedAt: rowValue<string>(row.updated_at),
    deletedAt: rowValue<string | null>(row.deleted_at)
  }
}

function rowToMeal(row: Record<string, unknown>): MealRecord {
  let foods: string[] = []
  try { foods = normalizeFoods(JSON.parse(rowValue<string>(row.foods_json))) } catch { foods = [] }
  return {
    id: rowValue<string>(row.id),
    eatenAt: rowValue<string>(row.eaten_at),
    offset: rowValue<number>(row.offset_minutes),
    recordDate: rowValue<string>(row.record_date),
    mealType: rowValue<MealType>(row.meal_type),
    foods,
    createdAt: rowValue<string>(row.created_at),
    updatedAt: rowValue<string>(row.updated_at),
    deletedAt: rowValue<string | null>(row.deleted_at)
  }
}

export class DataStore {
  private db!: Database
  private readonly dataDir: string
  private readonly dbPath: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor() {
    this.dataDir = path.join(app.getPath('userData'))
    this.dbPath = path.join(this.dataDir, '记录.sqlite')
  }

  get directory(): string { return this.dataDir }
  get databaseFile(): string { return this.dbPath }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true })
    const SQL = await initSqlJs({ locateFile: () => this.wasmPath() })
    const bytes = await this.findUsableSnapshot()
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database()
    this.createSchema()
    await this.persist()
  }

  private wasmPath(): string {
    if (app.isPackaged) return path.join(process.resourcesPath, 'sql-wasm.wasm')
    return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  }

  private async findUsableSnapshot(): Promise<Uint8Array | null> {
    const candidates = [this.dbPath, `${this.dbPath}.next`, `${this.dbPath}.previous`]
    for (const candidate of candidates) {
      try {
        const bytes = await fs.readFile(candidate)
        const SQL = await initSqlJs({ locateFile: () => this.wasmPath() })
        const probe = new SQL.Database(bytes)
        const hasSchema = probe.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").length > 0
        probe.close()
        if (hasSchema) return bytes
      } catch { /* 继续尝试回退快照 */ }
    }
    return null
  }

  private createSchema(): void {
    this.db.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sleep_sessions (
        id TEXT PRIMARY KEY,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        record_date TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('main', 'nap')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS meals (
        id TEXT PRIMARY KEY,
        eaten_at TEXT NOT NULL,
        offset_minutes INTEGER NOT NULL,
        record_date TEXT NOT NULL,
        meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
        foods_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sleep_record_date ON sleep_sessions(record_date);
      CREATE INDEX IF NOT EXISTS idx_meal_record_date ON meals(record_date);
      CREATE INDEX IF NOT EXISTS idx_sleep_deleted ON sleep_sessions(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_meal_deleted ON meals(deleted_at);
    `)
    this.db.run('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)])
    this.db.run('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)', ['theme', 'system'])
  }

  private all<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql)
    try {
      statement.bind(params)
      const rows: T[] = []
      while (statement.step()) rows.push(statement.getAsObject() as T)
      return rows
    } finally { statement.free() }
  }

  private run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params)
  }

  private async mutate<T>(operation: () => T): Promise<T> {
    const task = this.queue.then(async () => {
      const before = this.db.export()
      try {
        this.db.run('BEGIN IMMEDIATE')
        const result = operation()
        this.db.run('COMMIT')
        try {
          await this.persist()
        } catch (error) {
          this.db.close()
          const SQL = await initSqlJs({ locateFile: () => this.wasmPath() })
          this.db = new SQL.Database(before)
          this.createSchema()
          throw error
        }
        return result
      } catch (error) {
        try { this.db.run('ROLLBACK') } catch { /* 事务可能已经提交 */ }
        throw error
      }
    })
    this.queue = task.catch(() => undefined)
    return task
  }

  private async persist(): Promise<void> {
    const bytes = this.db.export()
    const next = `${this.dbPath}.next`
    const previous = `${this.dbPath}.previous`
    const handle = await fs.open(next, 'w')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally { await handle.close() }
    try { await fs.unlink(previous) } catch { /* 不存在 */ }
    try { await fs.rename(this.dbPath, previous) } catch { /* 首次写入 */ }
    await fs.rename(next, this.dbPath)
    try { await fs.unlink(previous) } catch { /* 回退文件保留失败不影响当前数据 */ }
  }

  private getSleeps(includeDeleted = false): SleepRecord[] {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL'
    return this.all<Record<string, unknown>>(`SELECT * FROM sleep_sessions ${where} ORDER BY start_at`).map(rowToSleep)
  }

  private getMeals(includeDeleted = false): MealRecord[] {
    const where = includeDeleted ? '' : 'WHERE deleted_at IS NULL'
    return this.all<Record<string, unknown>>(`SELECT * FROM meals ${where} ORDER BY eaten_at`).map(rowToMeal)
  }

  async getDay(date: string): Promise<DayData> {
    const sleeps = this.all<Record<string, unknown>>('SELECT * FROM sleep_sessions WHERE record_date = ? AND deleted_at IS NULL ORDER BY start_at', [date]).map(rowToSleep)
    const meals = this.all<Record<string, unknown>>('SELECT * FROM meals WHERE record_date = ? AND deleted_at IS NULL ORDER BY eaten_at', [date]).map(rowToMeal)
    const suggestions = [...new Set(this.getMeals().flatMap((meal) => meal.foods))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return { date, sleeps, meals, foodSuggestions: suggestions }
  }

  async upsertSleep(input: Pick<SleepRecord, 'id' | 'startAt' | 'endAt' | 'startOffset' | 'endOffset' | 'kind'>): Promise<SleepRecord> {
    return this.mutate(() => {
      const existing = this.getSleeps()
      const recordDate = localDateOf(input.endAt)
      const timestamp = now()
      const found = existing.find((item) => item.id === input.id)
      this.run(`INSERT INTO sleep_sessions(id, start_at, end_at, start_offset, end_offset, record_date, kind, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET start_at=excluded.start_at, end_at=excluded.end_at, start_offset=excluded.start_offset, end_offset=excluded.end_offset, record_date=excluded.record_date, kind=excluded.kind, updated_at=excluded.updated_at, deleted_at=NULL`,
      [input.id, input.startAt, input.endAt, input.startOffset, input.endOffset, recordDate, input.kind, found?.createdAt ?? timestamp, timestamp])
      return this.getSleeps().find((item) => item.id === input.id)!
    })
  }

  async upsertMeal(input: Pick<MealRecord, 'id' | 'eatenAt' | 'offset' | 'mealType' | 'foods'>): Promise<MealRecord> {
    return this.mutate(() => {
      const existing = this.getMeals()
      const found = existing.find((item) => item.id === input.id)
      const timestamp = now()
      const foods = normalizeFoods(input.foods)
      if (!foods.length) throw new Error('至少填写一种食物')
      this.run(`INSERT INTO meals(id, eaten_at, offset_minutes, record_date, meal_type, foods_json, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET eaten_at=excluded.eaten_at, offset_minutes=excluded.offset_minutes, record_date=excluded.record_date, meal_type=excluded.meal_type, foods_json=excluded.foods_json, updated_at=excluded.updated_at, deleted_at=NULL`,
      [input.id, input.eatenAt, input.offset, localDateOf(input.eatenAt), input.mealType, JSON.stringify(foods), found?.createdAt ?? timestamp, timestamp])
      return this.getMeals().find((item) => item.id === input.id)!
    })
  }

  async deleteRecord(type: RecordType, id: string, permanent = false): Promise<void> {
    return this.mutate(() => {
      const table = type === 'sleep' ? 'sleep_sessions' : 'meals'
      if (permanent) this.run(`DELETE FROM ${table} WHERE id = ?`, [id])
      else this.run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
    })
  }

  async restoreRecord(type: RecordType, id: string): Promise<void> {
    return this.mutate(() => {
      const table = type === 'sleep' ? 'sleep_sessions' : 'meals'
      this.run(`UPDATE ${table} SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [now(), id])
    })
  }

  async listCalendar(range: DateRange): Promise<CalendarDay[]> {
    const sleeps = this.getSleeps().filter((item) => item.recordDate >= range.start && item.recordDate <= range.end)
    const meals = this.getMeals().filter((item) => item.recordDate >= range.start && item.recordDate <= range.end)
    const dates = new Set([...sleeps.map((item) => item.recordDate), ...meals.map((item) => item.recordDate)])
    return [...dates].sort().map((date) => {
      const daySleeps = sleeps.filter((item) => item.recordDate === date)
      return {
        date,
        sleepMinutes: daySleeps.reduce((sum, item) => sum + sleepDurationMinutes(item), 0),
        sleepCount: daySleeps.length,
        mealCount: meals.filter((item) => item.recordDate === date).length
      }
    })
  }

  async listTrash(): Promise<TrashItem[]> {
    const result: TrashItem[] = []
    for (const item of this.getSleeps(true).filter((entry) => entry.deletedAt)) {
      result.push({ recordType: 'sleep', id: item.id, title: item.kind === 'main' ? '主睡眠' : '小睡', detail: `${item.startAt.replace('T', ' ')} — ${item.endAt.replace('T', ' ')}`, deletedAt: item.deletedAt!, recordDate: item.recordDate })
    }
    for (const item of this.getMeals(true).filter((entry) => entry.deletedAt)) {
      result.push({ recordType: 'meal', id: item.id, title: item.foods.join('、'), detail: item.eatenAt.replace('T', ' '), deletedAt: item.deletedAt!, recordDate: item.recordDate })
    }
    return result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }

  async getAnalysis(range: DateRange) {
    return analyzeRecords(range, this.getSleeps(), this.getMeals())
  }

  async getSettings(): Promise<AppSettings> {
    const row = this.all<Record<string, unknown>>('SELECT value FROM settings WHERE key = ?', ['theme'])[0]
    return { theme: (row?.value as ThemeMode | undefined) ?? 'system' }
  }

  async setTheme(theme: ThemeMode): Promise<AppSettings> {
    await this.mutate(() => this.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['theme', theme]))
    return { theme }
  }

  async createBackup(targetPath: string): Promise<void> {
    const backup = {
      format: '作息记录备份',
      version: SCHEMA_VERSION,
      exportedAt: now(),
      settings: await this.getSettings(),
      sleeps: this.getSleeps(true),
      meals: this.getMeals(true)
    }
    await fs.writeFile(targetPath, JSON.stringify(backup, null, 2), 'utf8')
  }

  async restoreBackup(sourcePath: string): Promise<void> {
    const raw = await fs.readFile(sourcePath, 'utf8')
    const backup = JSON.parse(raw) as { format?: string; version?: number; settings?: AppSettings; sleeps?: SleepRecord[]; meals?: MealRecord[] }
    if (backup.format !== '作息记录备份' || backup.version !== SCHEMA_VERSION || !Array.isArray(backup.sleeps) || !Array.isArray(backup.meals)) throw new Error('备份文件格式或版本不受支持')
    await this.mutate(() => {
      this.run('DELETE FROM sleep_sessions')
      this.run('DELETE FROM meals')
      this.run('DELETE FROM settings')
      this.run('INSERT INTO settings(key, value) VALUES (?, ?)', ['theme', backup.settings?.theme ?? 'system'])
      for (const item of backup.sleeps!) this.run('INSERT INTO sleep_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [item.id, item.startAt, item.endAt, item.startOffset, item.endOffset, item.recordDate, item.kind, item.createdAt, item.updatedAt, item.deletedAt])
      for (const item of backup.meals!) this.run('INSERT INTO meals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [item.id, item.eatenAt, item.offset, item.recordDate, item.mealType, JSON.stringify(normalizeFoods(item.foods)), item.createdAt, item.updatedAt, item.deletedAt])
    })
  }

  async writeCsv(directory: string, range: DateRange): Promise<void> {
    await fs.mkdir(directory, { recursive: true })
    const sleeps = this.getSleeps().filter((item) => item.recordDate >= range.start && item.recordDate <= range.end)
    const meals = this.getMeals().filter((item) => item.recordDate >= range.start && item.recordDate <= range.end)
    const csvEscape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
    const sleepRows = ['日期,类型,入睡时间,起床时间,时长（分钟）']
    for (const item of sleeps) sleepRows.push([item.recordDate, item.kind === 'main' ? '主睡眠' : '小睡', item.startAt, item.endAt, sleepDurationMinutes(item)].map(csvEscape).join(','))
    const mealRows = ['日期,餐别,用餐时间,食物']
    const labels: Record<MealType, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐', other: '其他' }
    for (const item of meals) mealRows.push([item.recordDate, labels[item.mealType], item.eatenAt, item.foods.join('、')].map(csvEscape).join(','))
    const bom = '\uFEFF'
    await Promise.all([
      fs.writeFile(path.join(directory, '睡眠记录.csv'), bom + sleepRows.join('\r\n'), 'utf8'),
      fs.writeFile(path.join(directory, '饮食记录.csv'), bom + mealRows.join('\r\n'), 'utf8')
    ])
  }
}
