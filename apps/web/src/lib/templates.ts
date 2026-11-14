import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  TemplateSchema,
  TemplatesSchema,
  type CreateTemplate,
  type UpdateTemplate,
} from '@cairn/shared'
import { api } from './api.ts'
import { TEMPLATES_CACHE } from './cachePrefixes.ts'
import { useCachedList } from './cachedList.ts'
import { keys } from './queries.ts'

// Entry templates: a user's saved text, inserted into the editor at the caret (placeholders and the
// inserts are in lib/templateText.ts). The list is read from the server and kept on this device
// (lib/cachedList.ts), so inserting works offline; adding, editing and deleting need the server.

/** The user's templates by name. Starts from the copy on this device, so it is there offline. */
export const useTemplates = () =>
  useCachedList(TEMPLATES_CACHE, undefined, keys.templates, '/templates', TemplatesSchema)

export function useAddTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTemplate) =>
      api('/templates', { method: 'POST', body: input, schema: TemplateSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.templates }),
  })
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateTemplate & { id: string }) =>
      api(`/templates/${id}`, { method: 'PATCH', body: patch, schema: TemplateSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.templates }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.templates }),
  })
}
