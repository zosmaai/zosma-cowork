import { createAuthClient } from 'better-auth/client';
import { tokenStore } from '@/lib/token-store';

export const authClient = createAuthClient({
	baseURL: 'https://auth.zosma.ai',
	fetchOptions: {
		auth: {
			type: 'Bearer',
			token: () => tokenStore.getInMemory() ?? '',
		},
	},
});
