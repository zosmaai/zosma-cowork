/**
 * Event Bus — shared event emitter for sidecar events.
 *
 * The sidecar's `send()` function writes JSON lines to stdout (consumed by the
 * Tauri Rust backend). This EventBus lets other consumers (like the HTTP/WS
 * remote server) subscribe to the same events without intercepting stdout.
 *
 * Usage:
 *   import { eventBus } from "./event-bus.js";
 *   eventBus.on("event", (data) => { ... });
 *   eventBus.emit("event", data);
 */

import { EventEmitter } from "node:events";

export type BusEvent =
	| { type: "event"; data: Record<string, unknown> }
	| { type: "result"; id: string; data: unknown; sessionFile?: string }
	| { type: "done"; id: string; sessionFile?: string }
	| {
			type: "error";
			id: string;
			message: string;
			sessionFile?: string;
			code?: string;
			retryable?: boolean;
			details?: string;
		}
	| { type: "ready" };

class EventBus {
	private emitter = new EventEmitter();
	// Cap listeners to detect leaks
	private maxListeners = 50;

	constructor() {
		this.emitter.setMaxListeners(this.maxListeners);
	}

	/**
	 * Publish an event to all subscribers.
	 * Called by the sidecar's `send()` function.
	 */
	publish(event: BusEvent): void {
		this.emitter.emit("message", event);
	}

	/**
	 * Subscribe to all events.
	 * Called by WebSocket server to broadcast to connected clients.
	 */
	subscribe(callback: (event: BusEvent) => void): () => void {
		this.emitter.on("message", callback);
		return () => {
			this.emitter.off("message", callback);
		};
	}

	/**
	 * Subscribe to a specific event type.
	 */
	on<K extends BusEvent["type"]>(
		type: K,
		callback: (event: Extract<BusEvent, { type: K }>) => void,
	): () => void {
		const handler = (event: BusEvent) => {
			if (event.type === type) {
				callback(event as Extract<BusEvent, { type: K }>);
			}
		};
		this.emitter.on("message", handler);
		return () => {
			this.emitter.off("message", handler);
		};
	}

	/** Number of active subscribers */
	get listenerCount(): number {
		return this.emitter.listenerCount("message");
	}
}

/** Singleton event bus for the sidecar process */
export const eventBus = new EventBus();
