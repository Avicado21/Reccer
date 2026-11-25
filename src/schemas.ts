/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Keep the scaffold's required `users` schema. Reccer's own collections live in
 * src/schemas/reccer-schemas.ts and are all client-none (server actions only).
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { reccerSchemas } from './schemas/reccer-schemas'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  ...reccerSchemas,
]
