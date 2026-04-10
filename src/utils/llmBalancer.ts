import Groq from "groq-sdk";
import { config } from "../config";

interface Node {
    id: number;
    keyMask: string;
    groq: Groq;
    failures: number;
    cooldownUntil: number;
}

class LLMLoadBalancer {
    private nodes: Node[] = [];
    private currentIndex = 0;
    private maxRetries = 0;

    constructor(keys: string[]) {
        if (!keys || keys.length === 0) {
            throw new Error("No GROQ_API_KEYS provided to LoadBalancer");
        }
        
        // De-duplicate just in case
        const uniqueKeys = Array.from(new Set(keys));
        
        uniqueKeys.forEach((key, ix) => {
            this.nodes.push({
                id: ix + 1,
                keyMask: `...${key.slice(-4)}`,
                groq: new Groq({ apiKey: key }),
                failures: 0,
                cooldownUntil: 0
            });
        });
        
        this.maxRetries = this.nodes.length + 1;
        console.log(`[LoadBalancer] Initialized with ${this.nodes.length} underlying LLM nodes.`);
    }

    private getNextAvailableNode(): Node {
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[this.currentIndex];
            
            // Advance pointer immediately (Round-Robin)
            this.currentIndex = (this.currentIndex + 1) % this.nodes.length;

            // Circuit Breaker Check
            if (node.cooldownUntil > Date.now()) {
                continue; // This node is temporarily dead
            }
            
            return node;
        }
        
        // If all nodes are dead, just return the next one blindly to see if they recovered early
        // Or if the network is just totally down.
        this.currentIndex = (this.currentIndex + 1) % this.nodes.length;
        return this.nodes[this.currentIndex];
    }

    /**
     * Drop-in replacement wrapper for groq.chat.completions.create
     */
    public async createChatCompletion(params: any): Promise<any> {
        let attempts = 0;
        let lastError: any = null;

        while (attempts < this.maxRetries) {
            const node = this.getNextAvailableNode();
            
            try {
                const response = await node.groq.chat.completions.create(params);
                
                // Success! Reset failures.
                if (node.failures > 0) {
                    node.failures = 0;
                    node.cooldownUntil = 0;
                }
                
                return response;
            } catch (error: any) {
                lastError = error;
                const status = error?.status || error?.response?.status;
                
                // 429: Too Many Requests (Rate limit hit)
                // 503: Service Unavailable
                if (status === 429 || status === 503 || status === 401) {
                    node.failures += 1;
                    console.warn(`[LoadBalancer] Node ${node.id} (${node.keyMask}) failed with ${status}. Attempt ${attempts + 1}/${this.maxRetries}`);
                    
                    if (node.failures >= 3) {
                        console.error(`[LoadBalancer] CIRCUIT OPEN: Node ${node.id} down. Banning for 5 minutes.`);
                        node.cooldownUntil = Date.now() + (5 * 60 * 1000);
                    }
                    
                    console.log(`[LoadBalancer] Switching to Node ${this.nodes[this.currentIndex].id} (${this.nodes[this.currentIndex].keyMask})...`);
                    attempts++;
                } else {
                    // For standard bad requests (e.g., 400 Bad Request, context window exceeded), don't retry across all nodes.
                    // Just fail immediately.
                    console.error(`[LoadBalancer] Fatal non-retryable error on Node ${node.id}:`, error?.message || error);
                    throw error;
                }
            }
        }
        
        console.error("[LoadBalancer] ALL NODES EXHAUSTED.");
        throw lastError;
    }
}

// Export singleton instance
export const llmBalancer = new LLMLoadBalancer(config.groqApiKeys);
