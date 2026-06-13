// Flat ESLint config (ESLint 9 + typescript-eslint 8).
//
// We run the type-checked rule sets — `strictTypeChecked` enforces the project's coding standards
// (no `any`, no unnecessary assertions, narrowed `catch`, exhaustive switches) and
// `stylisticTypeChecked` adds consistency rules. `eslint-config-prettier` is last so formatting is
// owned solely by Prettier and never fights ESLint. Only `src` is linted (built/example files are
// excluded), so the type-checked rules always have a tsconfig to resolve against.
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "examples"] },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
      },
    },
    rules: {
      // Provider methods are async to satisfy their interface even when a given impl has no await.
      "@typescript-eslint/require-await": "off",
      // Bracket access is mandated by the compiler's noPropertyAccessFromIndexSignature; allow it.
      "@typescript-eslint/dot-notation": ["error", { allowIndexSignaturePropertyAccess: true }],
      // Interpolating numbers into strings is safe and common; keep the rest of the rule strict.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Underscore-prefixed args are intentional "unused, but required by signature" markers.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Tests build partial fakes (a stand-in fetch Response, spies, poked internals) that the
    // type-aware "unsafe" family flags. Relaxing those here keeps test code readable WITHOUT
    // loosening production rules. `no-explicit-any` stays on, so tests still avoid `any`.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  prettier,
);
