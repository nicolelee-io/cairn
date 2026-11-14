// The box of a task item: an optional quote prefix, a bullet or number, then `[ ]` or `[x]`.
const TASK_LINE = /^((?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\])/

/**
 * `body` with the task box on the 1-based `line` flipped (`[ ]` to `[x]` and back): one character
 * changes, nothing else. Null when that line holds no task box (the text changed under the reader).
 */
export function toggleTaskLine(body: string, line: number): string | null {
  const lines = body.split('\n')
  const text = lines[line - 1]
  const m = text === undefined ? null : TASK_LINE.exec(text)
  if (!m || text === undefined) return null
  const at = m[1]!.length
  lines[line - 1] = `${text.slice(0, at)}${m[2] === ' ' ? 'x' : ' '}${text.slice(at + 1)}`
  return lines.join('\n')
}
