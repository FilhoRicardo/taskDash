import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.jsx"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
    },
    settings: { react: { version: "detect" } },
  },
];
