# tny-archive-schemas

## Validation

`validate.js` is a Node.js script that validates all of the JSON files in a given folder. (It also validates individual JSON files.) It uses the [@cfworker/json-schema](https://www.npmjs.com/package/@cfworker/json-schema) NPM package to perform the validation, based on the [article.schema.json](./article.schema.json) JSON schema.

### Requirements

- Node 22 or [nvm](https://github.com/nvm-sh/nvm)
- NPM

### Usage

If using nvm:
```bash
nvm use
\```

```bash
npm install
\```

```bash
npm run validate -- /PATH/TO/FOLDER
```

or

```bash
node validate.js /PATH/TO/FOLDER
```
