import * as Sentry from '@sentry/tanstackstart-react'

const sentryDsn =
  import.meta.env?.VITE_SENTRY_DSN ?? process.env.VITE_SENTRY_DSN

if (!sentryDsn) {
  console.warn('VITE_SENTRY_DSN is not defined. Sentry is not running.')
} else {
  Sentry.init({
    dsn: sentryDsn,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    tracesSampleRate: 0.1,
  })
  // 标记启用 —— `#/lib/sentry` 通过这个 flag 决定要不要真正上送。
  // 单独走 `void Sentry.captureException` 在没启用的 SDK 上是 throw,所以引入这个开关。
  try {
    const mod = await import('./src/lib/sentry.ts')
    mod.enableSentry()
  } catch (err) {
    console.warn('[sentry] enableSentry failed', err)
  }
}
