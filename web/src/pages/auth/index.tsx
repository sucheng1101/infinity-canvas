import { Alert, Button, Form, Input } from "antd";
import { ArrowRight, CheckCircle2, KeyRound, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation();
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
    return <AuthShell eyebrow={t("authPage.login.eyebrow")} title={t("authPage.login.title")} description={t("authPage.login.description")}><ErrorAlert error={error} />{resendSent ? <Alert className="mb-5" type="success" showIcon message={t("authPage.login.resendSent")} /> : null}<Form layout="vertical" requiredMark={false} onFinish={submit}><Form.Item label={t("authPage.login.emailLabel")} name="email" rules={[{ required: true, message: t("authPage.login.emailRequired") }]}><Input size="large" prefix={<UserRound className="size-4 text-stone-400" />} placeholder={t("authPage.login.emailPlaceholder")} autoComplete="username" /></Form.Item><Form.Item label={t("authPage.login.passwordLabel")} name="password" rules={[{ required: true, message: t("authPage.login.passwordRequired") }]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} placeholder={t("authPage.login.passwordPlaceholder")} autoComplete="current-password" /></Form.Item><div className="-mt-2 flex justify-end"><Link className="text-sm text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-white" to="/forgot-password">{t("authPage.login.forgot")}</Link></div><SubmitButton loading={loading}>{t("authPage.login.submit")}</SubmitButton></Form>{unverifiedEmail ? <Button className="mt-3" block type="text" onClick={() => void resend()} disabled={loading}>{t("authPage.login.resend")}</Button> : null}<p className="mt-7 text-center text-sm text-stone-500 dark:text-stone-400">{t("authPage.login.noAccount")} <Link className="font-medium text-stone-950 dark:text-white" to="/register" state={{ from: returnPath }}>{t("authPage.login.register")}</Link></p></AuthShell>;
}

export function RegisterPage() {
    const { t } = useTranslation();
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
        if (!email) { setError(t("authPage.register.emailRequiredFirst")); return; }
        setCodeLoading(true); setError("");
        try { await authApi.registrationCode(email); setCountdown(60); } catch (requestError) { setError((requestError as Error).message); } finally { setCodeLoading(false); }
    };
    const submit = async ({ username, email, password, verificationCode }: Credentials) => {
        setLoading(true); setError("");
        try { const result = await authApi.register(username || "", email, password, verificationCode, inviteCode); setVerificationRequired(result.verificationRequired); if (result.verificationRequired) setRegisteredEmail(result.user.email); else { setUser(result.user); navigate(returnPath, { replace: true }); } }
        catch (requestError) { setError((requestError as Error).message); }
        finally { setLoading(false); }
    };
    if (registeredEmail) return <AuthShell eyebrow={t("authPage.register.verifiedEyebrow")} title={t("authPage.register.verifiedTitle")} description={t("authPage.register.verifiedDescription", { email: registeredEmail })}><div className="border-y border-stone-200 py-8 text-center dark:border-stone-800"><CheckCircle2 className="mx-auto size-10 text-orange-500" /><p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("authPage.register.verifiedHint")}</p></div><Link to="/login" state={{ from: returnPath }} className="mt-6 flex h-11 items-center justify-center bg-stone-950 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">{t("authPage.register.back")}</Link></AuthShell>;
    return <AuthShell eyebrow={t("authPage.register.eyebrow")} title={t("authPage.register.title")} description={t("authPage.register.description")}><ErrorAlert error={error} /><Form form={form} layout="vertical" requiredMark={false} onFinish={submit}><Form.Item label={t("authPage.register.usernameLabel")} name="username" rules={[{ required: true, message: t("authPage.register.usernameRequired") }, { min: 3, message: t("authPage.register.usernameMin") }, { max: 32, message: t("authPage.register.usernameMax") }]}><Input size="large" prefix={<UserRound className="size-4 text-stone-400" />} placeholder={t("authPage.register.usernamePlaceholder")} autoComplete="username" /></Form.Item><Form.Item label={t("authPage.register.emailLabel")} name="email" rules={[{ required: true, message: t("authPage.register.emailRequired") }, { type: "email", message: t("authPage.register.emailInvalid") }]}><Input size="large" prefix={<Mail className="size-4 text-stone-400" />} placeholder="name@example.com" autoComplete="email" /></Form.Item><Form.Item label={t("authPage.register.codeLabel")} name="verificationCode" extra={t("authPage.register.codeExtra")}><Input size="large" placeholder={t("authPage.register.codePlaceholder")} addonAfter={<Button type="link" loading={codeLoading} disabled={countdown > 0} onClick={() => void requestCode()}>{countdown ? t("authPage.register.retryIn", { count: countdown }) : t("authPage.register.requestCode")}</Button>} /></Form.Item><Form.Item label={t("authPage.register.passwordLabel")} name="password" rules={[{ required: true, message: t("authPage.register.passwordRequired") }, { min: 8, message: t("authPage.register.passwordMin") }, { max: 72, message: t("authPage.register.passwordMax") }]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} placeholder={t("authPage.register.passwordPlaceholder")} autoComplete="new-password" /></Form.Item><Form.Item label={t("authPage.register.confirmLabel")} name="confirmPassword" dependencies={["password"]} rules={[{ required: true, message: t("authPage.register.confirmRequired") }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error(t("authPage.register.mismatch"))); } })]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} placeholder={t("authPage.register.confirmPlaceholder")} autoComplete="new-password" /></Form.Item><SubmitButton loading={loading}>{t("authPage.register.submit")}</SubmitButton></Form><p className="mt-5 text-center text-sm text-stone-500 dark:text-stone-400">{t("authPage.register.haveAccount")} <Link className="font-medium text-stone-950 dark:text-white" to="/login" state={{ from: returnPath }}>{t("authPage.register.login")}</Link></p></AuthShell>;
}

export function ForgotPasswordPage() {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [sent, setSent] = useState(false);
    const submit = async ({ email }: Pick<Credentials, "email">) => { setLoading(true); setError(""); try { await authApi.forgotPassword(email); setSent(true); } catch (requestError) { setError((requestError as Error).message); } finally { setLoading(false); } };
    return <AuthShell eyebrow={t("authPage.forgot.eyebrow")} title={sent ? t("authPage.forgot.titleSent") : t("authPage.forgot.title")} description={t("authPage.forgot.description")}><ErrorAlert error={error} />{sent ? <div className="border-y border-stone-200 py-8 text-center dark:border-stone-800"><CheckCircle2 className="mx-auto size-10 text-orange-500" /><Link className="mt-6 inline-block text-sm font-medium text-stone-950 dark:text-white" to="/login">{t("authPage.forgot.back")}</Link></div> : <Form layout="vertical" requiredMark={false} onFinish={submit}><Form.Item label={t("authPage.forgot.emailLabel")} name="email" rules={[{ required: true, message: t("authPage.forgot.emailRequired") }, { type: "email", message: t("authPage.forgot.emailInvalid") }]}><Input size="large" prefix={<Mail className="size-4 text-stone-400" />} placeholder="name@example.com" autoComplete="email" /></Form.Item><SubmitButton loading={loading}>{t("authPage.forgot.submit")}</SubmitButton></Form>}</AuthShell>;
}

export function VerifyEmailPage() { const { t } = useTranslation(); const [params] = useSearchParams(); const token = params.get("token") || ""; const setUser = useAuthStore((state) => state.setUser); const [state, setState] = useState<"loading" | "success" | "error">("loading"); const [error, setError] = useState(""); useEffect(() => { if (!token) { setState("error"); setError(t("authPage.verify.missingToken")); return; } void authApi.verifyEmail(token).then(({ user }) => { setUser(user); setState("success"); }).catch((requestError) => { setError((requestError as Error).message); setState("error"); }); }, [setUser, t, token]); return <AuthShell eyebrow={t("authPage.verify.eyebrow")} title={state === "loading" ? t("authPage.verify.titleLoading") : state === "success" ? t("authPage.verify.titleSuccess") : t("authPage.verify.titleError")} description={state === "success" ? t("authPage.verify.descriptionSuccess") : error || t("authPage.verify.descriptionPending")}><div className="border-y border-stone-200 py-9 text-center dark:border-stone-800">{state === "loading" ? <LoaderCircle className="mx-auto size-9 animate-spin text-orange-500" /> : state === "success" ? <CheckCircle2 className="mx-auto size-10 text-orange-500" /> : <KeyRound className="mx-auto size-10 text-stone-400" />}{state === "success" ? <Link to="/app" className="mt-6 flex h-11 items-center justify-center bg-stone-950 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">{t("authPage.verify.enter")}</Link> : state === "error" ? <Link to="/login" className="mt-6 inline-block text-sm font-medium text-stone-950 dark:text-white">{t("authPage.verify.back")}</Link> : null}</div></AuthShell>; }

export function ResetPasswordPage() { const { t } = useTranslation(); const [params] = useSearchParams(); const token = params.get("token") || ""; const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState(false); const validToken = useMemo(() => Boolean(token), [token]); const submit = async ({ password }: Credentials) => { setLoading(true); setError(""); try { await authApi.resetPassword(token, password); setDone(true); } catch (requestError) { setError((requestError as Error).message); } finally { setLoading(false); } }; return <AuthShell eyebrow={t("authPage.reset.eyebrow")} title={done ? t("authPage.reset.titleDone") : t("authPage.reset.title")} description={done ? t("authPage.reset.descriptionDone") : t("authPage.reset.description")}><ErrorAlert error={error || (!validToken ? t("authPage.reset.missingToken") : "")} />{done ? <Link to="/login" className="flex h-11 items-center justify-center bg-stone-950 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">{t("authPage.reset.login")}</Link> : validToken ? <Form layout="vertical" requiredMark={false} onFinish={submit}><Form.Item label={t("authPage.reset.passwordLabel")} name="password" rules={[{ required: true, message: t("authPage.reset.passwordRequired") }, { min: 8, message: t("authPage.reset.passwordMin") }]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} autoComplete="new-password" /></Form.Item><Form.Item label={t("authPage.reset.confirmLabel")} name="confirmPassword" dependencies={["password"]} rules={[{ required: true, message: t("authPage.reset.confirmRequired") }, ({ getFieldValue }) => ({ validator(_, value) { return getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error(t("authPage.reset.mismatch"))); } })]}><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-stone-400" />} autoComplete="new-password" /></Form.Item><SubmitButton loading={loading}>{t("authPage.reset.submit")}</SubmitButton></Form> : null}</AuthShell>; }


