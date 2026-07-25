/// <reference types="vite/client" />

/**
 * Build-time environment.
 *
 * Every value here is INLINED INTO THE BUNDLE by Vite and is therefore public
 * in the deployed site. Storing one in CI keeps it out of the repository; it
 * does not keep it out of the shipped JavaScript. Nothing that must stay
 * private belongs in a VITE_* variable.
 */
interface ImportMetaEnv {
  /**
   * Alchemy API key used to derive RPC endpoints for every configured chain.
   *
   * Public once built — protected by Alchemy's origin allowlist rather than by
   * secrecy, so it belongs in a GitHub Actions *variable*, not a secret.
   *
   * The production key is domain-restricted and is not used for local work.
   * Development supplies its own key in a local .env file; copy .env.example
   * and fill it in.
   */
  readonly VITE_ALCHEMY_KEY?: string;

  /** Explicit Sepolia RPC. Takes precedence over the Alchemy-derived endpoint. */
  readonly VITE_SEPOLIA_RPC_URL?: string;

  /** Explicit Polygon zkEVM RPC. Takes precedence over the Alchemy-derived endpoint. */
  readonly VITE_POLYGON_ZKEVM_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
