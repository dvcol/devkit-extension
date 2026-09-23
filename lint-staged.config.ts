export default {
  '*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}': [
    'oxlint --config .oxlintrc.json --deny-warnings --no-error-on-unmatched-pattern',
  ],
  '*.{js,cjs,mjs,jsx,ts,cts,mts,tsx,json,jsonc,md,yml,yaml,html,css,scss}': [
    'oxfmt --check --no-error-on-unmatched-pattern',
  ],
};
