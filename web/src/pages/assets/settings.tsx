import { App, Button, Card, Descriptions, Select, Space, Tag } from "antd";
import { LogOut, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { isHostedMode } from "@/lib/app-mode";
import { hostedApi, type StorageOption } from "@/services/api/hosted";
import { useAuthStore } from "@/stores/use-auth-store";

export default function UserSettingsPage() {
    const user = useAuthStore((state) => state.user);
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [options, setOptions] = useState<StorageOption[]>([]);
    const [current, setCurrent] = useState("");
    const [choice, setChoice] = useState("");
    const [inheritDefault, setInheritDefault] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        const data = await hostedApi.storageOptions();
        setOptions(data.items);
        setCurrent(data.current);
        setInheritedState(data.inherited, data.current);
    };

    const setInheritedState = (inherited: boolean, value: string) => {
        setInheritDefault(inherited);
        setChoice(inherited ? "" : value);
    };

    useEffect(() => {
        if (!isHostedMode || !user) return;
        void load().catch(() => undefined);
    }, [user]);

    const saveStorage = async () => {
        setSaving(true);
        try {
            await hostedApi.chooseStorage(choice);
            message.success("存储偏好已保存");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const currentName = options.find((item) => item.id === current)?.name || "-";

    return (
        <div className="h-full overflow-y-auto px-4 py-5 sm:px-7 sm:py-7">
            <div className="mx-auto max-w-4xl">
                <div className="mb-6">
                    <div className="text-xs font-medium uppercase tracking-[.22em] text-orange-600">ACCOUNT SETTINGS</div>
                    <h1 className="mt-2 text-2xl font-semibold tracking-[-.04em]">个人设置</h1>
                    <p className="mt-1 text-sm text-stone-500">查看账户信息与账户操作</p>
                </div>
                <Card title="账户信息">
                    <Descriptions
                        column={1}
                        items={[
                            { label: "用户名", children: user?.username || "-" },
                            { label: "邮箱", children: user?.email || "-" },
                            { label: "账户状态", children: <Tag color={user?.status === "active" ? "success" : "warning"}>{user?.status === "active" ? "正常" : user?.status || "-"}</Tag> },
                            { label: "账户角色", children: user?.role === "admin" ? "管理员" : "普通用户" },
                        ]}
                    />
                </Card>
                {isHostedMode ? (
                    <Card className="mt-4" title="文件存储" extra={!inheritDefault ? <Tag color="orange">已自选</Tag> : <Tag>跟随默认</Tag>}>
                        <p className="mb-3 text-sm text-stone-500">生成和上传的文件会存到这里。管理员启用了多个存储时，你可以选择自己使用哪一个。</p>
                        <Space wrap>
                            <Select
                                className="min-w-[260px]"
                                value={choice}
                                onChange={setChoice}
                                options={[{ value: "", label: `跟随管理员默认（当前：${currentName}）` }, ...options.map((item) => ({ value: item.id, label: `${item.name}（${item.driver === "s3" ? "S3 兼容" : "本地磁盘"}）` }))]}
                            />
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void saveStorage()}>
                                保存选择
                            </Button>
                        </Space>
                    </Card>
                ) : null}
                <Card className="mt-4" title="账户操作">
                    <Button danger icon={<LogOut className="size-4" />} onClick={() => void useAuthStore.getState().logout().then(() => navigate("/login", { replace: true }))}>
                        退出登录
                    </Button>
                </Card>
            </div>
        </div>
    );
}
