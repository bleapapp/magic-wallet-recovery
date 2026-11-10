import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Strict Content Security Policy for the built page (published, or served by `npm run web`): only
 * its own scripts and styles, no inline code, and network access only to HTTPS endpoints (the
 * public RPCs that serve creation code; every other read goes through the browser wallet). Added
 * at build time only, because the development server injects inline scripts.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  'connect-src https:',
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

const packageJson = new URL('../package.json', import.meta.url);
const { version } = JSON.parse(readFileSync(packageJson, 'utf8')) as { version: string };

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Relative paths, so the built page works from any folder.
  base: './',
  plugins: [contentSecurityPolicy()],
  // Shown in the page footer, so anyone can check which code is served. GitHub Actions sets
  // GITHUB_SHA; a build on your own computer shows the version only.
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
  },
  server: {
    // The page imports the core library from ../src.
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Readable source maps make the built bundle easy to audit.
    sourcemap: true,
  },
});
