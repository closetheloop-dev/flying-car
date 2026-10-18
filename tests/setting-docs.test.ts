import { describe, expect, it } from 'vitest';
import { FOLDER_DOCS, MODE_DOCS, SETTING_DOCS } from '../src/physics/setting-docs';
import { FLIGHT_MODES, FOLDER_NAMES, SETTINGS } from '../src/physics/settings';

describe('setting docs', () => {
  it('explain every setting, folder and flight model, and nothing else', () => {
    expect(Object.keys(SETTING_DOCS).sort()).toEqual(SETTINGS.map((s) => s.key).sort());
    expect(Object.keys(FOLDER_DOCS).sort()).toEqual([...FOLDER_NAMES].sort());
    expect(Object.keys(MODE_DOCS).sort()).toEqual([...FLIGHT_MODES].sort());
  });

  it('keep each hint to one sentence', () => {
    for (const [key, doc] of Object.entries(SETTING_DOCS)) {
      expect(doc!.hint, key).toMatch(/^[^.]+\.$/);
      expect(doc!.hint.length, key).toBeLessThan(120);
      expect(doc!.detail.length, key).toBeGreaterThan(0);
    }
  });
});
