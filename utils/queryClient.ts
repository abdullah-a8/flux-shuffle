/**
 * Shared QueryClient Instance
 *
 * This module exports a singleton QueryClient instance that can be used
 * across the entire application, including both React components and
 * background services.
 *
 * Architecture:
 * - Single source of truth for query client configuration
 * - Accessible from React components via QueryClientProvider
 * - Accessible from background services via direct import
 * - Ensures consistent cache behavior across the app
 *
 * Usage:
 * - React components: Use via useQueryClient() hook (preferred)
 * - Background services: Import getQueryClient() directly
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Singleton QueryClient instance
 * Created once and reused throughout the application lifecycle
 */
let queryClientInstance: QueryClient | null = null;

/**
 * Create and configure the QueryClient with optimized defaults
 *
 * Configuration:
 * - staleTime: 5 minutes - reasonable balance between freshness and performance
 * - retry: 1 - single retry on failure to avoid excessive API calls
 * - gcTime: 10 minutes - keep unused data in cache for quick access
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
      },
      mutations: {
        retry: 1,
      },
    },
  });
}

/**
 * Get the singleton QueryClient instance
 *
 * This function ensures we always have exactly one QueryClient instance
 * across the entire application, preventing cache inconsistencies.
 *
 * @returns The singleton QueryClient instance
 */
export function getQueryClient(): QueryClient {
  if (!queryClientInstance) {
    queryClientInstance = createQueryClient();
  }
  return queryClientInstance;
}

/**
 * Export the instance directly for convenience
 * This allows `import { queryClient } from '@/utils/queryClient'`
 */
export const queryClient = getQueryClient();
