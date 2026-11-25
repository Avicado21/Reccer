import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { reccerActions } from './deepspace'

// Served at POST /api/actions/<name> by src/server/action-routes.ts, which
// verifies the caller's JWT before any handler runs.
export const actions: Record<string, ActionHandler<Env>> = {
  ...reccerActions,
}
