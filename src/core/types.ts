/**
 * Compatibility export for the historical `../core/types.js` import surface.
 *
 * The canonical wildcard barrel is `src/core/types/index.ts`. Keep this shim while external callers
 * and existing internal imports still resolve through `../core/types.js`; add declarations to a
 * concrete `src/core/types/<domain>.ts` module instead.
 */

export type * from './types/index.js';
