#!/usr/bin/env python3
import argparse
import subprocess
import sys
from pathlib import Path

MLX_WHISPER = Path.home() / ".local" / "bin" / "mlx_whisper"
MODEL = "mlx-community/whisper-large-v3-mlx"
INITIAL_PROMPT = "以下は日本語の議会音声です。千歳市、苫小牧市、国民民主党、令和、条例、補正予算、委員会、委託料"

HALLUCINATION_PHRASES = {
    "ご視聴ありがとうございました",
    "ご視聴ありがとうございます",
    "ご清聴ありがとうございました",
    "チャンネル登録お願いします",
    "字幕作成",
}

parser = argparse.ArgumentParser()
parser.add_argument("--file", required=True)
args = parser.parse_args()

input_path = Path(args.file).expanduser().resolve()
if not input_path.exists():
    print(f"✗ ファイルが見つかりません: {input_path}")
    sys.exit(1)

output_path = input_path.with_suffix(".txt")
print(f"文字起こし開始: {input_path.name}")

result = subprocess.run([
    str(MLX_WHISPER), str(input_path),
    "--model", MODEL,
    "--language", "ja",
    "--output-format", "txt",
    "--output-dir", str(input_path.parent),
    "--fp16", "False",
    "--no-speech-threshold", "0.6",
    "--compression-ratio-threshold", "2.4",
    "--condition-on-previous-text", "False",
    "--temperature", "0",
    "--initial-prompt", INITIAL_PROMPT,
])

if result.returncode != 0:
    print("✗ 失敗")
    sys.exit(1)

# 無音区間で発生するハルシネーション行を除去
original_lines = output_path.read_text(encoding="utf-8").splitlines()
cleaned_lines = [
    line for line in original_lines
    if line.strip() not in HALLUCINATION_PHRASES
]
removed = len(original_lines) - len(cleaned_lines)
if removed > 0:
    backup_path = output_path.with_suffix(".txt.bak")
    backup_path.write_text("\n".join(original_lines) + "\n", encoding="utf-8")
    output_path.write_text("\n".join(cleaned_lines) + "\n", encoding="utf-8")
    print(f"ハルシネーション {removed} 行を除去（バックアップ: {backup_path.name}）")

print(f"完了: {output_path}")
