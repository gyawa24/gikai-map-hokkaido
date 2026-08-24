#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(SCRIPT_DIR, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const SHARD_DIR = path.join(SITE_DIR, "public", "generated", "member-activity");
const MAX_SHARD_BYTES = 1024 * 1024;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedName(value) {
  return String(value ?? "").replace(/\s/g, "");
}

const municipalities = readJson(path.join(DATA_DIR, "municipalities.json"))
  .filter((municipality) => municipality.active);
const rootManifest = readJson(path.join(SHARD_DIR, "manifest.json"));
invariant(rootManifest.version === 1, "member activity root manifest version mismatch");
invariant(rootManifest.count === municipalities.length, "member activity city count mismatch");

const expectedRootCities = new Set(municipalities.map((municipality) => municipality.slug));
const actualRootCities = new Set(rootManifest.cities.map((entry) => entry.city));
invariant(
  isDeepStrictEqual(actualRootCities, expectedRootCities),
  "member activity root manifest municipality coverage mismatch"
);

let shardCount = 0;
let activityCount = 0;
let maxShard = { bytes: 0, path: "" };

for (const municipality of municipalities) {
  const city = municipality.slug;
  const minutesRestricted = municipality.minutes_access === "restricted";
  const members = readJson(path.join(DATA_DIR, city, "members.json"));
  const sourceActivityPath = path.join(DATA_DIR, city, "members_activity.json");
  const sourceActivity = fs.existsSync(sourceActivityPath) ? readJson(sourceActivityPath) : {};
  const cityDir = path.join(SHARD_DIR, city);
  const cityManifest = readJson(path.join(cityDir, "manifest.json"));
  const expectedFiles = new Set(["manifest.json"]);
  const expectedSourceKeys = new Set();
  const seenSeats = new Set();
  const invalidMembers = [];
  let cityActivityCount = 0;

  for (const member of members) {
    const memberName = String(member?.name ?? "").trim();
    const sourceKey = normalizedName(memberName);
    expectedSourceKeys.add(sourceKey);
    const seatNumber = Number(member?.seat_number);
    if (!Number.isInteger(seatNumber) || seatNumber <= 0) {
      invalidMembers.push({ member_name: memberName, seat_number: member?.seat_number ?? null });
      continue;
    }
    invariant(!seenSeats.has(seatNumber), `${city}: duplicate seat_number ${seatNumber}`);
    seenSeats.add(seatNumber);

    const fileName = `${seatNumber}.json`;
    const filePath = path.join(cityDir, fileName);
    expectedFiles.add(fileName);
    invariant(fs.existsSync(filePath), `${city}: member activity shard is missing: ${fileName}`);
    const payload = readJson(filePath);
    const sourceEntry = sourceActivity[sourceKey];
    const expectedActivity = minutesRestricted
      ? null
      : sourceEntry?.classification_status === "classified"
        ? sourceEntry
        : null;
    invariant(payload.version === 1, `${city}/${fileName}: version mismatch`);
    invariant(payload.city === city, `${city}/${fileName}: city mismatch`);
    invariant(payload.seat_number === seatNumber, `${city}/${fileName}: seat_number mismatch`);
    invariant(payload.member_name === memberName, `${city}/${fileName}: member_name mismatch`);
    invariant(
      payload.minutes_access === (minutesRestricted ? "restricted" : "public"),
      `${city}/${fileName}: minutes access mismatch`
    );
    invariant(
      isDeepStrictEqual(payload.activity, expectedActivity),
      `${city}/${fileName}: source activity mismatch`
    );

    const bytes = fs.statSync(filePath).size;
    invariant(bytes < MAX_SHARD_BYTES, `${city}/${fileName}: shard exceeds 1 MiB`);
    if (bytes > maxShard.bytes) maxShard = { bytes, path: `${city}/${fileName}` };
    shardCount += 1;
    if (expectedActivity !== null) {
      activityCount += 1;
      cityActivityCount += 1;
    }
  }

  const unexpectedSourceKeys = Object.keys(sourceActivity)
    .filter((key) => !expectedSourceKeys.has(normalizedName(key)));
  invariant(
    unexpectedSourceKeys.length === 0,
    `${city}: activity entries without a current member: ${unexpectedSourceKeys.join(", ")}`
  );

  const actualFiles = new Set(
    fs.readdirSync(cityDir).filter((fileName) => fileName.endsWith(".json"))
  );
  invariant(
    isDeepStrictEqual(actualFiles, expectedFiles),
    `${city}: missing or orphaned member activity shard`
  );
  invariant(cityManifest.version === 1, `${city}: manifest version mismatch`);
  invariant(
    cityManifest.minutes_access === (minutesRestricted ? "restricted" : "public"),
    `${city}: manifest minutes access mismatch`
  );
  invariant(cityManifest.count === seenSeats.size, `${city}: manifest count mismatch`);
  invariant(
    cityManifest.members.length === seenSeats.size,
    `${city}: manifest member list mismatch`
  );
  invariant(
    cityManifest.unsharded_members.length === invalidMembers.length,
    `${city}: unsharded member declaration mismatch`
  );

  const rootEntry = rootManifest.cities.find((entry) => entry.city === city);
  invariant(
    rootEntry?.minutes_access === (minutesRestricted ? "restricted" : "public"),
    `${city}: root manifest minutes access mismatch`
  );
  invariant(rootEntry?.count === seenSeats.size, `${city}: root manifest count mismatch`);
  invariant(
    rootEntry?.activity_count === cityActivityCount,
    `${city}: root manifest activity count mismatch`
  );
  invariant(
    rootEntry?.unsharded_count === invalidMembers.length,
    `${city}: root manifest unsharded count mismatch`
  );
}

console.log(
  `member activity shard verification passed: ${shardCount} members, ${activityCount} with activity, max ${maxShard.bytes} bytes (${maxShard.path})`
);
