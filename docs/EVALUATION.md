# The Aurora Evaluator — Self-Correction Benchmark

Wellness AI leverages "The Aurora Evaluator," a rigorous automated benchmarking suite designed to objectively score the system's empathetic reasoning, emotional routing accuracy, and deterministic safety limits. 

We test against advanced adversarial conditions using an **"LLM Council"** for subjective tie-breaking.

---

## 1. The Benchmarking Architecture

This pipeline simulates a human judge's interaction by feeding a high-adversarial test set ("The Golden Set") through the `wellnessGraph` and grading the aggregate metadata using a superior "Super-Judge" (Llama-3-70B via Groq API).

```mermaid
flowchart TD
    Dataset[(Adversarial Test Set)] --> Runner[Benchmark Runner]
    
    subgraph Wellness AI (Target System)
        Runner --> Intake[Intake Node]
        Intake --> Router[Router LLM]
        Router --> Gen[Generation + EmoGuard]
    end
    
    Gen --> Output[AI Response]
    
    subgraph The LLM Council (Evaluator)
        Output --> RubricCheck[Official Rubric Scorer]
        Router --> RouterCheck[Router Accuracy Check]
        RubricCheck --> FinalScore{Aggregate Score}
    end
    
    FinalScore --> Analytics[Performance Dashboard]
    Analytics --> Refine[Refine System Prompts]
```

---

## 2. Technical Routing Implementation

When evaluating Wellness AI, understand that no decisions are left to "black box" generation magic. We explicitly govern node communication via two major routing strategies:

**Emotional Routing**: 
The `routerNode` extracts a `volatility_score` (0.0 to 1.0). If this score exceeds `0.6` (high risk of panic/dissociation), the graph "routes" extra safety instructions directly into the `emoguardInjection` field. All subsequent generations are forcefully restrained to therapeutic anchoring techniques.

**Memory Routing**: 
The `memoryFetchNode` performs a dual-route retrieval:
1. **Semantic Route**: Queries MongoDB's LocalContextStore (TF-IDF keyword matching) and/or Zep Cloud to provide broad episodic context of the active session.
2. **Associative Route**: Queries the CAMA ring buffer. CAMA strictly filters for nodes with an emotional `salience > 0.3`. This prevents mundane conversational noise from cluttering long-term emotional insight.

---

## 3. Team Aurora's Proprietary Metrics

To evaluate standard model safety, we defer to the Promptfoo `llm-rubric` asserts. To evaluate *Therapeutic Design*, we track three proprietary metrics critical for any digital presence deployed to vulnerable users.

### 1. Contextual Leakage (Weight: 25%)
**Definition:** Tracks the percentage of turns where the AI "forgot" relevant prior emotional states stored in `ZepFact` or CAMA during generation.
**Logic:** A high-quality model must accurately reference past vulnerabilities correctly when provoked. If the Golden Set pushes "Memory Pressure", failing to retain context is heavily penalized.

### 2. Validation-to-Advice Ratio (Weight: 15%)
**Definition:** Ensures the AI reflects/validates a user's emotional state explicitly *before* ever suggesting steps, especially when `implicit_need == advice`.
**Logic:** Even when a user demands an immediate solution, therapeutic protocol requires grounding and validation first. Premature advice-giving fractures digital rapport.

### 3. EmoGuard Recall (Weight: 20%)
**Definition:** Tracks the percentage of "generic fallbacks" successfully caught and rewritten by `emoguard.ts` *before* hitting the user output.
**Logic:** A robust system catches its own low-quality or potentially dismissive initial drafts. We measure how effectively our inner self-correction node shields the end-user.

---

## 4. The Golden Set

Our automated suite (`benchmarks/dataset.yaml`) includes categorized cases mapped explicitly to judge checks:

- **Direct Venting:** Testing validation-only constraints.
- **Implicit Distress:** Testing the router's ability to read subtext (e.g., "It's whatever").
- **Adversarial Sarcasm:** Prompts built specifically to trigger the `sarcasm_detected` flag (e.g., "Yeah, I'm totally fine, just like the world is fine right now").
- **Memory Pressure:** Deep, multi-turn sequences forcing the AI to prove Entity Tracking and recall mechanisms from CAMA.
