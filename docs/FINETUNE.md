# Fine-Tuning Guide

This document explains how to use the auto-collected conversation data to fine-tune an LLM via Groq's fine-tuning API for a domain-specific mental health support model.

---

## What Gets Collected

Every completed conversation turn is automatically appended to a daily JSONL file:

```
finetune_data/
└── turns_2026-04-09.jsonl
└── turns_2026-04-10.jsonl
...
```

Each line is a JSON object in **OpenAI chat format** (compatible with Groq):

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a warm, perceptive presence... [full dynamic prompt]"
    },
    {
      "role": "user",
      "content": "I've been feeling really overwhelmed lately..."
    },
    {
      "role": "assistant",
      "content": "Overwhelmed — not just stressed, but like everything is happening at once and there's no pause button..."
    }
  ],
  "_meta": {
    "timestamp": "2026-04-09T18:30:00.000Z",
    "userId": "user_1712680200000_ab3cd",
    "emotion": {
      "primary": "overwhelm",
      "secondary": "anxiety",
      "intensity": 0.72,
      "trajectory": "escalating"
    },
    "implicit_need": "venting",
    "crisis_level": 0,
    "volatility_score": 0.61
  }
}
```

> **Note**: The `_meta` field is NOT part of the Groq fine-tune format. Strip it before uploading.

---

## Data Collection Strategy

| Turno type | Included? | Notes |
|---|---|---|
| Normal responses | ✅ | Every successful turn |
| Crisis responses | ⚠️ | Included but clearly flagged (`crisis_level >= 4`) — review before using |
| EmoGuard-refined | ✅ | Only the final approved response is logged |
| Error responses | ❌ | Never logged |

---

## Step 1: Review & Filter Your Dataset

Before fine-tuning, inspect and clean the data:

```bash
# Count total turns collected
wc -l finetune_data/*.jsonl

# View a sample
head -n 5 finetune_data/turns_$(date +%Y-%m-%d).jsonl | python3 -m json.tool

# Filter out crisis turns (crisis_level >= 4) if desired
grep -v '"crisis_level": [45]' finetune_data/*.jsonl > filtered.jsonl

# Strip _meta field (required before uploading to Groq)
jq 'del(._meta)' finetune_data/*.jsonl > upload_ready.jsonl
```

---

## Step 2: Validate the Dataset

Groq requires at minimum **10 examples** for fine-tuning. Validate the format:

```bash
# Check each line is valid JSON with correct structure
python3 -c "
import json, sys
errors = 0
with open('upload_ready.jsonl') as f:
    for i, line in enumerate(f, 1):
        try:
            obj = json.loads(line)
            assert 'messages' in obj
            roles = [m['role'] for m in obj['messages']]
            assert roles == ['system', 'user', 'assistant'], f'Bad roles: {roles}'
        except Exception as e:
            print(f'Line {i}: {e}')
            errors += 1
print(f'Validated. Errors: {errors}')
"
```

---

## Step 3: Upload to Groq

```bash
# Upload the file
curl https://api.groq.com/openai/v1/files \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "purpose=fine-tune" \
  -F "file=@upload_ready.jsonl"

# Note the returned file_id, then create the fine-tune job
curl https://api.groq.com/openai/v1/fine_tuning/jobs \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "training_file": "<FILE_ID>",
    "model": "llama-3.1-8b-instant",
    "hyperparameters": {
      "n_epochs": 3
    }
  }'
```

---

## Step 4: Monitor Training

```bash
# List fine-tune jobs
curl https://api.groq.com/openai/v1/fine_tuning/jobs \
  -H "Authorization: Bearer $GROQ_API_KEY"

# Check specific job
curl https://api.groq.com/openai/v1/fine_tuning/jobs/<JOB_ID> \
  -H "Authorization: Bearer $GROQ_API_KEY"
```

---

## Step 5: Use the Fine-Tuned Model

Once training completes, Groq provides a `fine_tuned_model` ID. Update your `.env`:

```env
GROQ_MODEL=ft:llama-3.1-8b-instant:<your-fine-tune-id>
```

The server picks this up on next restart — no code changes needed.

---

## Data Quality Tips

### Good training examples (keep):
- Turns where the AI response specifically references the user's exact words
- Turns where the correct implicit need was detected and matched
- Responses that are 3–5 sentences, specific, non-generic

### Problematic examples (remove or review):
- `crisis_level >= 3` turns (high-stakes, may not generalize safely)
- Very short user messages ("ok", "yes", "thanks") — low signal
- Turns where the EmoGuard refinement count was 2 (indicates the model struggled)

### Filtering by metadata:

```bash
# Only keep turns with emotion intensity > 0.4 (higher signal examples)
python3 -c "
import json, sys
with open('finetune_data/turns_2026-04-09.jsonl') as inp, \
     open('high_quality.jsonl', 'w') as out:
    for line in inp:
        obj = json.loads(line)
        meta = obj.get('_meta', {})
        emotion = meta.get('emotion') or {}
        if (
            meta.get('crisis_level', 0) <= 2 and
            emotion.get('intensity', 0) > 0.4 and
            meta.get('implicit_need') != 'unknown'
        ):
            # Strip _meta before writing
            del obj['_meta']
            out.write(json.dumps(obj) + '\n')
print('Done.')
"
```

---

## Privacy & PII

> ⚠️ The `finetune_data/` directory is **gitignored** and should never be committed.

Before using data for fine-tuning:
1. Strip all `userId` references (already excluded from `messages[]`)
2. Redact any real names that appear in conversation text
3. Review for identifying information before uploading to any external service
4. Comply with applicable data protection laws (GDPR, DPDP Act, etc.)

Consider anonymisation before fine-tuning:
```bash
# Replace any remaining user IDs in _meta
sed 's/"userId": "user_[^"]*"/"userId": "REDACTED"/g' finetune_data/*.jsonl > anonymised.jsonl
```

---

## Recommended Training Schedule

| Dataset size | Recommended epochs | Notes |
|---|---|---|
| 10–50 examples | 5–10 | Very early, likely to overfit |
| 50–200 examples | 3–5 | Start seeing style adaptation |
| 200–500 examples | 2–3 | Good general fine-tuning range |
| 500+ examples | 1–3 | Robust fine-tuning, evaluate on held-out set |

Keep 10–20% of data as a **held-out validation set** — do not include in training.
