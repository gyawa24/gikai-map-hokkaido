#!/bin/bash
cd /Users/yohei/gikai-map-hokkaido
MLX=/Users/yohei/.local/bin/mlx_whisper
MODEL=mlx-community/whisper-large-v3-turbo

for id in r8-teireikai1-day3-20260310 r8-teireikai1-day4-20260311 r8-teireikai1-day6-20260313 r8-yosan-6th-20260325; do
  echo "=== $id ==="
  $MLX tmp_audio/${id}.mp3 --model $MODEL --language ja --output-format json --output-dir tmp_audio --fp16 False --no-speech-threshold 0.1
  echo "--- done: $id ---"
done
