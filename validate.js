import { exec } from 'node:child_process';
import { Validator } from '@cfworker/json-schema';
import fsp from 'node:fs/promises';
import path from 'path';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const Glyph = {
  CROSS_MARK: '\u{274C}',
  WARNING_SIGN: '\u{26A0}\u{FE0F} ',
  WHITE_HEAVY_CHECK_MARK: '\u{2705}',
};

/**
 * Get the working directory, based on where the script is being called (as
 * opposed to where it is located).
 *
 * @returns {Promise<string>} - an absolute path
 */
function pwd() {
  return new Promise((resolve, reject) => {
    exec('pwd', (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res.trim());
      }
    });
  });
}

(async function main() {
  const input = process.argv?.[2];

  if (!input) {
    console.error(
      'One positional argument is required (a path to a directory or file).',
    );
    process.exit(1);
  }

  // Build an absolute path based on the input.
  let inputPath = input;
  if (!path.isAbsolute(input)) {
    const workingDir = await pwd();
    inputPath = path.resolve(workingDir, input);
    console.log(inputPath);
  }

  // Build the paths of files to validate.
  // If the input is a directory, include all of the JSON files in that directory.
  // If the input is a file, include just the file.
  let filePaths = [];
  const inputStats = await fsp.stat(inputPath);
  if (inputStats.isDirectory()) {
    try {
      const entries = await fsp.readdir(inputPath, {
        withFileTypes: true,
        recursive: true,
      });
      filePaths = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('json'))
        .map((entry) => path.resolve(entry.parentPath, entry.name));
    } catch (err) {
      console.error(err.message);
    }
  } else if (inputStats.isFile() && inputPath.endsWith('.json')) {
    filePaths.push(inputPath);
  }

  // There’s nothing to validate, so bail out early.
  if (filePaths.length === 0) {
    console.error('Could not find any JSON files in input.');
    process.exit(1);
  }

  // Load the JSON schema and create the validator.
  const schemaPath = path.resolve(__dirname, './article.schema.json');
  const schemaStr = await fsp.readFile(schemaPath);
  const schema = await JSON.parse(schemaStr);
  const validator = new Validator(schema);

  try {
    // Validate every JSON file.
    for (const filePath of filePaths) {
      const dataStr = await fsp.readFile(filePath);

      let data;
      let shortPath = filePath.replace(inputPath + '/', '');
      try {
        data = await JSON.parse(dataStr);
      } catch {
        console.log(`${Glyph.WARNING_SIGN} ${shortPath}`);
        continue;
      }

      const { valid } = validator.validate(data);

      // TODO: use article.raw.schema.xsd to validate the `raw` property.

      if (valid) {
        console.log(`${Glyph.WHITE_HEAVY_CHECK_MARK} ${shortPath}`);
      } else {
        console.log(`${Glyph.CROSS_MARK} ${shortPath}`);
      }
    }
  } catch (err) {
    console.error(err);
  }

  console.log('\nKey:');
  console.log(`${Glyph.WHITE_HEAVY_CHECK_MARK} = valid, per schema`);
  console.log(`${Glyph.CROSS_MARK} = invalid, per schema`);
  console.log(`${Glyph.WARNING_SIGN} = malformed JSON`);
})();
