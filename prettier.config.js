/** @type {import('prettier').Config} */
const config = {
  singleQuote: true,
  overrides: [
    {
      files: '*.json',
      options: {
        parser: 'json-stringify',
        tabWidth: 4,
      },
    },
  ],
};

export default config;
