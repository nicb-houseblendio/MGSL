/**
 * Makes the `.test.mjs` files in src/lib actually runnable.
 *
 * WHY THIS EXISTS. archTally.test.mjs and archTallyCapture.test.mjs import two things
 * plain node cannot resolve:
 *
 *   import … from './archTally.ts'   -> ERR_UNKNOWN_FILE_EXTENSION
 *   import … from '@/lib/archTally'  -> ERR_MODULE_NOT_FOUND ('@/lib' is not a package)
 *
 * The first is solved by node 22's --experimental-strip-types. The second needs a resolve
 * hook, because `@/*` -> `./src/*` is declared only in tsconfig.json (paths) and vite.config,
 * neither of which node reads. There is no test runner installed in this project - no vitest,
 * no jest, no tsx - so before this hook the two suites could not be executed from a clean
 * checkout at all. They were presumably run with an ad-hoc loader that was never committed,
 * the same way archTallyFixtures.ts points at a scratchpad genfix.mjs that no longer exists.
 *
 * RUN THE SUITES:
 *   cd react-app
 *   node --experimental-strip-types --import ./scripts/test-alias-hook.mjs --test src/lib/*.test.mjs
 *
 * Keep the alias table in step with tsconfig.json "paths" if that ever grows.
 */

import { register } from 'node:module';

register(
    'data:text/javascript,' +
        encodeURIComponent(`
    const SRC = ${JSON.stringify(new URL('../src/', import.meta.url).href)};
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith('@/')) {
        // tsconfig paths: "@/*" -> "./src/*". Extensionless imports are the norm in
        // the app code, so try .ts then .tsx then the bare path.
        const rest = specifier.slice(2);
        const candidates = rest.match(/\\.[cm]?[jt]sx?$/)
          ? [rest]
          : [rest + '.ts', rest + '.tsx', rest + '/index.ts', rest];
        let lastErr;
        for (const c of candidates) {
          try {
            return await next(new URL(c, SRC).href, context);
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      }
      return next(specifier, context);
    }
  `),
    import.meta.url
);
