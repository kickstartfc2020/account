import { clsx, type ClassValue } from "clsx"
import { format, isValid, parseISO } from "date-fns"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateDMY(value: string | Date | null | undefined, fallback = '—') {
  if (!value) return fallback
  const parsed = value instanceof Date ? value : parseISO(value)
  if (!isValid(parsed)) return fallback
  return format(parsed, 'dd-MM-yyyy')
}

export function formatDateRangeDMY(from: Date, to?: Date | null) {
  if (!to) return formatDateDMY(from)
  return `${formatDateDMY(from)} - ${formatDateDMY(to)}`
}
