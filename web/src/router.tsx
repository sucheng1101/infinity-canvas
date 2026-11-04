import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { Spin } from "antd";

import { HostedGuestRoute, HostedRoute } from "@/components/auth/hosted-route";
import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import { isHostedMode } from "@/lib/app-mode";

const AssetsPage = lazy(() => import("@/pages/assets"));
const AssetCenterLayout = lazy(() => import("@/pages/assets/center-layout"));
const AssetDashboardPage = lazy(() => import("@/pages/assets/dashboard"));
const UserUsagePage = lazy(() => import("@/pages/assets/user-usage"));
const AssetSettingsPage = lazy(() => import("@/pages/assets/settings"));
const BillingPage = lazy(() => import("@/pages/billing"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const EcommerceCanvasProjectPage = lazy(() => import("@/pages/canvas/ecommerce-project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const HomePage = lazy(() => import("@/pages/home"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsShell = lazy(() => import("@/pages/prompts/shell").then((module) => ({ default: module.PromptsShell })));
const WorkbenchPage = lazy(() => import("@/pages/workbench"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const ModelPlazaPage = lazy(() => import("@/pages/model-plaza"));
const AdminPage = lazy(() => import("@/pages/admin"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/settings"));
const ChannelsPage = lazy(() => import("@/pages/channels"));

const LoginPage = lazy(() => import("@/pages/auth").then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import("@/pages/auth").then((module) => ({ default: module.RegisterPage })));
const ForgotPasswordPage = lazy(() => import("@/pages/auth").then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/pages/auth").then((module) => ({ default: module.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import("@/pages/auth").then((module) => ({ default: module.VerifyEmailPage })));

const routerBase = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function RouteFallback() {
    return (
        <div className="grid h-full min-h-[40vh] place-items-center">
            <Spin />
        </div>
    );
}

function Page({ children }: { children: ReactNode }) {
    return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
    { path: "/", element: <Page>{isHostedMode ? <LoginPage /> : <Navigate to="/app" replace />}</Page> },
    {
        element: <HostedGuestRoute />,
        children: [
            { path: "/login", element: <Page><LoginPage /></Page> },
            { path: "/register", element: <Page><RegisterPage /></Page> },
            { path: "/forgot-password", element: <Page><ForgotPasswordPage /></Page> },
        ],
    },
    { path: "/reset-password", element: <Page><ResetPasswordPage /></Page> },
    { path: "/verify-email", element: <Page><VerifyEmailPage /></Page> },
    {
        element: <HostedRoute />,
        children: [
            {
                element: (
                    <UserLayout>
                        <AnalyticsTracker />
                        <Page>
                            <Outlet />
                        </Page>
                    </UserLayout>
                ),
                children: [
                    { path: "/app", element: <HomePage /> },
                    { path: "/image", element: <Navigate to="/workbench" replace /> },
                    { path: "/video", element: <Navigate to="/workbench?mode=video" replace /> },
                    { path: "/workbench", element: <WorkbenchPage /> },
                    { path: "/projects", element: <ProjectsPage /> },
                    { path: "/projects/:id", element: <EcommerceCanvasProjectPage /> },
                    {
                        path: "/assets",
                        element: <AssetCenterLayout />,
                        children: [
                            { index: true, element: <AssetsPage /> },
                            { path: "dashboard", element: <AssetDashboardPage /> },
                            { path: "usage", element: <UserUsagePage /> },
                            { path: "wallet", element: <BillingPage /> },
                            { path: "settings", element: <AssetSettingsPage /> },
                        ],
                    },
                    { path: "/model-plaza", element: <ModelPlazaPage /> },
                    { path: "/billing", element: <BillingPage /> },
                    { path: "/channels", element: <ChannelsPage /> },
                    { path: "/admin", element: <AdminPage /> },
                    { path: "/admin/settings", element: <AdminSettingsPage /> },
                    { path: "/prompts", element: <PromptsShell /> },
                    { path: "/canvas", element: <CanvasPage /> },
                    { path: "/canvas/:id", element: <CanvasProjectPage /> },
                    { path: "/config", element: <ConfigPage /> },
                ],
            },
        ],
    },
    { path: "*", element: <Page><NotFound /></Page> },
], { basename: routerBase });
