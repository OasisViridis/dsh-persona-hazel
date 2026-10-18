"""Build a JSONL manifest for THCHS-30 (Apache-2.0, Mandarin, ~34h).

Usage:
  python scripts/prepare-thchs30-manifest.py <extracted-thchs30-root> <out.jsonl> [--limit N]

The corpus is not copied into this repository; the manifest only references
audio paths under the local root. THCHS-30 is a generic Mandarin corpus: it is
NOT Hazel's voice and must not be described as such.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import wave
from pathlib import Path


def read_text(trn: Path) -> str:
    for line in trn.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line:
            return line
    return ""


def read_split_lists(root: Path) -> dict[str, str]:
    """Map wav stem -> split from train/dev/test lists, when present."""
    mapping: dict[str, str] = {}
    for split in ("train", "dev", "test"):
        for name in (f"{split}.list", f"{split}.lst"):
            path = root / name
            if not path.exists():
                continue
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                # Lists may contain a path or just a stem; normalize to stem.
                stem = Path(line).stem
                mapping.setdefault(stem, split)
    return mapping


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as fh:
        frames = fh.getnframes()
        rate = fh.getframerate()
        return frames / float(rate) if rate else 0.0


def deterministic_split(stem: str) -> str:
    """THCHS-30 的 tarball 没有 train/dev/test 列表，用 stem 的稳定哈希做 90/5/5 切分。"""
    bucket = int(hashlib.sha1(stem.encode("utf-8")).hexdigest()[:8], 16) % 100
    if bucket < 90:
        return "train"
    if bucket < 95:
        return "dev"
    return "test"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--limit", type=int, default=0, help="only write the first N clips (debug)")
    args = parser.parse_args()

    root = args.root.resolve()
    wavs = sorted(root.rglob("*.wav"))
    if not wavs:
        raise SystemExit(f"no .wav files under {root}; extract data_thchs30.tgz first")
    splits = read_split_lists(root)

    rows = []
    seen_stems = set()
    total_seconds = 0.0
    by_split: dict[str, int] = {}
    for wav in wavs:
        if args.limit and len(rows) >= args.limit:
            break
        if wav.stem in seen_stems:
            # tarball 里 train/dev/test 目录与 data/ 有重复；同一 stem 只收一次。
            continue
        # THCHS-30 的标注是 <stem>.wav.trn，不是 <stem>.trn。
        trn = wav.with_name(wav.name + ".trn")
        if not trn.exists():
            trn = wav.with_suffix(".trn")
        if not trn.exists():
            continue
        text = read_text(trn)
        if not text:
            continue
        seen_stems.add(wav.stem)
        duration = wav_duration(wav)
        split = splits.get(wav.stem) or deterministic_split(wav.stem)
        rows.append(
            {
                "audio": str(wav.relative_to(root)).replace("\\", "/"),
                "text": text,
                "speaker": wav.stem.split("_", 1)[0],
                "split": split,
                "duration": round(duration, 3),
            }
        )
        total_seconds += duration
        by_split[split] = by_split.get(split, 0) + 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"clips   : {len(rows)}")
    print(f"hours   : {total_seconds / 3600:.2f}")
    print(f"splits  : {by_split}")
    print(f"out     : {args.out}")


if __name__ == "__main__":
    main()
