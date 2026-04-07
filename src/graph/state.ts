import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { RouterOutput, MemoryNode, ZepFact, EmoGuardReport, CAMAConsole } from "../types";

// Helper: last-write-wins reducer for simple scalar/object fields
function lastValue<T>() {
    return (current: T, update: T): T => (update !== undefined ? update : current);
}

export const WellnessState = Annotation.Root({
    // Core conversation
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
    userId: Annotation<string>({ reducer: lastValue<string>(), default: () => "" }),
    userName: Annotation<string>({ reducer: lastValue<string>(), default: () => "there" }),
    currentMessage: Annotation<string>({ reducer: lastValue<string>(), default: () => "" }),

    // Router analysis
    routerOutput: Annotation<RouterOutput | null>({
        reducer: lastValue<RouterOutput | null>(),
        default: () => null,
    }),

    // Memory context
    camaNodes: Annotation<MemoryNode[]>({ reducer: lastValue<MemoryNode[]>(), default: () => [] }),
    camaConsole: Annotation<CAMAConsole>({
        reducer: lastValue<CAMAConsole>(),
        default: () => ({ core_beliefs: [], recurring_patterns: [], identity_facts: [] }),
    }),
    zepFacts: Annotation<ZepFact[]>({ reducer: lastValue<ZepFact[]>(), default: () => [] }),
    zepSummary: Annotation<string>({ reducer: lastValue<string>(), default: () => "" }),

    // Generation
    responseDraft: Annotation<string>({ reducer: lastValue<string>(), default: () => "" }),

    // EmoGuard
    emoguardReport: Annotation<EmoGuardReport | null>({
        reducer: lastValue<EmoGuardReport | null>(),
        default: () => null,
    }),
    emoguardSensitivity: Annotation<"LOW" | "MEDIUM" | "HIGH">({
        reducer: lastValue<"LOW" | "MEDIUM" | "HIGH">(),
        default: () => "MEDIUM",
    }),
    refineCount: Annotation<number>({ reducer: lastValue<number>(), default: () => 0 }),

    // Output
    finalResponse: Annotation<string>({ reducer: lastValue<string>(), default: () => "" }),
    isCrisis: Annotation<boolean>({ reducer: lastValue<boolean>(), default: () => false }),
});

export type WellnessStateType = typeof WellnessState.State;
