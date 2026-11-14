/**
 * Copies text to the clipboard and says whether it worked. `navigator.clipboard` only exists on
 * https and localhost, and Cairn is also opened over plain http (a tailnet name), so the old
 * select-and-copy route is the fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused (permissions, a background tab): try the fallback below.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.append(area)
  const focused = document.activeElement
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    if (focused instanceof HTMLElement) focused.focus()
  }
}
