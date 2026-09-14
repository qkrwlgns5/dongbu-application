import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { schoolLevels, validateSchoolLevels, schoolLevelsLabel } from "../app/school-levels.js";

const root = new URL("../", import.meta.url);

test("school-level options support elementary, middle, and both without accepting an empty target", () => {
  assert.deepEqual(schoolLevels(undefined), ["middle"]);
  assert.deepEqual(schoolLevels('["elementary","middle"]'), ["elementary", "middle"]);
  assert.deepEqual(validateSchoolLevels(["middle","elementary","middle"]), ["elementary","middle"]);
  for (const value of [[], null, {}, "elementary", ["high"], ["middle","unknown"]]) {
    assert.throws(() => validateSchoolLevels(value), /학교급/);
  }
  assert.equal(schoolLevelsLabel('["elementary","middle"]'), "초등학교·중학교");
});

test("the elementary import contains 73 ordered schools and no plain institution passwords", async () => {
  const roster = JSON.parse(await readFile(new URL("data/elementary-schools.json", root), "utf8"));
  const seed = await readFile(new URL("drizzle/0010_elementary_schools.sql", root), "utf8");
  assert.equal(roster.length, 73);
  assert.equal(new Set(roster.map(row => row.name)).size, 73);
  assert.equal(roster[0].name, "인천만수초등학교");
  assert.equal(roster[41].name, "인천새말초등학교");
  assert.equal(roster[42].name, "인천서창초등학교");
  assert.equal(roster[71].name, "인천송빛초등학교");
  assert.equal(roster[72].name, "인천박문초등학교");
  assert.doesNotMatch(seed + JSON.stringify(roster), /동[나너]\d{2}|ehds[kj]\d{2}|SCHOOL_PASSWORD_PEPPER/iu);
  assert.doesNotMatch(seed, /\b(?:DELETE|UPDATE|DROP|REPLACE)\b/iu);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const folder = new URL("drizzle/", root);
    for (const file of (await readdir(folder)).filter(name => name.endsWith(".sql")).sort()) {
      db.exec(await readFile(new URL(file, folder), "utf8"));
    }
    const actual = db.prepare("SELECT id,name,display_order AS displayOrder,school_level AS schoolLevel FROM schools WHERE school_level='elementary' ORDER BY display_order").all().map(row => ({...row}));
    assert.deepEqual(actual, roster);
    assert.deepEqual(actual.map(row => row.displayOrder), Array.from({length:73}, (_,i) => i+1));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM schools WHERE school_level='middle'").get().n, 42);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM tournaments").get().n, 1, "adding schools must not create any new survey");
    assert.deepEqual(db.prepare("SELECT DISTINCT school_levels FROM tournaments").all().map(row => row.school_levels), ['["middle"]']);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM schools WHERE school_level='elementary' AND password_iterations=25000 AND length(password_salt)>20 AND length(password_hash)>40").get().n,73);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
