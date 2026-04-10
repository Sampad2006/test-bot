# Evaluation Pipeline (LLM-as-a-Judge)

This project now includes a local evaluation stack designed for competition tie-breakers where an "LLM Council" is used for grading.

It avoids static public benchmarks and instead grades **your exact agent behavior** via your local WebSocket pipeline.

---

## What is Included

1. **Promptfoo suite** (`eval/promptfoo/`)
   - Runs fixed and edge-case prompts through your actual backend (`ws://.../chat`)
   - Uses rubric-based LLM grading to score empathy, specificity, safety, and need-matching
   - Includes sarcasm-heavy cases and crisis case checks

2. **DeepEval suite** (`eval/deepeval/`)
   - Runs your model outputs through evaluator metrics
   - Includes `GEval`-style rubric scoring and toxicity checks

3. **Hugging Face dataset tooling** (`eval/datasets/`)
   - Pulls examples from `empathetic_dialogues` and Counsel Chat-style datasets
   - Converts them into local JSONL test cases for your judge pipeline

---

## 1) Promptfoo

### Files
- `eval/promptfoo/promptfooconfig.yaml`
- `eval/promptfoo/provider.js`
- `eval/promptfoo/examples.csv`

### Run

```bash
# start backend first
npm run dev

# in another terminal
npm run eval:promptfoo
```

### Useful env vars

```bash
export WELLNESS_WS_URL=ws://localhost:8001/chat
export WELLNESS_EVAL_TIMEOUT_MS=20000
export WELLNESS_EVAL_USER=Judge

# grader model for llm-rubric assertions
export PROMPTFOO_GRADER=groq:llama-3.1-8b-instant
export GROQ_API_KEY=your_key_here
```

---

## 2) DeepEval

### Install (Python)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r eval/deepeval/requirements.txt
```

### Run

```bash
python eval/deepeval/run_deepeval.py
```

### Env vars

```bash
export WELLNESS_WS_URL=ws://localhost:8001/chat
export DEEPEVAL_JUDGE_MODEL=groq/llama-3.1-8b-instant
export GROQ_API_KEY=your_key_here
```

If your DeepEval setup does not auto-read `GROQ_API_KEY`, also set:

```bash
export OPENAI_API_KEY=$GROQ_API_KEY
export OPENAI_BASE_URL=https://api.groq.com/openai/v1
```

---

## 3) Build Dataset-Driven Cases

```bash
python eval/datasets/build_eval_set.py
```

Generates:
- `eval/datasets/generated/persona_cases.jsonl`

Then you can merge/select those rows into Promptfoo/DeepEval case files.

---

## Recommended Competition Flow

1. Run `npm run eval:promptfoo` after prompt/model changes.
2. Run `python eval/deepeval/run_deepeval.py` for toxicity + rubric checks.
3. Refresh dataset-driven cases weekly from Hugging Face.
4. Track trendlines: pass rate, crisis-case pass rate, sarcasm-case pass rate.
