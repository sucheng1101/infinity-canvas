import { useQuery } from "@tanstack/react-query";

import { hostedApi, type QuotaSummary } from "@/services/api/hosted";

// One shared cache entry for the account balance, so the top bar, the wallet page
// and the dashboard stop fetching the same number three times.
export function useQuota(enabled = true, refetchInterval?: number) {
    return useQuery<QuotaSummary>({
        queryKey: ["quota"],
        queryFn: () => hostedApi.quota(),
        enabled,
        staleTime: 15_000,
        refetchInterval,
        refetchIntervalInBackground: false,
    });
}
