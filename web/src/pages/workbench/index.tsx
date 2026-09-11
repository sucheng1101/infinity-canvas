import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Segmented } from "antd";
import { ImagePlus, Video } from "lucide-react";

import ImagePage from "@/pages/image";
import VideoPage from "@/pages/video";

type WorkbenchMode = "image" | "video";

export default function WorkbenchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [mode, setMode] = useState<WorkbenchMode>(searchParams.get("mode") === "video" ? "video" : "image");
    const changeMode = (value: WorkbenchMode) => {
        setMode(value);
        setSearchParams(value === "video" ? { mode: "video" } : {}, { replace: true });
    };
    return (
        <div className="relative h-full">
            <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
                <div className="pointer-events-auto rounded-lg border border-stone-200 bg-background/95 p-1 shadow-sm backdrop-blur dark:border-stone-800">
                    <Segmented
                        value={mode}
                        onChange={(value) => changeMode(value as WorkbenchMode)}
                        options={[
                            { value: "image", label: <span className="flex items-center gap-1.5"><ImagePlus className="size-3.5" />图片创作</span> },
                            { value: "video", label: <span className="flex items-center gap-1.5"><Video className="size-3.5" />视频创作</span> },
                        ]}
                    />
                </div>
            </div>
            {mode === "image" ? <ImagePage /> : <VideoPage />}
        </div>
    );
}
