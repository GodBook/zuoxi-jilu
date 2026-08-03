import { describe, expect, it } from 'vitest'
import { analyzeRecords, circularAverage, circularDistance, normalizeFoods, sleepDurationMinutes, validateSleep } from '../src/shared/核心'
import type { MealRecord, SleepRecord } from '../src/shared/类型'

const sleep = (overrides: Partial<SleepRecord> = {}): SleepRecord => ({
  id: 'sleep-1', startAt: '2026-08-02T23:30', endAt: '2026-08-03T07:00', startOffset: 480, endOffset: 480, recordDate: '2026-08-03', kind: 'main', createdAt: '', updatedAt: '', deletedAt: null, ...overrides
})

const meal = (overrides: Partial<MealRecord> = {}): MealRecord => ({
  id: 'meal-1', eatenAt: '2026-08-03T08:00', offset: 480, recordDate: '2026-08-03', mealType: 'breakfast', foods: ['鸡蛋', '牛奶'], createdAt: '', updatedAt: '', deletedAt: null, ...overrides
})

describe('作息领域纯函数', () => {
  it('规范化并去重食物标签', () => expect(normalizeFoods([' 米饭 ', '米饭', '  番茄  炒蛋 ', ''])).toEqual(['米饭', '番茄 炒蛋']))
  it('正确计算跨午夜睡眠时长', () => expect(sleepDurationMinutes(sleep())).toBe(450))
  it('拒绝重叠睡眠和第二段主睡眠', () => {
    const existing = [sleep()]
    expect(validateSleep(sleep({ id: 'sleep-2', startAt: '2026-08-03T06:00', endAt: '2026-08-03T08:00' }), existing)).toContain('重叠')
    expect(validateSleep(sleep({ id: 'sleep-2', startAt: '2026-08-03T09:00', endAt: '2026-08-03T10:00' }), existing)).toContain('主睡眠')
  })
  it('使用圆周时间处理午夜附近的平均值', () => {
    const average = circularAverage([1430, 10])!
    expect(circularDistance(average, 0)).toBeLessThan(20)
  })
  it('按起床日聚合睡眠并生成餐次缺失提示', () => {
    const result = analyzeRecords({ start: '2026-08-03', end: '2026-08-05' }, [sleep()], [meal()])
    expect(result.daily[0].mainMinutes).toBe(450)
    expect(result.daily[0].date).toBe('2026-08-03')
    expect(result.insights.some((item) => item.includes('未记录午餐'))).toBe(true)
  })
})
