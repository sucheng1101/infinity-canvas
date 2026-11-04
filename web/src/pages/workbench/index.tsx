import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Spin } from "antd";

import { type WorkbenchMode } from "@/components/workbench-mode-switcher";

const ImagePage = lazy(() => import("@/pages/image"));
const VideoPage = lazy(() => import("@/pages/video"));

export default function WorkbenchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [mode, setMode] = useState<WorkbenchMode>(searchParams.get("mode") === "video" ? "video" : "image");
    const changeMode = (value: WorkbenchMode) => {
        setMode(value);
        setSearchParams(value === "video" ? { mode: "video" } : {}, { replace: true });
    };
    return (
        <div className="relative h-full">
            <Suspense fallback={<div className="grid h-full place-items-center"><Spin /></div>}>
                {mode === "image" ? <ImagePage workbenchMode={mode} onWorkbenchModeChange={changeMode} /> : <VideoPage workbenchMode={mode} onWorkbenchModeChange={changeMode} />}
            </Suspense>
        </div>
    );
}
