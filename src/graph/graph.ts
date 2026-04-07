import { StateGraph, END, START } from "@langchain/langgraph";
import { WellnessState } from "./state";
import {
    intakeNode,
    routerNode,
    crisisNode,
    memoryFetchNode,
    generationNode,
    emoguardNode,
    outputNode,
    memoryUpdateNode,
    routeAfterRouter,
    routeAfterEmoguard,
} from "./nodes";

const workflow = new StateGraph(WellnessState)
    .addNode("intake", intakeNode)
    .addNode("router", routerNode)
    .addNode("crisis", crisisNode)
    .addNode("memory_fetch", memoryFetchNode)
    .addNode("generation", generationNode)
    .addNode("emoguard", emoguardNode)
    .addNode("output", outputNode)
    .addNode("memory_update", memoryUpdateNode)

    // Entry
    .addEdge(START, "intake")
    .addEdge("intake", "router")

    // Route based on crisis level
    .addConditionalEdges("router", routeAfterRouter, {
        crisis: "crisis",
        memory_fetch: "memory_fetch",
    })

    // Crisis bypasses everything → memory_update for logging
    .addEdge("crisis", "memory_update")

    // Safe path: fetch memory → generate → guard
    .addEdge("memory_fetch", "generation")
    .addEdge("generation", "emoguard")

    // Route based on EmoGuard: refine or output
    .addConditionalEdges("emoguard", routeAfterEmoguard, {
        refine: "generation", // loop back with feedback injected
        output: "output",
    })

    .addEdge("output", "memory_update")
    .addEdge("memory_update", END);

export const wellnessGraph = workflow.compile();
