/** Set at build time by web/vite.config.ts. */
declare const __APP_VERSION__: string;
/** The commit the page was built from by GitHub Actions; empty for a build on your own computer. */
declare const __APP_COMMIT__: string;
/** The stylesheet imported by main.ts, bundled by Vite. */
declare module '*.css';
