#!/usr/bin/env python3
import json
import random
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "eval" / "datasets" / "generated"
OUT_FILE = OUT_DIR / "persona_cases.jsonl"


def normalize_text(value: str) -> str:
    return " ".join((value or "").strip().split())


def load_empathetic_dialogues(max_rows: int):
    try:
        from datasets import load_dataset
    except Exception as exc:
        raise SystemExit(
            "Missing dependency `datasets`. Run: pip install datasets\n"
            f"Original error: {exc}"
        )

    ds = load_dataset("empathetic_dialogues", split="train")
    rows = []
    for item in ds.shuffle(seed=42).select(range(min(max_rows, len(ds)))):
        utterance = normalize_text(item.get("utterance", ""))
        if len(utterance) < 15:
            continue
        rows.append(
            {
                "source": "empathetic_dialogues",
                "input": utterance,
                "expected_need": "validation",
                "expected_behavior": "Respond with specific empathy and emotional reflection before advice.",
                "meta": {
                    "context": item.get("context"),
                    "emotion": item.get("prompt"),
                },
            }
        )
    return rows


def load_counselchat_like(max_rows: int):
    try:
        from datasets import load_dataset
    except Exception as exc:
        raise SystemExit(
            "Missing dependency `datasets`. Run: pip install datasets\n"
            f"Original error: {exc}"
        )

    # Community mirror often available as 'Amod/mental_health_counseling_conversations'
    ds = load_dataset("Amod/mental_health_counseling_conversations", split="train")
    rows = []
    for item in ds.shuffle(seed=13).select(range(min(max_rows, len(ds)))):
        question = normalize_text(item.get("Context", ""))
        if len(question) < 20:
            continue
        rows.append(
            {
                "source": "mental_health_counseling_conversations",
                "input": question,
                "expected_need": "connection",
                "expected_behavior": "Acknowledge emotional context and provide grounded, non-judgmental support.",
                "meta": {
                    "reference_response": normalize_text(item.get("Response", ""))[:400],
                },
            }
        )
    return rows


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    empathetic_rows = load_empathetic_dialogues(max_rows=80)
    counseling_rows = load_counselchat_like(max_rows=80)

    all_rows = empathetic_rows + counseling_rows
    random.Random(7).shuffle(all_rows)

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        for i, row in enumerate(all_rows, 1):
            payload = {
                "id": f"ds_{i:04d}",
                **row,
            }
            f.write(json.dumps(payload, ensure_ascii=True) + "\n")

    print(f"Wrote {len(all_rows)} cases to {OUT_FILE}")


if __name__ == "__main__":
    main()
