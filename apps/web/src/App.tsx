import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthGate } from './auth/AuthGate.tsx'
import { keys } from './lib/queries.ts'
import { ApiError } from './lib/api.ts'
import { AppShell } from './layout/AppShell.tsx'
import { NavigationSync } from './lib/navigation.ts'
import { BrowseLayout, ReaderEmpty } from './layout/BrowseLayout.tsx'
import { JournalsPage } from './pages/JournalsPage.tsx'
import { ServerStoragePage, StoragePage } from './pages/StoragePage.tsx'
import { TagsPage } from './pages/TagsPage.tsx'
import { TemplatesPage } from './pages/TemplatesPage.tsx'
import { TrashPage } from './pages/TrashPage.tsx'
import { TrashEntryPage } from './pages/TrashEntryPage.tsx'
import { UsersPage } from './pages/UsersPage.tsx'
import { DraftsPage } from './pages/DraftsPage.tsx'
import { EditEntryPage } from './pages/EditEntryPage.tsx'
import { EntryPage } from './pages/EntryPage.tsx'
import { InsightsPage } from './pages/InsightsPage.tsx'
import { NewEntryPage } from './pages/NewEntryPage.tsx'
import { AllPromptsPage } from './pages/AllPromptsPage.tsx'
import { PromptsPage } from './pages/PromptsPage.tsx'
import { AdminPromptsPage } from './pages/AdminPromptsPage.tsx'
import { SuggestedPromptsPage } from './pages/SuggestedPromptsPage.tsx'
import { NotFound } from './pages/Page.tsx'
import { SearchPage } from './pages/SearchPage.tsx'
import { SyncPage } from './pages/SyncPage.tsx'
import { SettingsLayout } from './layout/SettingsLayout.tsx'
import { AccountSettings, EntryTextSettings, SettingsSection } from './pages/settings/sections.tsx'

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // A 401 anywhere means the session ended: fall back to the login screen.
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) queryClient.setQueryData(keys.me, null)
    },
  }),
  // networkMode 'always': the app handles offline itself (the service worker's cache, the local
  // copy, the outbox), so requests must still run when the browser says it is offline. TanStack's
  // default pauses them instead, which left Save stuck on "Saving…" and kept reads from ever
  // reaching the local copy.
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
      networkMode: 'always',
    },
    mutations: { networkMode: 'always' },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <BrowserRouter>
          <NavigationSync />
          <Routes>
            <Route element={<AppShell />}>
              {/* Browse: the entry list beside a reader. Same URLs on every screen size. */}
              <Route element={<BrowseLayout />}>
                <Route index element={<ReaderEmpty />} />
                <Route path="j/:journalId" element={<ReaderEmpty />} />
                <Route path="entry/:id" element={<EntryPage />} />
                <Route path="j/:journalId/entry/:id" element={<EntryPage />} />
                <Route path="entry/:id/edit" element={<EditEntryPage />} />
                <Route path="j/:journalId/entry/:id/edit" element={<EditEntryPage />} />
                <Route path="new" element={<NewEntryPage />} />
                <Route path="j/:journalId/new" element={<NewEntryPage />} />
              </Route>
              <Route path="insights" element={<InsightsPage />} />
              <Route path="prompts" element={<PromptsPage />} />
              <Route path="prompts/all" element={<AllPromptsPage />} />
              <Route path="prompts/suggested" element={<SuggestedPromptsPage />} />
              {/* Settings: its list beside the page from 840px. Same URLs on every screen size. */}
              <Route element={<SettingsLayout />}>
                <Route path="settings" element={<AccountSettings />} />
                <Route path="settings/prompts" element={<AdminPromptsPage />} />
                <Route path="settings/appearance/entry-text" element={<EntryTextSettings />} />
                <Route path="settings/:section" element={<SettingsSection />} />
                <Route path="journals" element={<JournalsPage />} />
                <Route path="tags" element={<TagsPage />} />
                <Route path="templates" element={<TemplatesPage />} />
                <Route path="trash" element={<TrashPage />} />
                <Route path="trash/:id" element={<TrashEntryPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="storage" element={<StoragePage />} />
                <Route path="storage/server" element={<ServerStoragePage />} />
                <Route path="sync" element={<SyncPage />} />
              </Route>
              <Route path="drafts" element={<DraftsPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  )
}
