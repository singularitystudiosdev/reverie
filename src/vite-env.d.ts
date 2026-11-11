/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Reverie backend (server/). Unset: the app runs fully local, as on GitHub Pages. */
  readonly VITE_REVERIE_API?: string;
}
