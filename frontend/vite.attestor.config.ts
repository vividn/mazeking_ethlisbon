/**
 * Build the registrar attestor into something a serverless platform can run.
 *
 * The handler is TypeScript that imports the game's own maze generator,
 * serializer and solver — which is the point, since a registrar that derived
 * mazes differently from the game would be worse than no registrar. But it
 * means the source cannot be uploaded as-is: the platform sees `.ts` files and
 * relative imports into `src/lib`.
 *
 * This compiles the whole import graph down to one `handler.mjs`.
 *
 * Dependencies stay external rather than being inlined. `@aztec/bb.js` carries
 * a WebAssembly module for the Pedersen hash that produces a maze's identity,
 * and inlining a package whose real payload is a `.wasm` asset is a good way to
 * get a bundle that builds cleanly and fails at runtime. Shipping a
 * `package.json` and letting the platform install them keeps the wasm intact
 * and the deployment honest about what it needs.
 */
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

const OUT_DIR = resolve(__dirname, 'dist-attestor');

/** Kept in step with the versions the frontend itself resolves. */
const RUNTIME_DEPS = {
  viem: '^2.48.8',
  '@aztec/bb.js': '2.1.9',
};

export default defineConfig({
  build: {
    ssr: true,
    outDir: OUT_DIR,
    emptyOutDir: true,
    // The frontend's public/ assets are irrelevant to a signing function and
    // would otherwise be copied into the deployment package.
    copyPublicDir: false,
    target: 'node20',
    minify: false,
    lib: {
      entry: resolve(__dirname, 'scripts/attest-maze.ts'),
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^viem/, /^@aztec\//, /^node:/],
      // `lib.fileName` is ignored for SSR builds, so name the entry here.
      output: { entryFileNames: 'handler.mjs' },
    },
  },
  plugins: [
    {
      name: 'attestor-manifest',
      closeBundle() {
        mkdirSync(OUT_DIR, { recursive: true });
        writeFileSync(
          resolve(OUT_DIR, 'package.json'),
          JSON.stringify(
            {
              name: 'mazeking-attestor',
              private: true,
              type: 'module',
              main: 'handler.mjs',
              engines: { node: '>=20' },
              dependencies: RUNTIME_DEPS,
            },
            null,
            2
          ) + '\n'
        );
      },
    },
  ],
});
