/**
 * EDS file codec - encode/decode EDS (Eendraadschema) files
 *
 * EDS files are compressed JSON with a header:
 * - EDS0040000 + base64(zlib(json)) for compressed format
 * - TXT0040000 + json for uncompressed format
 */

import * as fs from 'fs';
import * as pako from 'pako';

const EDS_HEADER = "EDS0040000";
const TXT_HEADER = "TXT0040000";

export interface EdsData {
  currentView: string;
  idToOrdinalMap: Record<string, unknown>;
  length: number;
  data: EdsItem[];
  active: boolean[];
  id: number[];
  print_table: PrintTable;
  properties: EdsProperties;
  curid: number;
  mode: string;
  sitplan: unknown;
  sitplanjson: SitplanJson;
  sitplanview: unknown;
}

export interface EdsItem {
  id: number;
  parent: number;
  indent: number;
  collapsed: boolean;
  props: Record<string, unknown>;
  sourcelist: unknown;
}

export interface PrintTable {
  height: number;
  maxwidth: number;
  displaypage: number;
  enableAutopage: boolean;
  printPageMode: string;
  printPageRange: string;
  pages: PageInfo[];
  pagemarkers: { markers: unknown[] };
  modevertical: string;
  starty: number;
  stopy: number;
  papersize: string;
}

export interface PageInfo {
  height: number;
  start: number;
  stop: number;
  info: string;
}

export interface EdsProperties {
  filename: string;
  owner: string;
  installer: string;
  control: string;
  info: string;
  currentView: unknown;
  legacySchakelaars: boolean;
}

export interface SitplanJson {
  numPages: number;
  activePage: number;
  defaults: SitplanDefaults;
  elements: SitplanElement[];
}

export interface SitplanDefaults {
  fontsize: number;
  scale: number;
  rotate: number;
}

export interface SitplanElement {
  page: number;
  posx: number;
  posy: number;
  sizex: number;
  sizey: number;
  labelposx: number;
  labelposy: number;
  labelfontsize: number;
  adrestype: string | null;
  adres: string | null;
  adreslocation: string;
  rotate: number;
  scale: number;
  movable: boolean;
  color: string;
  svg: string;
  electroItemId: number | null;
}

/**
 * Read and decode an EDS file to JSON
 */
export function edsToJson(path: string): EdsData {
  const raw = fs.readFileSync(path, 'utf-8').trim();

  if (raw.startsWith(EDS_HEADER)) {
    // Compressed format
    const b64 = raw.slice(EDS_HEADER.length);
    // Add padding if needed
    const paddedB64 = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const compressed = Buffer.from(paddedB64, 'base64');
    const decompressed = pako.inflate(compressed, { to: 'string' });
    return JSON.parse(decompressed);
  } else if (raw.startsWith(TXT_HEADER)) {
    // Uncompressed format
    return JSON.parse(raw.slice(TXT_HEADER.length));
  }

  throw new Error(`Unknown EDS format - expected header ${EDS_HEADER} or ${TXT_HEADER}`);
}

/**
 * Encode JSON data and write to EDS file
 */
export function jsonToEds(obj: EdsData, path: string): void {
  const payload = JSON.stringify(obj);
  const compressed = pako.deflate(payload);
  const b64 = Buffer.from(compressed).toString('base64');
  fs.writeFileSync(path, EDS_HEADER + b64, 'utf-8');
}
