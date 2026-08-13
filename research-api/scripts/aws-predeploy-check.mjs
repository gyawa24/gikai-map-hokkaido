import { spawnSync } from "node:child_process";

const region = process.env.AWS_REGION?.trim() || "ap-northeast-1";
const profile = process.env.AWS_PROFILE?.trim();
const modelId = process.env.BEDROCK_MODEL_ID?.trim();
const allowedModelArns = (process.env.ALLOWED_BEDROCK_MODEL_ARNS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const profileArgs = profile ? ["--profile", profile] : [];

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, AWS_PAGER: "" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "command failed")
      .trim()
      .split("\n")
      .slice(-2)
      .join(" ");
    throw new Error(`${command} ${args[0] ?? ""}: ${detail}`);
  }
  return result.stdout.trim();
}

function aws(args, commandRegion = region) {
  return run("aws", [
    ...args,
    "--region",
    commandRegion,
    ...profileArgs,
    "--no-cli-pager",
  ]);
}

function redactAccount(account) {
  return account.length > 4 ? `********${account.slice(-4)}` : "configured";
}

console.log(`AWS read-only preflight: region=${region}, profile=${profile || "default"}`);
run("sam", ["--version"]);
run("aws", ["--version"]);

let identity;
try {
  identity = JSON.parse(
    aws(["sts", "get-caller-identity", "--output", "json"]),
  );
} catch (error) {
  console.error("NG AWS認証を確認できません。aws configure sso等で検証用アカウントへ認証してください。");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
console.log(`OK AWS identity: account=${redactAccount(String(identity.Account ?? ""))}`);

const modelList = JSON.parse(
  aws([
    "bedrock",
    "list-foundation-models",
    "--by-output-modality",
    "TEXT",
    "--output",
    "json",
  ]),
);
const models = Array.isArray(modelList.modelSummaries)
  ? modelList.modelSummaries
  : [];
console.log(`OK Bedrock control plane: textModels=${models.length}`);

let failed = false;
let requiredModelArns = [];
if (!modelId) {
  console.error("NG BEDROCK_MODEL_ID が未指定です。");
  failed = true;
} else {
  const directModel = models.find((model) => model.modelId === modelId);
  if (directModel) {
    console.log(`OK Bedrock foundation model: ${directModel.modelName} (${modelId})`);
    if (typeof directModel.modelArn === "string") {
      requiredModelArns = [directModel.modelArn];
    }
  } else {
    try {
      const profileResult = JSON.parse(
        aws([
          "bedrock",
          "get-inference-profile",
          "--inference-profile-identifier",
          modelId,
          "--output",
          "json",
        ]),
      );
      console.log(`OK Bedrock inference profile: ${modelId}`);
      requiredModelArns = [
        ...(typeof profileResult.inferenceProfileArn === "string"
          ? [profileResult.inferenceProfileArn]
          : []),
        ...(Array.isArray(profileResult.models)
          ? profileResult.models
              .map((model) => model.modelArn)
              .filter((arn) => typeof arn === "string")
          : []),
      ];
    } catch {
      console.error(`NG BEDROCK_MODEL_ID を東京リージョンで確認できません: ${modelId}`);
      failed = true;
    }
  }
}

if (allowedModelArns.length === 0) {
  console.error("NG ALLOWED_BEDROCK_MODEL_ARNS が未指定です。");
  failed = true;
} else if (
  allowedModelArns.some(
    (arn) => !arn.startsWith("arn:aws:bedrock:") || arn.includes("*"),
  )
) {
  console.error("NG ALLOWED_BEDROCK_MODEL_ARNS はwildcardなしのBedrock ARNで指定してください。");
  failed = true;
} else {
  console.log(`OK least-privilege model ARNs: count=${allowedModelArns.length}`);
  const missingArns = requiredModelArns.filter(
    (requiredArn) => !allowedModelArns.includes(requiredArn),
  );
  if (missingArns.length > 0) {
    console.error("NG inference profileまたはbacking modelのARNが不足しています:");
    for (const arn of missingArns) console.error(`  ${arn}`);
    failed = true;
  }
}

try {
  const budgets = JSON.parse(
    aws([
      "budgets",
      "describe-budgets",
      "--account-id",
      String(identity.Account),
      "--max-results",
      "100",
      "--output",
      "json",
    ], "us-east-1"),
  );
  const budgetCount = Array.isArray(budgets.Budgets) ? budgets.Budgets.length : 0;
  if (budgetCount === 0) {
    console.error("NG AWS Budgetがありません。stack作成前に通知付きCost Budgetを設定してください。");
    failed = true;
  } else {
    console.log(`OK AWS Budgets: count=${budgetCount}`);
  }
} catch (error) {
  console.error("NG AWS Budgetを読み取れません。権限またはBudget設定を確認してください。");
  console.error(error instanceof Error ? error.message : String(error));
  failed = true;
}

if (failed) process.exit(1);
console.log("AWS read-only preflight passed. No resources were created or changed.");
