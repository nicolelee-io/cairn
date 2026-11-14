import { useRef, useState } from 'react'
import {
  PROMPT_ICONS,
  PROMPT_IMPORT_MAX_BYTES,
  PROMPT_IMPORT_MAX_PROMPTS,
  type PromptImportFile,
  type PromptImportSummary,
} from '@cairn/shared'
import { Icon } from '../../components/Icon.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Dialog, DialogActions } from '../../components/ui/dialog.tsx'
import { Textarea } from '../../components/ui/textarea.tsx'
import { errorCode } from '../../lib/api.ts'
import { plural } from '../../lib/format.ts'
import { describeImport, parseImport } from '../../lib/promptImport.ts'
import { useImportPrompts } from '../../lib/prompts.ts'
import { showToast } from '../../lib/toast.ts'

const EXAMPLE = `{ "categories": [
  { "name": "Reflection", "icon": "psychology",
    "prompts": ["What recurring thought have I noticed lately?"] }
] }`

/**
 * Admin: paste or choose a JSON file of categories and prompts. Preview asks the server what it
 * would do (a dry run, nothing written); Import then does it. Merge only: categories match by
 * name ignoring case, a prompt whose exact text is already there is skipped. Mounted only while open.
 */
export function PromptImportDialog({ onClose }: { onClose: () => void }) {
  const run = useImportPrompts()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    file: PromptImportFile
    summary: PromptImportSummary
  } | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const edit = (next: string) => {
    setText(next)
    setProblem(null)
    setPreview(null)
    run.reset()
  }

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > PROMPT_IMPORT_MAX_BYTES) return setProblem('That file is over 1 MB.')
    edit(await file.text())
  }

  const check = () => {
    const parsed = parseImport(text)
    if (!parsed.ok) return setProblem(parsed.error)
    run.mutate(
      { file: parsed.file, dryRun: true },
      { onSuccess: (summary) => setPreview({ file: parsed.file, summary }) },
    )
  }

  const confirm = () => {
    if (!preview) return
    run.mutate(
      { file: preview.file, dryRun: false },
      {
        onSuccess: (s) => {
          showToast(`Imported ${plural(s.newPrompts, 'prompt', 'prompts')}`)
          onClose()
        },
      },
    )
  }

  const failure =
    problem ??
    (run.isError
      ? errorCode(run.error) === 'limit_reached'
        ? 'That would go over the limit for categories or suggested prompts.'
        : errorCode(run.error) === 'too_large'
          ? 'That file is over 1 MB.'
          : 'Couldn’t reach the server. Try again once you’re online.'
      : null)
  const nothingNew =
    preview && preview.summary.newCategories === 0 && preview.summary.newPrompts === 0

  return (
    <Dialog open onClose={onClose} title="Import prompts" showClose>
      <p className="text-sm text-on-surface-variant">
        Paste a JSON file of categories and prompts, or choose one. Anything already there is
        skipped, so importing the same file twice changes nothing.
      </p>
      <Textarea
        aria-label="Prompts JSON"
        className="min-h-40 font-mono text-sm"
        spellCheck={false}
        placeholder={EXAMPLE}
        value={text}
        onChange={(e) => edit(e.target.value)}
      />
      <input
        ref={picker}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void chooseFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <Button variant="tonal" className="self-start" onClick={() => picker.current?.click()}>
        <Icon name="upload_file" className="size-5" />
        Choose file…
      </Button>
      <details className="text-sm text-on-surface-variant">
        <summary className="cursor-pointer">Format and icons</summary>
        <pre className="mt-2 overflow-x-auto rounded-sm bg-surface-container p-3 text-xs">
          {EXAMPLE}
        </pre>
        <p className="mt-2">
          At most {PROMPT_IMPORT_MAX_PROMPTS} prompts and 1 MB, 200 characters each. A category’s
          icon is optional; use one of: {PROMPT_ICONS.join(', ')}. Anything else gets the default.
        </p>
      </details>
      {failure && (
        <p role="alert" className="text-sm text-error">
          {failure}
        </p>
      )}
      {preview && (
        <p role="status" className="rounded-lg bg-surface-container p-3">
          {describeImport(preview.summary)}
        </p>
      )}
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        {preview ? (
          <Button disabled={run.isPending || !!nothingNew} onClick={confirm}>
            Import
          </Button>
        ) : (
          <Button disabled={run.isPending || !text.trim()} onClick={check}>
            Preview
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
