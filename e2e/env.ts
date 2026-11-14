// Shared by the config, the server launcher and the tests. Port 3200 keeps clear of `npm run dev`
// (3000/5173) and the verify-ui instance (3100/5273).
export const E2E_PORT = 3200
export const BASE_URL = `http://localhost:${E2E_PORT}`
export const E2E_USER = 'e2e'
export const E2E_PASSWORD = 'e2e-password-123'
export const E2E_TIMEZONE = 'America/Denver'
export const AUTH_STATE = new URL('.auth/state.json', import.meta.url).pathname
// One account per project for the account spec, which changes passwords and usernames and so must
// not touch the shared `e2e` user the other specs (and their sessions) run on.
export const ACCOUNT_PASSWORD = 'account-password-123'
export const accountUser = (project: string) => `account-${project}`
