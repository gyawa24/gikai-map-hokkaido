import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const cwd = process.cwd();
  const minutesDir = path.join(cwd, "data", "chitose", "minutes");
  const indexPath = path.join(minutesDir, "index.json");

  const dirExists = fs.existsSync(minutesDir);

  let indexReadable = false;
  let indexCount: number | null = null;
  let indexError: string | null = null;

  if (dirExists) {
    try {
      const raw = fs.readFileSync(indexPath, "utf-8");
      const data = JSON.parse(raw);
      indexReadable = true;
      indexCount = Array.isArray(data) ? data.length : null;
    } catch (e) {
      indexError = String(e);
    }
  }

  return NextResponse.json({
    cwd,
    minutesDir,
    dirExists,
    indexPath,
    indexReadable,
    indexCount,
    indexError,
  });
}
