import { useEffect, useState } from "react";

import { hostedApi, type PublishedModel } from "@/services/api/hosted";

export type HostedQualitySpec = NonNullable<PublishedModel["qualitySpec"]>;

export function useHostedModelQuality(capability: string, model: string) {
    const [spec, setSpec] = useState<HostedQualitySpec>();
    useEffect(() => {
        let active = true;
        void hostedApi.models(capability).then((result) => {
            if (!active) return;
            setSpec(result.items.find((item) => item.displayName === model)?.qualitySpec);
        }).catch(() => { if (active) setSpec(undefined); });
        return () => { active = false; };
    }, [capability, model]);
    return spec;
}
