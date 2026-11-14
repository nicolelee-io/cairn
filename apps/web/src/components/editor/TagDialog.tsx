import { useMemo, useState } from 'react'
import { MAX_TAG_LENGTH, tagKey } from '@cairn/shared'
import { useTags } from '../../lib/queries.ts'
import { withTag } from '../../lib/tags.ts'
import { Icon } from '../Icon.tsx'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogActions } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'

const QUICK_PICKS = 8
const MATCHES = 6

const pill =
  'state-layer inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm'

/** Add and remove an entry's tags: type to search your tags or make a new one, or tap a common one. */
export function TagDialog({
  open,
  value,
  onClose,
  onApply,
}: {
  open: boolean
  value: string[]
  onClose: () => void
  onApply: (tags: string[]) => void
}) {
  // Dialog mounts its children only while open, so the body's state starts fresh every time.
  return (
    <Dialog open={open} onClose={onClose} title="Tags">
      <TagBody value={value} onClose={onClose} onApply={onApply} />
    </Dialog>
  )
}

function TagBody({
  value,
  onClose,
  onApply,
}: {
  value: string[]
  onClose: () => void
  onApply: (tags: string[]) => void
}) {
  const [tags, setTags] = useState(value)
  const [text, setText] = useState('')
  const tagList = useTags().data
  const known = useMemo(() => tagList?.tags ?? [], [tagList])

  const chosen = useMemo(() => new Set(tags.map(tagKey)), [tags])
  const query = tagKey(text.replace(/^#+\s*/, ''))
  const suggestions = useMemo(() => {
    const free = known.filter((t) => !chosen.has(tagKey(t.name)))
    return query
      ? free.filter((t) => tagKey(t.name).includes(query)).slice(0, MATCHES)
      : free.slice(0, QUICK_PICKS)
  }, [known, chosen, query])
  // Typing something no existing tag matches exactly offers to create it.
  const creatable =
    query !== '' && !chosen.has(query) && !known.some((t) => tagKey(t.name) === query)

  const add = (name: string) => {
    setTags((t) => withTag(t, name))
    setText('')
  }

  return (
    <>
      {tags.length > 0 && (
        <ul aria-label="Tags on this entry" className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={tagKey(t)}>
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => setTags((all) => all.filter((x) => tagKey(x) !== tagKey(t)))}
                className={`${pill} bg-secondary-container text-on-secondary-container`}
              >
                {t}
                <Icon name="close" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Not a <form>: this dialog is rendered inside the editor's own form, and a submit here
          would bubble up and save the entry. */}
      <Input
        aria-label="Add a tag"
        data-autofocus=""
        placeholder="Add a tag"
        value={text}
        maxLength={MAX_TAG_LENGTH}
        autoCapitalize="none"
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          // Enter takes what is typed; with nothing typed it is Done.
          if (text.trim()) add(text)
          else onApply(tags)
        }}
      />

      {(suggestions.length > 0 || creatable) && (
        <div className="flex flex-col gap-2">
          {!query && <h3 className="text-sm text-on-surface-variant">Most used</h3>}
          <ul className="flex flex-wrap gap-2">
            {creatable && (
              <li>
                <button
                  type="button"
                  onClick={() => add(text)}
                  className={`${pill} bg-primary-container text-on-primary-container`}
                >
                  <Icon name="add" className="size-4" />
                  New tag “{text.trim().replace(/^#+\s*/, '')}”
                </button>
              </li>
            )}
            {suggestions.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => add(t.name)}
                  className={`${pill} bg-surface-container-highest`}
                >
                  {t.name}
                  <span className="text-on-surface-variant">{t.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogActions>
        <Button variant="text" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onApply(tags)}>
          Done
        </Button>
      </DialogActions>
    </>
  )
}
