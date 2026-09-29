import { Alert, Button, Form, Input } from "antd";
import { ArrowRight, CheckCircle2, KeyRound, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { AuthShell } from "@/components/auth/auth-shell";
import { authApi, AuthApiError } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";

type Credentials = { username?: string; email: string; password: string; confirmPassword?: string; verificationCode?: string };

function useReturnPath() {
    const location = useLocation();
    const from = (location.state as { from?: string } | null)?.from;
    return from?.startsWith("/") ? from : "/app";
}

function ErrorAlert({ error }: { error: string }) { return error ? <Alert className="mb-5" type="error" showIcon message={error} /> : null; }
function SubmitButton({ loading, children }: { loading: boolean; children: string }) {
    return <Button htmlType="submit" type="primary" size="large" block disabled={loading} className="mt-2 !h-11"><span className="inline-flex items-center gap-2">{loading ? <LoaderCircle className="size-4 animate-spin" /> : null}{children}{loading ? null : <ArrowRight className="size-4" />}</span></Button>;
}

export function LoginPage() {
    const navigate = useNavigate();
    const returnPath = useReturnPath();
    const status = useAuthStore((state) => state.status);
    const bootstrap = useAuthStore((state) => state.bootstrap);
    const setUser = useAuthStore((state) => state.setUser);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [unverifiedEmail, setUnverifiedEmail] = useState("");
    const [resendSent, setResendSent] = useState(false);
    useEffect(() => { if (status === "idle") void bootstrap(); }, [bootstrap, status]);
    if (status === "authenticated") return <Navigate to={returnPath} replace />;
    const submit = async ({ email, password }: Credentials) => {
        setLoading(true); setError(""); setUnverifiedEmail("");
        try { const result = await authApi.login(email, password); setUser(result.user); navigate(returnPath, { replace: true }); }
        catch (requestError) { const authError = requestError as AuthApiError; setError(authError.message); if (authError.code === "AUTH_EMAIL_NOT_VERIFIED") setUnverifiedEmail(email); }
        finally { setLoading(false); }
    };
    const resend = async () => { setLoading(true); setError(""); try { await authApi.resendVerification(unverifiedEmail); setResendSent(true); } catch (requestError) { setError((requestError as Error).message); } finally { setLoading(false); } };
    return <AuthShell eyebrow="欢迎回来" title="登录你的创作空间" description="登录后即可使用管理员配置好的模型与额度。"><ErrorAlert error={error} />{resendSent ? <Alert className="mb-5" type="success" showIcon message="验证邮件已重新发送，请检查邮箱" /> : null}<Form layout="vertical" requiredMark={false} onFinish={submit}><Form.Item label="邮箱或用户名" name="email" rules={[{ required: true, message: "请输入邮箱或用户名" }]}><Input size="large" prefix={<UserRound className="size-4 text-stone-400" />} placeholder="用户名或 name@example.com" autoComplete="username" /></Form.Item><Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} placeholder="输入密码" autoComplete="current-password" /></Form.Item><div className="-mt-2 flex justify-end"><Link className="text-sm text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-white" to="/forgot-password">忘记密码？</Link></div><SubmitButton loading={loading}>登录并继续</SubmitButton></Form>{unverifiedEmail ? <Button className="mt-3" block type="text" onClick={() => void resend()} disabled={loading}>重新发送验证邮件</Button> : null}<p className="mt-7 text-center text-sm text-stone-500 dark:text-stone-400">还没有账号？ <Link className="font-medium text-stone-950 dark:text-white" to="/register" state={{ from: returnPath }}>免费注册</Link></p></AuthShell>;
}

export function RegisterPage() {
    const returnPath = useReturnPath();
    const navigate = useNavigate();
    const setUser = useAuthStore((state) => state.setUser);
    const [loading, setLoading] = useState(false);
    const [codeLoading, setCodeLoading] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const [error, setError] = useState("");
    const [registeredEmail, setRegisteredEmail] = useState("");
    const [verificationRequired, setVerificationRequired] = useState(true);
    const [form] = Form.useForm<Credentials>();
    const [params] = useSearchParams();
    const inviteCode = params.get("invite") || "";
    useEffect(() => { if (!countdown) return; const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer); }, [countdown]);
    const requestCode = async () => {
        const email = form.getFieldValue("email");
        if (!email) { setError("请先输入邮箱"); return; }
        setCodeLoading(true); setError("");
        try { await authApi.registrationCode(email); setCountdown(60); } catch (requestError) { setError((requestError as Error).message); } finally { setCodeLoading(false); }
    };
    const submit = async ({ username, email, password, verificationCode }: Credentials) => {
        setLoading(true); setError("");
        try { const result = await authApi.register(username || "", email, password, verificationCode, inviteCode); setVerificationRequired(result.verificationRequired); if (result.verificationRequired) setRegisteredEmail(result.user.email); else { setUser(result.user); navigate(returnPath, { replace: true }); } }
        catch (requestError) { setError((requestError as Error).message); }
        finally { setLoading(false); }
    };
    if (registeredEmail) return <AuthShell eyebrow="完成验证" title="检查你的邮箱" description={`验证码已发送至 ${registeredEmail}，输入验证码后即可激活账号。`}><div className="border-y border-stone-200 py-8 text-center dark:border-stone-800"><CheckCircle2 className="mx-auto size-10 text-orange-500" /><p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">验证码有效期有限，请及时完成验证。</p></div><Link to="/login" state={{ from: returnPath }} className="mt-6 flex h-11 items-center justify-center bg-stone-950 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">返回登录</Link></AuthShell>;
    return <AuthShell eyebrow="创建账号" title="开始你的创作空间" description="注册后即可使用平台提供的模型，无需配置 API Key。"><ErrorAlert error={error} /><Form form={form} layout="vertical" requiredMark={false} onFinish={submit}><Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }, { min: 3, message: "用户名至少 3 位" }, { max: 32, message: "用户名最多 32 位" }]}><Input size="large" prefix={<UserRound className="size-4 text-stone-400" />} placeholder="请输入用户名" autoComplete="username" /></Form.Item><Form.Item label="邮箱" name="email" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}><Input size="large" prefix={<Mail className="size-4 text-stone-400" />} placeholder="name@example.com" autoComplete="email" /></Form.Item><Form.Item label="邮箱验证码" name="verificationCode" extra="管理员关闭邮箱验证时，此项可留空"><Input size="large" placeholder="请输入验证码" addonAfter={<Button type="link" loading={codeLoading} disabled={countdown > 0} onClick={() => void requestCode()}>{countdown ? `${countdown}s 后重试` : "获取验证码"}</Button>} /></Form.Item><Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }, { min: 8, message: "密码至少 8 位" }, { max: 72, message: "密码最多 72 位" }]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} placeholder="至少 8 位" autoComplete="new-password" /></Form.Item><Form.Item label="确认密码" name="confirmPassword" dependencies={["password"]} rules={[{ required: true, message: "请再次输入密码" }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")); } })]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} placeholder="再次输入密码" autoComplete="new-password" /></Form.Item><SubmitButton loading={loading}>注册账号</SubmitButton></Form><p className="mt-5 text-center text-sm text-stone-500 dark:text-stone-400">已有账号？ <Link className="font-medium text-stone-950 dark:text-white" to="/login" state={{ from: returnPath }}>直接登录</Link></p></AuthShell>;
}

export function ForgotPasswordPage() {
    const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [sent, setSent] = useState(false);
    const submit = async ({ email }: Pick<Credentials, "email">) => { setLoading(true); setError(""); try { await authApi.forgotPassword(email); setSent(true); } catch (requestError) { setError((requestError as Error).message); } finally { setLoading(false); } };
    return <AuthShell eyebrow="账户安全" title={sent ? "请求已受理" : "找回密码"} description="输入注册邮箱，我们会发送密码重置链接。"><ErrorAlert error={error} />{sent ? <div className="border-y border-stone-200 py-8 text-center dark:border-stone-800"><CheckCircle2 className="mx-auto size-10 text-orange-500" /><Link className="mt-6 inline-block text-sm font-medium text-stone-950 dark:text-white" to="/login">返回登录</Link></div> : <Form layout="vertical" requiredMark={false} onFinish={submit}><Form.Item label="邮箱" name="email" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}><Input size="large" prefix={<Mail className="size-4 text-stone-400" />} placeholder="name@example.com" autoComplete="email" /></Form.Item><SubmitButton loading={loading}>发送重置邮件</SubmitButton></Form>}</AuthShell>;
}

export function VerifyEmailPage() { const [params] = useSearchParams(); const token = params.get("token") || ""; const setUser = useAuthStore((state) => state.setUser); const [state, setState] = useState<"loading" | "success" | "error">("loading"); const [error, setError] = useState(""); useEffect(() => { if (!token) { setState("error"); setError("验证链接缺少必要信息"); return; } void authApi.verifyEmail(token).then(({ user }) => { setUser(user); setState("success"); }).catch((requestError) => { setError((requestError as Error).message); setState("error"); }); }, [setUser, token]); return <AuthShell eyebrow="邮箱验证" title={state === "loading" ? "正在验证邮箱" : state === "success" ? "邮箱验证成功" : "验证链接失效"} description={state === "success" ? "账号已经启用，现在可以进入创作空间。" : error || "请稍候。"}><div className="border-y border-stone-200 py-9 text-center dark:border-stone-800">{state === "loading" ? <LoaderCircle className="mx-auto size-9 animate-spin text-orange-500" /> : state === "success" ? <CheckCircle2 className="mx-auto size-10 text-orange-500" /> : <KeyRound className="mx-auto size-10 text-stone-400" />}{state === "success" ? <Link to="/app" className="mt-6 flex h-11 items-center justify-center bg-stone-950 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">进入创作空间</Link> : state === "error" ? <Link to="/login" className="mt-6 inline-block text-sm font-medium text-stone-950 dark:text-white">返回登录</Link> : null}</div></AuthShell>; }

export function ResetPasswordPage() { const [params] = useSearchParams(); const token = params.get("token") || ""; const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState(false); const validToken = useMemo(() => Boolean(token), [token]); const submit = async ({ password }: Credentials) => { setLoading(true); setError(""); try { await authApi.resetPassword(token, password); setDone(true); } catch (requestError) { setError((requestError as Error).message); } finally { setLoading(false); } }; return <AuthShell eyebrow="账户安全" title={done ? "密码已更新" : "设置新密码"} description={done ? "请使用新密码重新登录。" : "新密码应为 8 至 72 位。"}><ErrorAlert error={error || (!validToken ? "重置链接缺少必要信息" : "")} />{done ? <Link to="/login" className="flex h-11 items-center justify-center bg-stone-950 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">使用新密码登录</Link> : validToken ? <Form layout="vertical" requiredMark={false} onFinish={submit}><Form.Item label="新密码" name="password" rules={[{ required: true, message: "请输入新密码" }, { min: 8, message: "密码至少 8 位" }]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} autoComplete="new-password" /></Form.Item><Form.Item label="确认新密码" name="confirmPassword" dependencies={["password"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator(_, value) { return getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")); } })]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} autoComplete="new-password" /></Form.Item><SubmitButton loading={loading}>更新密码</SubmitButton></Form> : null}</AuthShell>; }
