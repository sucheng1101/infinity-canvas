import { LogOut, UserRound } from "lucide-react";
import { Button, Dropdown } from "antd";
import { useNavigate } from "react-router-dom";

import { isHostedMode } from "@/lib/app-mode";
import { useAuthStore } from "@/stores/use-auth-store";

export function AccountMenu() {
    const navigate = useNavigate();
    const user = useAuthStore((state) => state.user);
    const logout = useAuthStore((state) => state.logout);
    if (!isHostedMode || !user) return null;

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                items: [
                    { key: "email", label: <span className="block max-w-56 truncate text-xs text-stone-500 dark:text-stone-400">{user.email}</span>, disabled: true },
                    { type: "divider" },
                    { key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", onClick: () => void logout().then(() => navigate("/login", { replace: true })) },
                ],
            }}
        >
            <Button type="text" className="!h-8 !px-2" icon={<UserRound className="size-4" />}><span className="hidden max-w-32 truncate text-xs sm:inline">{user.email}</span></Button>
        </Dropdown>
    );
}
