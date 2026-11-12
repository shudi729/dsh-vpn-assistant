/**
 * Data store: reads package data/*.json, validates structure, caches per file
 * with mtime invalidation. Editing a data file takes effect on the next
 * request without restarting the profile.
 *
 * Deep-copies records on hand-out so route handlers can apply link-guard
 * nulling without mutating the cache.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = deepCopy(item);
    return out;
  }
  return value;
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

export class DataStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.cache = new Map();
  }

  async readRaw(name) {
    const file = path.join(this.dataDir, name + '.json');
    let info;
    try {
      info = await stat(file);
    } catch (error) {
      fail('DATA_MISSING', 'data file missing: ' + name + '.json (' + error.message + ')');
    }
    const cached = this.cache.get(name);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.value;
    }
    let parsed;
    try {
      // Windows-authored files may carry a UTF-8 BOM; strip before parsing.
      const raw = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
      parsed = JSON.parse(raw);
    } catch (error) {
      fail('DATA_INVALID', 'data file is not valid JSON: ' + name + '.json (' + error.message + ')');
    }
    this.cache.set(name, { mtimeMs: info.mtimeMs, size: info.size, value: parsed });
    return parsed;
  }

  async meta() { return deepCopy(await this.readRaw('meta')); }

  async providers() { return deepCopy(await this.readRaw('providers')); }

  async software() { return deepCopy(await this.readRaw('software')); }

  async tutorials() { return deepCopy(await this.readRaw('tutorials')); }

  async provider(providerId) {
    const providers = await this.readRaw('providers');
    const found = (Array.isArray(providers) ? providers : []).find((p) => p?.provider_id === providerId);
    return found ? deepCopy(found) : null;
  }

  /** Basic structural validation; throws DATA_INVALID on violation. */
  async validate() {
    const [meta, providers, software, tutorials] = await Promise.all([
      this.readRaw('meta'), this.readRaw('providers'), this.readRaw('software'), this.readRaw('tutorials'),
    ]);
    const problems = [];
    if (!meta || typeof meta !== 'object' || !Array.isArray(meta.platforms)) {
      problems.push('meta.platforms must be an array');
    }
    const ids = new Set();
    if (!Array.isArray(providers) || providers.length === 0) {
      problems.push('providers must be a non-empty array');
    } else {
      for (const p of providers) {
        if (!p?.provider_id) problems.push('provider without provider_id');
        else if (ids.has(p.provider_id)) problems.push('duplicate provider_id ' + p.provider_id);
        else ids.add(p.provider_id);
      }
    }
    for (const list of [software, tutorials]) {
      if (!Array.isArray(list)) { problems.push('software/tutorials must be arrays'); continue; }
      for (const item of list) {
        // tutorials may be platform-generic (provider_id null)
        if (item?.provider_id !== null && item?.provider_id !== undefined && !ids.has(item.provider_id)) {
          problems.push((item?.software_id ?? item?.tutorial_id ?? 'entry') + ' references unknown provider_id ' + item?.provider_id);
        }
      }
    }
    if (problems.length) fail('DATA_INVALID', problems.join('; '));
    return { ok: true, providers: ids.size, software: software.length, tutorials: tutorials.length };
  }
}
