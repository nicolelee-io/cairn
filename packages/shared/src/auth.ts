import { z } from 'zod'

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(1024),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

export const USER_ROLES = ['user', 'admin'] as const
export const UserRoleSchema = z.enum(USER_ROLES)
export type UserRole = z.infer<typeof UserRoleSchema>

export const MeSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  defaultTimezone: z.string(),
  /** Where New entry writes: the chosen default if still usable, else the first active journal. */
  defaultJournalId: z.string().nullable(),
  /** How temperatures are shown on every device; weather is stored in Celsius. */
  tempUnit: z.enum(['F', 'C']),
  /** New entries open with the current location filled in (weather then follows on save). */
  autoLocation: z.boolean(),
  /** The nav's Archived fold; off leaves archived journals to Manage journals. Defaults for a copy cached before it existed. */
  showArchivedInMenu: z.boolean().default(true),
  /** The writing streak stat in Insights and Details, and the best streak beside it (shown only while the streak is). Default for a copy cached before they existed. */
  showStreak: z.boolean().default(true),
  showBestStreak: z.boolean().default(true),
  /** When the avatar picture was last set (epoch ms), or null for none; versions its URL. */
  avatarUpdatedAt: z.number().int().nullable(),
  /** Admins see the Server settings and Manage users. Defaults for a copy cached before roles. */
  role: UserRoleSchema.default('user'),
  /** The server's trash retention, for the delete wording. Defaults for a copy cached before the trash. */
  trashRetentionDays: z.number().int().default(60),
})
export type Me = z.infer<typeof MeSchema>

/** An IANA zone name the runtime knows (`Intl` throws a RangeError on anything else). */
export const TimezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}, 'Not a valid IANA timezone')

/** The sign-in name; same limits as the login form. The server stores it lowercased. */
export const UsernameSchema = z.string().trim().min(1).max(200)

export const MIN_PASSWORD_LENGTH = 8
/** A new password. Login accepts any non-empty one so older passwords keep working. */
export const NewPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(1024)

export const DisplayNameSchema = z.string().trim().min(1).max(100)

export const UpdateMeSchema = z.object({
  displayName: DisplayNameSchema.optional(),
  /** Drives Insights and the Calendar; entries keep the zone they were written in. */
  defaultTimezone: TimezoneSchema.optional(),
  /** null clears the choice, falling back to the first active journal. */
  defaultJournalId: z.string().nullable().optional(),
  tempUnit: z.enum(['F', 'C']).optional(),
  autoLocation: z.boolean().optional(),
  showArchivedInMenu: z.boolean().optional(),
  showStreak: z.boolean().optional(),
  showBestStreak: z.boolean().optional(),
})
export type UpdateMe = z.infer<typeof UpdateMeSchema>

/** Username and password are changed together, on their own endpoint, behind the current password. */
export const UpdateCredentialsSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    username: UsernameSchema.optional(),
    newPassword: NewPasswordSchema.optional(),
  })
  .refine((v) => v.username !== undefined || v.newPassword !== undefined, 'Nothing to change')
export type UpdateCredentials = z.infer<typeof UpdateCredentialsSchema>

/** Avatar uploads: one small file, JPEG/PNG/WebP. */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024

/** Manage users (admins only). Never carries anything about the user's journals. */
export const AdminUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: UserRoleSchema,
  disabled: z.boolean(),
  createdAt: z.number().int(),
})
export type AdminUser = z.infer<typeof AdminUserSchema>
export const AdminUserListSchema = z.object({ users: z.array(AdminUserSchema) })

/** The password is a temporary one; the new user changes it in Account settings. */
export const CreateUserSchema = z.object({
  username: UsernameSchema,
  displayName: DisplayNameSchema,
  password: NewPasswordSchema,
  role: UserRoleSchema.default('user'),
})
export type CreateUser = z.input<typeof CreateUserSchema>

export const UpdateUserSchema = z
  .object({ role: UserRoleSchema.optional(), disabled: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, 'Nothing to change')
export type UpdateUser = z.infer<typeof UpdateUserSchema>

export const ResetUserPasswordSchema = z.object({ newPassword: NewPasswordSchema })
