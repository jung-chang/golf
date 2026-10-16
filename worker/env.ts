// Bindings, secrets and per-request variables shared by every route file.
export type Env = {
  DB: D1Database;
  /** Cloudflare Access team domain, e.g. "myteam.cloudflareaccess.com". */
  TEAM_DOMAIN?: string;
  /** Access application audience (AUD) tag. */
  POLICY_AUD?: string;
  /** Local dev only (in .dev.vars): who you are when there's no Access token. */
  DEV_EMAIL?: string;
  /** Web push (VAPID). Public key is base64url; private key is the JWK as JSON. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_CONTACT?: string; // mailto:...
};

export type AppEnv = { Bindings: Env; Variables: { email: string } };
