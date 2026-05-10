import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        files: ["**/*.{js,jsx,mjs}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: { ...globals.browser, ...globals.node },
        },
    },
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parser: tsparser,
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: { ...globals.browser, ...globals.node },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },
    prettierRecommended,
    {
        // Demos, entries, scripts, and benchmarks are tooling / exploratory
        // dev code — out of strict audit scope. Relaxed rules so the library
        // lint stays a clean signal.
        files: [
            "src/demo/**",
            "src/entries/**",
            "src/scripts/**",
            "benchmarks/constraint/**",
        ],
        rules: {
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "no-unused-vars": "off",
        },
    },
    {
        ignores: ["dist/**", "dist-demo/**", "node_modules/**"],
    },
];
