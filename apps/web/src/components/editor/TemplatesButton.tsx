import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Icon } from '../Icon.tsx'
import { TemplateDialog, type TemplateValue } from '../TemplateDialog.tsx'
import { Button } from '../ui/button.tsx'
import { openMenuFrom, type MenuAction } from '../../lib/contextMenu.ts'
import type { InsertItem } from '../../lib/insertItems.ts'
import { useServerDown } from '../../lib/serverStatus.ts'
import { useShortcuts } from '../../lib/shortcuts.ts'
import { suggestedName, templateItems, withoutMedia } from '../../lib/templateText.ts'
import { useAddTemplate, useTemplates } from '../../lib/templates.ts'
import { showToast } from '../../lib/toast.ts'
import { useTip } from '../../lib/useTip.tsx'

/**
 * What the editor's Templates button shows, wherever the button is (the header with a mouse, the
 * toolbar on a touch screen): `menu` builds the rows (the user's templates, each inserting at the
 * caret; "Save as template…", the entry's text without its photos and files as a new template; and
 * "Manage templates"), and `dialog` is the Save as template form, to be rendered once. It also
 * registers the palette's "Insert template: X" and "Save as template…" while the editor is open. The
 * list comes from the copy kept on the device, so inserting works offline; saving needs the server.
 */
export function useTemplatesMenu({
  bodyMd,
  insert,
}: {
  /** The entry's text now, for Save as template. */
  bodyMd: string
  /** Puts an insert into the text at the caret (the editor knows the timezone and the clock). */
  insert: (item: InsertItem) => void
}): { menu: () => MenuAction[]; dialog: ReactNode } {
  const navigate = useNavigate()
  const down = useServerDown()
  const templates = useTemplates().data?.templates ?? []
  const add = useAddTemplate()
  // What the Save as template dialog starts with; null while it is closed.
  const [seed, setSeed] = useState<TemplateValue | null>(null)

  const items = templateItems(templates)
  // Saving needs some text left once the photos and files are taken out, and the server.
  const blocked = down
    ? 'Needs a connection'
    : withoutMedia(bodyMd).trim()
      ? undefined
      : 'Write some text first'
  const openSave = () => setSeed({ name: suggestedName(bodyMd), bodyMd: withoutMedia(bodyMd) })

  const menu = (): MenuAction[] => [
    ...items.map((item): MenuAction => ({
      id: item.id,
      label: item.label,
      icon: 'description',
      run: () => insert(item),
    })),
    { id: 'save', label: 'Save as template…', icon: 'add', disabled: blocked, run: openSave },
    {
      id: 'manage',
      label: 'Manage templates',
      icon: 'edit_note',
      run: () => void navigate('/templates'),
    },
  ]

  useShortcuts([
    ...items.map((item) => ({
      id: `template.insert.${item.id}`,
      group: 'Editor',
      label: `Insert template: ${item.label}`,
      run: () => insert(item),
    })),
    {
      id: 'template.save',
      group: 'Editor',
      label: 'Save as template…',
      when: () => !blocked,
      run: openSave,
    },
  ])

  const close = () => {
    setSeed(null)
    add.reset()
  }

  const dialog = (
    <TemplateDialog
      open={seed !== null}
      onClose={close}
      title="Save as template"
      submitLabel="Save template"
      initial={seed ?? undefined}
      pending={add.isPending}
      error={add.error}
      onSubmit={(value) =>
        add.mutate(value, {
          onSuccess: () => {
            close()
            showToast('Saved as a template')
          },
        })
      }
    />
  )

  return { menu, dialog }
}

/**
 * The Templates button of the editor's header (a mouse; a touch screen has it in the toolbar, where
 * there is room, see Toolbar). It opens the menu from `useTemplatesMenu`.
 */
export function TemplatesButton({ menu }: { menu: () => MenuAction[] }) {
  const tip = useTip('Templates')
  return (
    <Button
      variant="text"
      size="icon"
      aria-label="Templates"
      aria-haspopup="menu"
      onClick={(e) => openMenuFrom(e.currentTarget, menu, 'Templates')}
      {...tip.bind}
    >
      {tip.node}
      <Icon name="description" />
    </Button>
  )
}
