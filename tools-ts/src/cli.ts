#!/usr/bin/env node
/**
 * CLI for eendraadschema YAML/EDS conversion
 *
 * Usage:
 *   eds-convert yaml2eds input.yaml [output.eds]
 *   eds-convert eds2yaml input.eds [output.yaml]
 */

import * as path from 'path';
import { yamlToEds } from './convert.js';
import { edsToYaml } from './eds-to-yaml.js';

function printUsage(): void {
  console.log(`
Eendraadschema YAML/EDS Converter

Usage:
  eds-convert yaml2eds <input.yaml> [output.eds]
  eds-convert eds2yaml <input.eds> [output.yaml]

Commands:
  yaml2eds    Convert YAML to EDS format
  eds2yaml    Convert EDS to YAML format

If output file is omitted, uses input filename with changed extension.

Examples:
  eds-convert yaml2eds schema.yaml
  eds-convert yaml2eds schema.yaml output.eds
  eds-convert eds2yaml installation.eds
  eds-convert eds2yaml installation.eds output.yaml
`);
}

function changeExtension(filePath: string, newExt: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${newExt}`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0].toLowerCase();

  switch (command) {
    case 'yaml2eds': {
      if (args.length < 2) {
        console.error('Error: Missing input file');
        console.error('Usage: eds-convert yaml2eds <input.yaml> [output.eds]');
        process.exit(1);
      }
      const inputPath = args[1];
      const outputPath = args[2] || changeExtension(inputPath, '.eds');
      try {
        yamlToEds(inputPath, outputPath);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case 'eds2yaml': {
      if (args.length < 2) {
        console.error('Error: Missing input file');
        console.error('Usage: eds-convert eds2yaml <input.eds> [output.yaml]');
        process.exit(1);
      }
      const inputPath = args[1];
      const outputPath = args[2] || changeExtension(inputPath, '.yaml');
      try {
        edsToYaml(inputPath, outputPath);
      } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      printUsage();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
