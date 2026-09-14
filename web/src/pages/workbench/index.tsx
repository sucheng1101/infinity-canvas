import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import ImagePage from "@/pages/image";
import VideoPage from "@/pages/video";
import { type WorkbenchMode } from "@/components/workbench-mode-switcher";

export default function WorkbenchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [mode, setMode] = useState<WorkbenchMode>(searchParams.get("mode") === "video" ? "video" : "image");
    const changeMode = (value: WorkbenchMode) => {
        setMode(value);
        setSearchParams(value === "video" ? { mode: "video" } : {}, { replace: true });
    };
    return (
        <div className="relative h-full">
            {mode === "image" ? <ImagePage workbenchMode={mode} onWorkbenchModeChange={changeMode} /> : <VideoPage workbenchMode={mode} onWorkbenchModeChange={changeMode} />}
        </div>
    );
}
