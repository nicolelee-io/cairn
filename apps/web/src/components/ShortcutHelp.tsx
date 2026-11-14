import { useMemo, useState } from 'react'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { KeyCaps } from './KeyCaps.tsx'
import { CATALOG, type Meta } from '../lib/shortcutCatalog.ts'
import { isLive, keysUsable, useBareKeys, useGoToKeys, useShortcutList } from '../lib/shortcuts.ts'
import { closeShortcutHelp, useShortcutHelp } from '../lib/shortcutUi.ts'

const GROUP_ORDER = ['General', 'Go to', 'Entries', 'Reader', 'Editor', 'Calendar', 'Search']

type Row = Meta & { id: string; keys: string | string[] }

/** The keyboard shortcuts that apply on this screen, grouped; "Show all" lists every one. */
export function ShortcutHelp() {
  const { open, all } = useShortcutHelp()
  return (
    <Dialog
      open={open}
      onClose={closeShortcutHelp}
      title="Keyboard shortcuts"
      showClose
      className="w-[min(36rem,calc(100vw-2rem))]"
    >
      {open && <HelpBody startAll={all} />}
    </Dialog>
  )
}

// Every shortcut, whichever screen handles it: the catalogue is static, so this works from
// Settings too, where the reader's and the editor's aren't registered.
const EVERY: Row[] = Object.entries(CATALOG).flatMap(([id, meta]) =>
  'keys' in meta ? [{ ...(meta as Meta), id, keys: meta.keys }] : [],
)

function HelpBody({ startAll }: { startAll: boolean }) {
  const registered = useShortcutList()
  const quick = useBareKeys()
  const goTo = useGoToKeys()
  const [showAll, setShowAll] = useState(startAll)

  const groups = useMemo(() => {
    const live = registered.filter(isLive)
    const scopes = new Set(live.map((s) => s.scope))
    const rows: Row[] = showAll
      ? EVERY
      : [
          ...live.flatMap((s) => (s.keys ? [{ ...s, keys: s.keys }] : [])),
          // Keys CodeMirror handles itself aren't registered; list them while their screen shows.
          ...EVERY.filter((r) => r.helpOnly && scopes.has(r.scope)),
        ]
    const byGroup = new Map<string, Row[]>()
    for (const r of rows) {
      // Keys that are switched off (Settings > Keyboard) aren't listed; the Ctrl/Cmd/Alt ones stay.
      if (!keysUsable(r, quick, goTo)) continue
      byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r])
    }
    const rank = (g: string) => {
      const i = GROUP_ORDER.indexOf(g)
      return i < 0 ? GROUP_ORDER.length : i
    }
    return [...byGroup.entries()].sort(
      (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
    )
  }, [registered, showAll, goTo, quick])

  return (
    <>
      {!quick && (
        <p className="rounded-lg bg-secondary-container px-3 py-2 text-sm text-on-secondary-container">
          Quick-action keys are turned off on this device (Settings &gt; Keyboard). Shortcuts with
          Ctrl, Cmd or Alt still work.
        </p>
      )}
      {groups.map(([group, items]) => (
        <section key={group} aria-label={group} className="flex flex-col gap-1">
          <h3 className="text-sm font-medium tracking-wide text-primary uppercase">{group}</h3>
          <ul className="flex flex-col">
            {items.map((s) => (
              <li
                key={s.id}
                className="flex min-h-9 items-center justify-between gap-4 border-b border-outline-variant/50 py-1 last:border-b-0"
              >
                <span className="min-w-0 text-sm">{s.label}</span>
                <KeyCaps keys={s.keys} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Button variant="tonal" className="self-center" onClick={() => setShowAll(!showAll)}>
        {showAll ? 'Only what applies here' : 'Show all shortcuts'}
      </Button>
    </>
  )
}
