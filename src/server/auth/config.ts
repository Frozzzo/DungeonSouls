export const AUTH_CONFIG = {
  sessionCookieName: "ds_session",
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** Evita escribir lastUsedAt en cada petición. */
  lastUsedWriteIntervalMs: 5 * 60 * 1000,
  rateLimits: {
    loginPerEmail: { max: 5, windowMs: 15 * 60 * 1000 },
    loginPerIp: { max: 20, windowMs: 15 * 60 * 1000 },
    registerPerIp: { max: 5, windowMs: 60 * 60 * 1000 },
  },
} as const;
