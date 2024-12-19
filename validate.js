import { exec } from 'node:child_process';
import { Validator } from '@cfworker/json-schema';
import chalk from 'chalk';
import fsp from 'node:fs/promises';
import papaparse from 'papaparse';
import path from 'node:path';
import url from 'node:url';
import xsdValidator from 'xsd-validator';
const validateSchema = xsdValidator.default;
import { XMLValidator } from 'fast-xml-parser';

const Glyph = {
  CROSS_MARK: '\u{274C}',
  OK_SIGN: '\u{1F197}',
  WARNING_SIGN: '\u{26A0}\u{FE0F} ',
  WHITE_HEAVY_CHECK_MARK: '\u{2705}',
};

const Status = {
  VALID: 'valid',
  INVALID: 'invalid',
  MALFORMED: 'malformed',
};

let jsonValidator;
let rawSchema;

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

/**
 * Recurse down an object’s hierarchy and build up an array of all values and
 * array entries that look like HTML fragments.
 *
 * @param {any} arg
 * @returns {[string]} - the HTML fragments
 */
export function findHtmlFragments(arg) {
  if (typeof arg === 'string' && /<.+?>/.test(arg)) {
    // Base case: only return an array if this string looks like an HTML fragment.
    return [arg];
  } else if (typeof arg === 'object') {
    // If arg is an array, run findHtmlFragments on all of its members; if
    // it’s an object, run findHtmlFragments on all of its values.
    const arr = Array.isArray(arg) ? arg : Object.values(arg);

    let results = [];
    for (const entry of arr) {
      const result = findHtmlFragments(entry);
      if (Array.isArray(result) && result.length > 0) {
        results = results.concat(result);
      }
    }

    return results;
  }
}

async function writeDataToReportCsv(filepath, data) {
  if (Array.isArray(data) && data.length === 0) {
    return;
  }

  // create directory (and any sub directories) if it doesn't exist
  const { dir } = path.parse(filepath);
  await fsp.mkdir(dir, { recursive: true });

  // write out the data
  const unparsed = papaparse.unparse(data, { newline: '\n', header: true });
  await fsp.writeFile(filepath, unparsed);
}

async function validateJson(json) {
  // Load the JSON schema and create the validator.
  if (!jsonValidator) {
    const schemaPath = url.fileURLToPath(
      import.meta.resolve('#article.schema.json'),
    );
    const schemaStr = await fsp.readFile(schemaPath);
    const schema = JSON.parse(schemaStr);
    jsonValidator = new Validator(schema);
  }

  const { valid, errors } = jsonValidator.validate(json);
  if (valid) {
    return {
      status: Status.VALID,
    };
  } else {
    return {
      status: Status.INVALID,
      errors: errors.map(({ error }) => error),
    };
  }
}

async function validateRaw(raw) {
  if (!rawSchema) {
    const schemaPath = url.fileURLToPath(
      import.meta.resolve('#article.raw.schema.xsd'),
    );
    rawSchema = await fsp.readFile(schemaPath);
  }

  try {
    const result = validateSchema(raw, rawSchema);
    if (result === true) {
      return {
        status: Status.VALID,
      };
    } else {
      return {
        status: Status.INVALID,
        errors: result.map((err) => err.message.trim()),
      };
    }
  } catch (err) {
    return {
      status: Status.MALFORMED,
      errors: [err.message.trim()],
    };
  }
}

function validateHtmlFragment(htmlFragment) {
  const xml = `<div>${htmlFragment}</div>`;
  const result = XMLValidator.validate(xml);
  if (result === true) {
    return {
      status: Status.VALID,
    };
  } else {
    return {
      status: Status.INVALID,
      content: htmlFragment,
      errors: result.err.msg,
    };
  }
}

// NOTE: jsonld is the only value inside the schema that can have HTML fragments
function validateHtmlFragments(jsonld) {
  const htmlFragments = findHtmlFragments(jsonld);

  let errors = [];
  let anyIsInvalid = false;

  for (const htmlFragment of htmlFragments) {
    const validationResult = validateHtmlFragment(htmlFragment);
    if (validationResult.status === Status.INVALID) {
      anyIsInvalid = anyIsInvalid || true;
    }
    errors = errors.concat(validationResult.errors || []);
  }

  return {
    status: anyIsInvalid ? Status.INVALID : Status.VALID,
    errors,
  };
}
async function generateFileReport(jsonFilePath) {
  const jsonString = await fsp.readFile(jsonFilePath);
  const { base: filename } = path.parse(jsonFilePath);
  const report = {
    path: jsonFilePath,
    filename,
    overall_status: '',
    json_status: '',
    raw_status: '',
    html_fragments_status: '',
    json_errors: [],
    raw_errors: [],
    html_fragments_errors: [],
  };

  let json;
  try {
    json = JSON.parse(jsonString);
  } catch (err) {
    report.overall_status = Status.MALFORMED;
    report.json_status = Status.MALFORMED;
    report.json_errors = err;
    return report;
  }

  const jsonValidationResult = await validateJson(json);
  report.json_status = jsonValidationResult.status;
  report.json_errors = jsonValidationResult.errors || [];

  const rawValidationResult = await validateRaw(json.raw);
  report.raw_status = rawValidationResult.status;
  report.raw_errors = rawValidationResult.errors || [];

  const htmlFragmentsValidationResult = validateHtmlFragments(json.jsonld);
  report.html_fragments_status = htmlFragmentsValidationResult.status;
  report.html_fragments_errors = htmlFragmentsValidationResult.errors || [];

  // The overall status is only valid if everything was valid.
  if (
    report.json_status === Status.VALID &&
    report.raw_status === Status.VALID &&
    report.html_fragments_status === Status.VALID
  ) {
    report.overall_status = Status.VALID;
  } else {
    report.overall_status = Status.INVALID;
  }
  return report;
}

/**
 * Find all of the JSON files at a given `inputPath`.
 * If the input is a directory, include all of the JSON files in that directory.
 * If the input is a file, include just the file.
 *
 * @param {string} inputPath
 * @returns
 */
async function getJsonFilePathsFromInputPath(inputPath) {
  let jsonFilePaths = [];

  const inputStats = await fsp.stat(inputPath);
  if (inputStats.isDirectory()) {
    try {
      const entries = await fsp.readdir(inputPath, {
        withFileTypes: true,
        recursive: true,
      });
      jsonFilePaths = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('json'))
        .map((entry) => path.resolve(entry.parentPath, entry.name));
    } catch (err) {
      console.error(err.message);
    }
  } else if (inputStats.isFile() && inputPath.endsWith('.json')) {
    jsonFilePaths.push(inputPath);
  }

  return jsonFilePaths;
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

  const jsonFilePaths = await getJsonFilePathsFromInputPath(inputPath);

  // There’s nothing to validate, so bail out early.
  if (jsonFilePaths.length === 0) {
    console.error('Could not find any JSON files in input.');
    process.exit(1);
  }

  const rows = [];

  for (const jsonFilePath of jsonFilePaths) {
    const report = await generateFileReport(jsonFilePath);
    const shortPath = jsonFilePath.replace(inputPath + '/', '');

    if (report.overall_status === Status.VALID) {
      console.log(Glyph.WHITE_HEAVY_CHECK_MARK + ' ' + chalk.green(shortPath));
    } else if (report.overall_status === Status.INVALID) {
      console.log(Glyph.CROSS_MARK + ' ' + chalk.red(shortPath));
    } else if (report.overall_status === Status.MALFORMED) {
      console.log(Glyph.WARNING_SIGN + ' ' + chalk.yellow(shortPath));
    }

    rows.push(report);
  }

  // Write the report
  const timestamp = new Date().toISOString().replace(/(:|\.)/g, '');
  const reportPath = url.fileURLToPath(
    import.meta.resolve(`#reports/${timestamp}.csv`),
  );
  writeDataToReportCsv(reportPath, rows);

  console.log('\nKey');
  console.log(`${Glyph.WHITE_HEAVY_CHECK_MARK} = valid`);
  console.log(`${Glyph.CROSS_MARK} = invalid`);
  console.log(`${Glyph.WARNING_SIGN} = malformed`);
})();
