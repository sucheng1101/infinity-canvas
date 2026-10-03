import { Button, Card, Descriptions, Tag } from "antd";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";

export default function UserSettingsPage() {
    const user = useAuthStore((state) => state.user);
    const navigate = useNavigate();
    return <div className="h-full overflow-y-auto px-4 py-5 sm:px-7 sm:py-7"><div className="mx-auto max-w-4xl"><div className="mb-6"><div className="text-xs font-medium uppercase tracking-[.22em] text-orange-600">ACCOUNT SETTINGS</div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em]">个人设置</h1><p className="mt-1 text-sm text-stone-500">查看账户信息与账户操作</p></div><Card title="账户信息"><Descriptions column={1} items={[{ label: "用户名", children: user?.username || "-" }, { label: "邮箱", children: user?.email || "-" }, { label: "账户状态", children: <Tag color={user?.status === "active" ? "success" : "warning"}>{user?.status === "active" ? "正常" : user?.status || "-"}</Tag> }, { label: "账户角色", children: user?.role === "admin" ? "管理员" : "普通用户" }]} /></Card><Card className="mt-4" title="账户操作"><Button danger icon={<LogOut className="size-4" />} onClick={() => void useAuthStore.getState().logout().then(() => navigate("/login", { replace: true }))}>退出登录</Button></Card></div></div>;
}
