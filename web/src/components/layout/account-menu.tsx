import { CreditCard, LogOut, Settings2, UserRound } from "lucide-react";
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
                    { key: "email", label: <span className="block max-w-56 truncate text-xs text-stone-500 dark:text-stone-400">{user.username || user.email}</span>, disabled: true },
                    { type: "divider" },
                    { key: "billing", icon: <CreditCard className="size-4" />, label: "额度与充值", onClick: () => navigate("/billing") },
                    ...(user.role === "admin" ? [{ key: "admin", icon: <Settings2 className="size-4" />, label: "运营控制台", onClick: () => navigate("/admin") }] : []),
                    { key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", onClick: () => void logout().then(() => navigate("/login", { replace: true })) },
                ],
            }}
        >
            <Button type="text" className="!h-8 !px-2" icon={<UserRound className="size-4" />}><span className="hidden max-w-32 truncate text-xs sm:inline">{user.username || user.email}</span></Button>
        </Dropdown>
    );
}
