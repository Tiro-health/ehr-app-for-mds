import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind class lists, resolving conflicts (last wins). */
export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}
