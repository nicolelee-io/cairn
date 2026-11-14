import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  NotifySettingsSchema,
  NotifyTestResultSchema,
  type NotifySettings,
  ServerHealthSchema,
} from '@cairn/shared'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Switch } from '../../components/ui/switch.tsx'
import { api } from '../../lib/api.ts'
import { keys } from '../../lib/queries.ts'

/** Keeps the browser and the common password managers from offering to fill these fields. */
const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const

/** A topic nobody could guess: on a public ntfy server its name is the only thing keeping it private. */
const newTopic = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `cairn-${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('')}`
}

/** Server-wide: push alerts to an ntfy topic when the server is unwell, and what they watch. */
export function AlertsCard() {
  const saved = useQuery({
    queryKey: keys.adminNotifications,
    queryFn: () => api('/admin/notifications', { schema: NotifySettingsSchema }),
  }).data
  return saved ? <AlertsForm saved={saved} /> : null
}

function AlertsForm({ saved }: { saved: NotifySettings }) {
  const qc = useQueryClient()
  const health = useQuery({
    queryKey: keys.adminHealth,
    queryFn: () => api('/admin/health', { schema: ServerHealthSchema }),
    staleTime: 60_000,
  }).data

  const [enabled, setEnabled] = useState(saved.enabled)
  const [url, setUrl] = useState(saved.url)
  const [topic, setTopic] = useState(saved.topic)
  const [token, setToken] = useState('')

  const body = (clearToken = false) => ({
    enabled,
    url,
    topic,
    ...(clearToken ? { token: '' } : token ? { token } : {}),
  })
  const save = useMutation({
    mutationFn: (clearToken: boolean) =>
      api('/admin/notifications', {
        method: 'PUT',
        body: body(clearToken),
        schema: NotifySettingsSchema,
      }),
    onSuccess: (s) => {
      qc.setQueryData(keys.adminNotifications, s)
      setToken('')
    },
  })
  const test = useMutation({
    mutationFn: () =>
      api('/admin/notifications/test', { method: 'POST', schema: NotifyTestResultSchema }),
  })

  const dirty =
    enabled !== saved.enabled || url !== saved.url || topic !== saved.topic || token !== ''
  const canSave = !(enabled && topic.trim() === '') && url.trim() !== ''

  return (
    <form
      autoComplete="off"
      className="flex flex-col gap-3 rounded-lg bg-surface-container-low p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) save.mutate(false)
      }}
    >
      <div className="flex items-center gap-4">
        <p className="flex-1 text-lg">Server alerts</p>
        <Switch checked={enabled} onChange={setEnabled} label="Send server alerts" />
      </div>
      <p className="text-sm text-on-surface-variant">
        Get a phone notification through ntfy when something goes wrong, like a failed backup. You
        get one message when a problem starts, a daily reminder, and one when it’s fixed. Messages
        never include anything from your entries.
      </p>
      {health && health.problems.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-lg bg-error-container px-4 py-3 text-on-error-container"
        >
          <p className="font-medium">Active alerts</p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
            {health.problems.map((p) => (
              <li key={p.id}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
        ntfy server
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          {...NO_AUTOFILL}
        />
      </label>
      <div className="flex flex-col gap-1 text-sm text-on-surface-variant">
        <label htmlFor="ntfy-topic">Topic</label>
        <div className="flex gap-2">
          <Input
            id="ntfy-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
            {...NO_AUTOFILL}
          />
          <Button variant="text" onClick={() => setTopic(newTopic())}>
            Generate
          </Button>
        </div>
        <p>
          Anyone who knows the topic can read it on the public ntfy server, so use a long random
          name. Subscribe to it in the ntfy app.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm text-on-surface-variant">
        Access token (only for a server that needs one)
        <Input
          // Not type=password: with the topic above it, browsers and password managers take the pair
          // for a login and offer to fill it. The dots come from CSS instead.
          className="[-webkit-text-security:disc]"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          spellCheck={false}
          {...NO_AUTOFILL}
          placeholder={saved.hasToken ? 'A token is saved; paste a new one to replace it' : ''}
        />
      </label>
      {(save.isError || (enabled && topic.trim() === '')) && (
        <p role="alert" className="text-sm text-error">
          {save.isError
            ? 'Couldn’t save. Check the server address and that the topic uses only letters, digits, - and _.'
            : 'Choose a topic to turn alerts on.'}
        </p>
      )}
      {test.data && (
        <p role="status" className={test.data.ok ? 'text-sm' : 'text-sm text-error'}>
          {test.data.ok ? 'Test sent. Check your phone.' : `Test failed: ${test.data.error}.`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!dirty || !canSave || save.isPending}>
          Save
        </Button>
        <Button
          variant="text"
          disabled={dirty || !saved.topic || test.isPending}
          onClick={() => test.mutate()}
        >
          Send test
        </Button>
        {saved.hasToken && (
          <Button variant="text" disabled={save.isPending} onClick={() => save.mutate(true)}>
            Remove token
          </Button>
        )}
      </div>
    </form>
  )
}
