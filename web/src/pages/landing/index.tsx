import { Alert, Button, Form, Input } from "antd";
import { ArrowRight, CheckCircle2, Layers3, LockKeyhole, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { authApi, AuthApiError } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";

type Point = { x: number; y: number; depth: number; phase: number; speed: number };
type Credentials = { email: string; password: string; confirmPassword?: string };

const text = {
    login: "\u767b\u5f55",
    register: "\u6ce8\u518c",
    loginTitle: "\u767b\u5f55\u4f60\u7684\u521b\u4f5c\u7a7a\u95f4",
    registerTitle: "\u521b\u5efa\u4f60\u7684\u521b\u4f5c\u8d26\u53f7",
    email: "\u90ae\u7bb1",
    emailPlaceholder: "\u90ae\u7bb1\u5730\u5740",
    password: "\u5bc6\u7801",
    passwordPlaceholder: "\u8bf7\u8f93\u5165\u5bc6\u7801",
    confirmPassword: "\u786e\u8ba4\u5bc6\u7801",
    submitLogin: "\u8fdb\u5165\u753b\u5e03",
    submitRegister: "\u521b\u5efa\u8d26\u53f7",
    forgot: "\u5fd8\u8bb0\u5bc6\u7801\uff1f",
    requiredEmail: "\u8bf7\u8f93\u5165\u90ae\u7bb1",
    invalidEmail: "\u8bf7\u8f93\u5165\u6709\u6548\u90ae\u7bb1",
    requiredPassword: "\u8bf7\u8f93\u5165\u5bc6\u7801",
    shortPassword: "\u5bc6\u7801\u81f3\u5c11 8 \u4f4d",
    confirmRequired: "\u8bf7\u518d\u6b21\u8f93\u5165\u5bc6\u7801",
    mismatch: "\u4e24\u6b21\u8f93\u5165\u7684\u5bc6\u7801\u4e0d\u4e00\u81f4",
    verifyTitle: "\u68c0\u67e5\u4f60\u7684\u90ae\u7bb1",
    verifyDescription: "\u9a8c\u8bc1\u94fe\u63a5\u5df2\u53d1\u9001\uff0c\u5b8c\u6210\u9a8c\u8bc1\u540e\u5373\u53ef\u767b\u5f55\u3002",
    backLogin: "\u8fd4\u56de\u767b\u5f55",
    resend: "\u91cd\u65b0\u53d1\u9001\u9a8c\u8bc1\u90ae\u4ef6",
    resendSuccess: "\u9a8c\u8bc1\u90ae\u4ef6\u5df2\u91cd\u65b0\u53d1\u9001",
};

const seeded = (index: number, salt: number) => {
    const value = Math.sin(index * 9283.17 + salt * 2971.43) * 43758.5453;
    return value - Math.floor(value);
};

function InfiniteField() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const points: Point[] = Array.from({ length: 68 }, (_, index) => ({ x: seeded(index, 1), y: seeded(index, 2), depth: 0.25 + seeded(index, 3) * 0.75, phase: seeded(index, 4) * Math.PI * 2, speed: 0.25 + seeded(index, 5) * 0.55 }));
        const pointer = { x: 0, y: 0 };
        let frame = 0;
        let width = 0;
        let height = 0;
        let pixelRatio = 1;

        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * pixelRatio);
            canvas.height = Math.round(height * pixelRatio);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        };
        const onPointerMove = (event: PointerEvent) => {
            pointer.x = event.clientX / width - 0.5;
            pointer.y = event.clientY / height - 0.5;
        };
        const draw = (time = 0) => {
            const t = reduceMotion ? 0 : time * 0.001;
            const desktop = width >= 860;
            const centerX = width * (desktop ? 0.33 : 0.5) + pointer.x * 22;
            const centerY = height * (desktop ? 0.54 : 0.35) + pointer.y * 15;
            const base = Math.min(width, height) * (desktop ? 0.25 : 0.22);
            context.fillStyle = "#020408";
            context.fillRect(0, 0, width, height);

            context.strokeStyle = "rgba(34,211,238,.075)";
            context.lineWidth = 1;
            const horizon = height * 0.72;
            for (let index = -12; index <= 12; index += 1) {
                context.beginPath();
                context.moveTo(centerX, horizon);
                context.lineTo(centerX + index * width * 0.105, height + 40);
                context.stroke();
            }
            for (let index = 0; index < 10; index += 1) {
                const progress = index / 9;
                const y = horizon + Math.pow(progress, 1.8) * (height - horizon);
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(width, y);
                context.stroke();
            }

            const positions = points.map((point) => ({ x: point.x * width + pointer.x * 24 * point.depth, y: point.y * height + pointer.y * 18 * point.depth, radius: 0.6 + point.depth * 2.1, alpha: 0.2 + (Math.sin(t * point.speed + point.phase) + 1) * 0.22 }));
            context.lineWidth = 0.55;
            for (let index = 0; index < positions.length; index += 1) {
                const from = positions[index];
                const to = positions[(index * 7 + 13) % positions.length];
                const distance = Math.hypot(from.x - to.x, from.y - to.y);
                if (distance > width * 0.3) continue;
                context.strokeStyle = `rgba(34,211,238,${Math.max(0.02, 0.1 - distance / width / 3)})`;
                context.beginPath();
                context.moveTo(from.x, from.y);
                context.quadraticCurveTo(centerX, centerY, to.x, to.y);
                context.stroke();
            }
            for (const point of positions) {
                context.save();
                context.fillStyle = `rgba(103,232,249,${point.alpha})`;
                context.shadowColor = "rgba(34,211,238,.85)";
                context.shadowBlur = point.radius * 7;
                context.beginPath();
                context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
                context.fill();
                context.restore();
            }

            context.save();
            context.translate(centerX, centerY);
            context.rotate(t * 0.045);
            for (let ring = 0; ring < 5; ring += 1) {
                const radius = base * (0.62 + ring * 0.25);
                context.strokeStyle = `rgba(${ring % 2 ? "59,130,246" : "34,211,238"},${0.22 - ring * 0.028})`;
                context.lineWidth = ring === 0 ? 1.4 : 0.8;
                context.setLineDash(ring % 2 ? [2, 12 + ring * 2] : []);
                context.beginPath();
                context.arc(0, 0, radius, ring * 0.44, Math.PI * (1.25 + ring * 0.17));
                context.stroke();
            }
            context.setLineDash([]);
            context.rotate(-t * 0.1);
            context.strokeStyle = "rgba(103,232,249,.38)";
            context.beginPath();
            context.moveTo(-base * 1.25, 0);
            context.lineTo(base * 1.25, 0);
            context.moveTo(0, -base * 1.25);
            context.lineTo(0, base * 1.25);
            context.stroke();
            context.restore();

            context.save();
            context.translate(centerX, centerY);
            context.rotate(-0.58);
            context.strokeStyle = "rgba(34,211,238,.2)";
            context.lineWidth = Math.max(5, base * 0.055);
            context.shadowColor = "rgba(34,211,238,.45)";
            context.shadowBlur = 28;
            context.beginPath();
            context.ellipse(0, 0, base * 1.55, base * 0.36, 0, 0, Math.PI * 2);
            context.stroke();
            context.restore();

            if (!reduceMotion) frame = window.requestAnimationFrame(draw);
        };

        resize();
        draw();
        window.addEventListener("resize", resize);
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("resize", resize);
            window.removeEventListener("pointermove", onPointerMove);
        };
    }, []);

    return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" />;
}

export default function LandingPage() {
    const navigate = useNavigate();
    const [form] = Form.useForm<Credentials>();
    const [mode, setMode] = useState<"login" | "register">("login");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [registeredEmail, setRegisteredEmail] = useState("");
    const [unverifiedEmail, setUnverifiedEmail] = useState("");
    const [resendSent, setResendSent] = useState(false);
    const status = useAuthStore((state) => state.status);
    const bootstrap = useAuthStore((state) => state.bootstrap);
    const setUser = useAuthStore((state) => state.setUser);

    useEffect(() => { if (status === "idle") void bootstrap(); }, [bootstrap, status]);
    useEffect(() => { if (status === "authenticated") navigate("/app", { replace: true }); }, [navigate, status]);

    const switchMode = (next: "login" | "register") => {
        setMode(next);
        setError("");
        setRegisteredEmail("");
        setUnverifiedEmail("");
        setResendSent(false);
        form.resetFields();
    };
    const submit = async ({ email, password }: Credentials) => {
        setLoading(true);
        setError("");
        setUnverifiedEmail("");
        try {
            if (mode === "login") {
                const result = await authApi.login(email, password);
                setUser(result.user);
                navigate("/app", { replace: true });
            } else {
                const result = await authApi.register(email, password);
                setRegisteredEmail(result.user.email);
            }
        } catch (requestError) {
            const authError = requestError as AuthApiError;
            setError(authError.message);
            if (authError.code === "AUTH_EMAIL_NOT_VERIFIED") setUnverifiedEmail(email);
        } finally {
            setLoading(false);
        }
    };
    const resend = async () => {
        setLoading(true);
        setError("");
        try {
            await authApi.resendVerification(unverifiedEmail);
            setResendSent(true);
        } catch (requestError) {
            setError((requestError as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="relative min-h-dvh overflow-hidden bg-[#020408] text-white">
            <InfiniteField />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,transparent_47%,rgba(2,4,8,.4)_60%,rgba(2,4,8,.9)_100%)] max-md:bg-[linear-gradient(180deg,transparent_0%,rgba(2,4,8,.4)_36%,rgba(2,4,8,.96)_58%)]" />

            <Link to="/" aria-label="Canvas" className="absolute left-6 top-6 z-30 grid size-11 place-items-center border border-cyan-200/20 bg-[#071017]/70 text-cyan-100 backdrop-blur-md transition hover:border-cyan-200/50 hover:bg-[#0a1821] sm:left-10 sm:top-8">
                <Layers3 className="size-5" />
            </Link>

            <section className="relative z-20 ml-auto flex min-h-dvh w-full items-center px-5 py-24 md:w-[48%] md:min-w-[520px] md:px-12 lg:px-[5vw]">
                <div className="mx-auto w-full max-w-[430px] md:mx-0">
                    {registeredEmail ? (
                        <div className="border border-cyan-100/15 bg-[#071017]/72 p-8 text-center backdrop-blur-xl">
                            <CheckCircle2 className="mx-auto size-10 text-cyan-300" />
                            <h1 className="mt-5 text-2xl font-semibold tracking-tight">{text.verifyTitle}</h1>
                            <p className="mt-3 text-sm leading-6 text-cyan-50/45">{text.verifyDescription}</p>
                            <Button className="mt-7 !h-11" block onClick={() => switchMode("login")}>{text.backLogin}</Button>
                        </div>
                    ) : (
                        <>
                            <h1 className="mb-7 text-3xl font-semibold tracking-[-.035em] text-white">{mode === "login" ? text.loginTitle : text.registerTitle}</h1>
                            <div className="mb-7 grid grid-cols-2 border border-cyan-100/15 bg-[#071017]/55 p-1 backdrop-blur-lg">
                                <button type="button" onClick={() => switchMode("login")} className={`h-10 text-sm transition ${mode === "login" ? "bg-cyan-50 !text-[#031015]" : "text-cyan-50/45 hover:text-white"}`}>{text.login}</button>
                                <button type="button" onClick={() => switchMode("register")} className={`h-10 text-sm transition ${mode === "register" ? "bg-cyan-50 !text-[#031015]" : "text-cyan-50/45 hover:text-white"}`}>{text.register}</button>
                            </div>

                            {error ? <Alert className="mb-5" type="error" showIcon title={error} /> : null}
                            {resendSent ? <Alert className="mb-5" type="success" showIcon title={text.resendSuccess} /> : null}

                            <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
                                <Form.Item label={<span className="text-cyan-50/65">{text.email}</span>} name="email" rules={[{ required: true, message: text.requiredEmail }, { type: "email", message: text.invalidEmail }]}>
                                    <Input size="large" className="!h-12 !rounded-none !border-cyan-100/15 !bg-[#071017]/65 !text-white backdrop-blur-lg" prefix={<Mail className="size-4 text-cyan-100/35" />} placeholder={text.emailPlaceholder} autoComplete="email" />
                                </Form.Item>
                                <Form.Item label={<span className="text-cyan-50/65">{text.password}</span>} name="password" rules={[{ required: true, message: text.requiredPassword }, ...(mode === "register" ? [{ min: 8, message: text.shortPassword }] : [])]}>
                                    <Input.Password size="large" className="!h-12 !rounded-none !border-cyan-100/15 !bg-[#071017]/65 !text-white backdrop-blur-lg" prefix={<LockKeyhole className="size-4 text-cyan-100/35" />} placeholder={text.passwordPlaceholder} autoComplete={mode === "login" ? "current-password" : "new-password"} />
                                </Form.Item>
                                {mode === "register" ? (
                                    <Form.Item label={<span className="text-cyan-50/65">{text.confirmPassword}</span>} name="confirmPassword" dependencies={["password"]} rules={[{ required: true, message: text.confirmRequired }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error(text.mismatch)); } })]}>
                                        <Input.Password size="large" className="!h-12 !rounded-none !border-cyan-100/15 !bg-[#071017]/65 !text-white backdrop-blur-lg" prefix={<LockKeyhole className="size-4 text-cyan-100/35" />} placeholder={text.confirmPassword} autoComplete="new-password" />
                                    </Form.Item>
                                ) : null}
                                <Button htmlType="submit" type="primary" size="large" block loading={loading} className="mt-2 !h-12 !rounded-none !border-cyan-100 !bg-cyan-50 !text-[#031015]">
                                    <span className="inline-flex items-center gap-2">{mode === "login" ? text.submitLogin : text.submitRegister}<ArrowRight className="size-4" /></span>
                                </Button>
                            </Form>

                            {unverifiedEmail ? <Button className="mt-3" type="text" block disabled={loading} onClick={() => void resend()}>{text.resend}</Button> : null}
                            {mode === "login" ? <div className="mt-5 text-right"><Link to="/forgot-password" className="text-xs text-cyan-50/45 transition hover:text-cyan-100">{text.forgot}</Link></div> : null}
                        </>
                    )}
                </div>
            </section>
        </main>
    );
}
