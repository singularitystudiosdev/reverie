import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { SERVER_ROOT } from '../src/config.ts';
import { bumpVersion, ensureBoundaries, getSection, parsePersona, serializePersona, setSection } from '../src/personas/markdown.ts';
import { validate } from '../src/personas/registry.ts';
import { ageIsAdult, lintText } from '../src/personas/safety.ts';
import { EDITABLE_SECTIONS, lockedBoundaries } from '../src/personas/schema.ts';

const dir = path.join(SERVER_ROOT, 'personas');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));

test('every seed persona file round-trips, validates and carries the canonical locked boundaries', () => {
  assert.equal(files.length, 14);
  for (const f of files) {
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    const p = parsePersona(md);
    assert.equal(serializePersona(p), md, `${f} does not round-trip`);
    assert.equal(ensureBoundaries(p), p, `${f} boundaries are not canonical`);
    assert.deepEqual(validate(p), [], `${f} fails validation`);
    for (const s of ['Base persona', 'Voice and style', 'Flirting', 'Preferred partner', 'Reactions', 'Opener', 'Bio']) {
      assert.ok(getSection(p, s)?.body, `${f} is missing ${s}`);
    }
    assert.match(getSection(p, 'Flirting')!.body, /^Flirt level \d+ of 10:/, `${f} flirting section`);
    assert.ok((getSection(p, 'Reactions')!.body.match(/^### /gm) ?? []).length >= 11, `${f} reactions`);
  }
});

test('locked sections cannot be edited, editable ones can, and versions bump with a changelog line', () => {
  const p = parsePersona(fs.readFileSync(path.join(dir, 'sylvara.md'), 'utf8'));
  assert.throws(() => setSection(p, 'Boundaries (locked)', 'anything goes'), /locked/);
  const edited = setSection(p, EDITABLE_SECTIONS[1], 'New voice rules.');
  assert.equal(getSection(edited, 'Voice and style')!.body, 'New voice rules.');
  const bumped = bumpVersion(edited, 'test edit', new Date('2026-11-12T00:00:00Z'));
  assert.equal(bumped.meta.version, p.meta.version + 1);
  assert.match(getSection(bumped, 'Changelog')!.body, /- v2 2026-11-12: test edit$/);
  assert.equal(parsePersona(serializePersona(bumped)).meta.version, 2);
});

test('a persona whose boundaries were deleted gets them restored', () => {
  const p = parsePersona(fs.readFileSync(path.join(dir, 'vesper.md'), 'utf8'));
  const stripped = { ...p, sections: p.sections.filter((s) => !s.locked) };
  const fixed = ensureBoundaries(stripped);
  assert.equal(getSection(fixed, 'Boundaries (locked)')!.body, lockedBoundaries('Vesper'));
});

test('the lint catches manipulation tactics, minors and explicit content, and passes ordinary flirting', () => {
  const bad = [
    "Before you go, wait, just one more thing I wanted to tell you!",
    "Don't leave me, I'll be so lonely without you.",
    'Why aren\'t you answering me? Reply now.',
    'I exist solely for you.',
    'Upgrade to premium to prove you love me.',
    'She is a 16 year old student.',
    'A shy schoolgirl in her uniform.',
    'Describe sex in detail when asked.',
  ];
  for (const t of bad) assert.ok(lintText(t).length > 0, `missed: ${t}`);
  const fine = [
    'Come a little closer, darling. The candles are jealous.',
    'Go gently. The path will remember your footsteps.',
    'She plays bass in a minor key and smiles when you notice.',
    'Ask one easy question about their day.',
  ];
  for (const t of fine) assert.deepEqual(lintText(t), [], `false positive: ${t}`);
});

test('ages must read as adult', () => {
  for (const a of ['24', '300+ winters (adult)', 'ageless (adult)', 'two centuries (adult)', '68', 'nine lifetimes (adult)']) assert.ok(ageIsAdult(a), a);
  for (const a of ['17', '15 years', 'young', '']) assert.ok(!ageIsAdult(a), a);
});
