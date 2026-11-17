interface ImportMetaEnv {
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Made by `integrations/changelog-releases.ts` from `CHANGELOG.md` at build time.
declare module "virtual:ea-changelog-releases" {
  export const RELEASES: { version: string; forUsers: { en: string; pl: string }[] }[];
}
