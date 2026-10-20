/**
 * Content Security Policy for the packaged renderer.
 *
 * The page is served from a loopback HTTP origin (see `rendererServer.ts`)
 * rather than `file://`. Official providers — YouTube in particular — refuse
 * to play in an embedded player whose page has an opaque `file://` origin,
 * because the request carries no valid HTTP referrer.
 *
 * The policy is deliberately narrow: only the app itself, the two official
 * player scripts/frames and public artwork are allowed.
 */

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // The official embeddable players ship their own scripts.
  "script-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://w.soundcloud.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: kmedia: https:",
  "media-src 'self' blob: kmedia: https: http:",
  "font-src 'self' data:",
  "connect-src 'self' https: http:",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://w.soundcloud.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')
