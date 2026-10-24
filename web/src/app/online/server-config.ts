/**
 * The hosted online server (Fly.io), used by the live site and its PR previews. Not a
 * secret: it's the public address every player's browser connects to. It must match `app`
 * in the repo root's fly.toml: Fly serves an app called X at https://X.fly.dev.
 */
export const HOSTED_SERVER_URL = 'https://dama-server.fly.dev';
