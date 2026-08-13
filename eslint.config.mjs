import js from "@eslint/js"
import globals from "globals"
import tseslintPlugin from "@typescript-eslint/eslint-plugin"
import tseslintParser from "@typescript-eslint/parser"
import reactHooks from "eslint-plugin-react-hooks"

const sourceFiles = [
  "src/**/*.{ts,tsx}",
  "electron/**/*.{ts,tsx}",
  "browser-extension/**/*.js",
  "tests/**/*.ts",
  "vite.config.ts",
  "vitest.config.ts",
  "playwright.config.ts"
]

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "dist-electron/**",
      "release/**",
      "renderer/**",
      "coverage/**",
      "browser-extension/manifest.json"
    ]
  },
  {
    ...js.configs.recommended,
    files: sourceFiles
  },
  {
    files: sourceFiles,
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        chrome: "readonly",
        Electron: "readonly",
        NodeJS: "readonly",
        React: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tseslintPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...tseslintPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-var-requires": "warn"
    }
  },
  {
    // Explicit boundary: the untyped IPC envelope. preload/registerAssistant
    // forward JSON payloads between processes and the renderer-side .d.ts
    // mirrors that surface. Typing it end-to-end is tracked as its own task;
    // everything OUTSIDE these three files must stay `any`-free (max-warnings 0).
    files: [
      "src/types/assistant.d.ts",
      "electron/preload.ts",
      "electron/core/ipc/registerAssistant.ts"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    // The Electron main process is compiled to CommonJS by tsc; lazy require()
    // is intentional there (optional deps, circular-import breaking, test
    // isolation). Tests use require() for the same isolation reasons.
    files: ["electron/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-var-requires": "off"
    }
  },
  {
    files: ["browser-extension/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: "readonly"
      }
    }
  }
]
