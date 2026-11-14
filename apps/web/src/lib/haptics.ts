import { isCoarse } from './pointer.ts'

/**
 * A tick for a view switched by swipe (not for an entry: that felt wrong), where the device can
 * vibrate: Android's browsers, not iOS Safari, which has no such API. Touch screens only, so a
 * laptop with a mouse never buzzes. The API has no strength, only a length: 2ms is as short as
 * phones honour, and 8ms felt too heavy on a Pixel 9 Pro.
 */
export function tick(): void {
  if (isCoarse()) navigator.vibrate?.(2)
}
