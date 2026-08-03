export function defaultRecordId(): string { return globalThis.crypto.randomUUID() }

export function defaultDateTime(): string {
  const current = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}T${pad(current.getHours())}:${pad(current.getMinutes())}`
}

export function defaultOffset(): number { return -new Date().getTimezoneOffset() }
