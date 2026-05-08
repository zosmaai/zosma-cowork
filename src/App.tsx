import { ChatView } from "@/chat/ChatView";
import { HomeView } from "@/components/HomeView";
import { useAuth } from "@/hooks/useAuth";
import { usePiStream } from "@/hooks/usePiStream";
import { useProviders } from "@/hooks/useProviders";
import { useEffect, useState } from "react";

function App() {
	const { state: streamState, startStream, abortStream } = usePiStream();
	const { models } = useProviders();
	const { hasCredentials, loading: authLoading, saveApiKey } = useAuth();
	const [showKeyEntry, setShowKeyEntry] = useState(false);

	const needsOnboarding = authLoading === false && !hasCredentials;

	// Auto-select first model
	const [activeModelId, setActiveModelId] = useState<string | undefined>();
	useEffect(() => {
		if (models.length > 0 && !activeModelId) {
			setActiveModelId(models[0].id);
		}
	}, [models, activeModelId]);

	const handleSend = async (text: string) => void startStream(text);

	const handleModelSelect = async (_provider: string, modelId: string) => {
		setActiveModelId(modelId);
	};

	const handleOnboardingComplete = async (apiKey: string) => {
		await saveApiKey(apiKey);
	};

	return (
		<div className="flex flex-col h-screen bg-background">
			{/* Header bar — only when authenticated */}
			{!needsOnboarding && (
				<header className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
					<div className="flex items-center gap-2">
						<h1 className="text-sm font-semibold text-foreground">Zosma Cowork</h1>
						<span className="text-xs text-muted-foreground">OpenCode Go</span>
					</div>
					<div className="flex items-center gap-2">
						{models.length > 0 && (
							<select
								className="text-xs bg-secondary text-foreground border border-border rounded px-2 py-1"
								value={activeModelId || ""}
								onChange={(e) => {
									const model = models.find((m) => m.id === e.target.value);
									if (model) handleModelSelect(model.provider, model.id);
								}}
							>
								{models.map((m) => (
									<option key={`${m.provider}/${m.id}`} value={m.id}>
										{m.id}
									</option>
								))}
							</select>
						)}
						<button
							type="button"
							className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
							onClick={() => setShowKeyEntry(!showKeyEntry)}
						>
							Change Key
						</button>
					</div>
				</header>
			)}

			{/* Main content */}
			<main className="flex-1 flex flex-col min-h-0">
				{needsOnboarding || showKeyEntry ? (
					<HomeView
						onComplete={async (apiKey) => {
							await handleOnboardingComplete(apiKey);
							setShowKeyEntry(false);
						}}
					/>
				) : (
					<ChatView
						messages={streamState.messages}
						streamingMessage={streamState.streamingMessage}
						isRunning={streamState.isRunning}
						status={streamState.status}
						error={streamState.error}
						onSend={handleSend}
						onAbort={() => abortStream()}
						onRetry={() => {
							const lastUser = [...streamState.messages].reverse().find((m) => m.role === "user");
							if (lastUser?.content) handleSend(lastUser.content);
						}}
						models={models}
						currentModelId={activeModelId}
						onModelSelect={handleModelSelect}
					/>
				)}
			</main>
		</div>
	);
}

export default App;
