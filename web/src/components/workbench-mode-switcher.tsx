import { Segmented } from "antd";
import { ImagePlus, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

export type WorkbenchMode = "image" | "video";

export function WorkbenchModeSwitcher({ mode, onChange }: { mode: WorkbenchMode; onChange: (mode: WorkbenchMode) => void }) {
    const { t } = useTranslation();

    return (
        <div className="inline-flex rounded-lg border border-stone-200 bg-background/95 p-1 shadow-sm backdrop-blur dark:border-stone-800">
            <Segmented
                size="small"
                value={mode}
                onChange={(value) => onChange(value as WorkbenchMode)}
                options={[
                    { value: "image", label: <span className="flex items-center gap-1.5"><ImagePlus className="size-3.5" />{t("imageWorkbench.title")}</span> },
                    { value: "video", label: <span className="flex items-center gap-1.5"><Video className="size-3.5" />{t("videoWorkbench.title")}</span> },
                ]}
            />
        </div>
    );
}
