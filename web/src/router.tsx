import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { HostedGuestRoute, HostedRoute } from "@/components/auth/hosted-route";
import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import { isHostedMode } from "@/lib/app-mode";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import EcommerceCanvasProjectPage from "@/pages/canvas/ecommerce-project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import LandingPage from "@/pages/landing";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from "@/pages/auth";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import WorkbenchPage from "@/pages/workbench";
import ProjectsPage from "@/pages/projects";

export const router = createBrowserRouter([
    { path: "/", element: isHostedMode ? <LandingPage /> : <Navigate to="/app" replace /> },
    {
        element: <HostedGuestRoute />,
        children: [
            { path: "/login", element: <LoginPage /> },
            { path: "/register", element: <RegisterPage /> },
            { path: "/forgot-password", element: <ForgotPasswordPage /> },
        ],
    },
    { path: "/reset-password", element: <ResetPasswordPage /> },
    { path: "/verify-email", element: <VerifyEmailPage /> },
    {
        element: <HostedRoute />,
        children: [
            {
                element: (
                    <UserLayout>
                        <AnalyticsTracker />
                        <Outlet />
                    </UserLayout>
                ),
                children: [
                    { path: "/app", element: <HomePage /> },
                    { path: "/image", element: <Navigate to="/workbench" replace /> },
                    { path: "/video", element: <Navigate to="/workbench?mode=video" replace /> },
                    { path: "/workbench", element: <WorkbenchPage /> },
                    { path: "/projects", element: <ProjectsPage /> },
                    { path: "/projects/:id", element: <EcommerceCanvasProjectPage /> },
                    { path: "/assets", element: <AssetsPage /> },
                    { path: "/prompts", element: <PromptsPage /> },
                    { path: "/canvas", element: <CanvasPage /> },
                    { path: "/canvas/:id", element: <CanvasProjectPage /> },
                    { path: "/config", element: isHostedMode ? <Navigate to="/app" replace /> : <ConfigPage /> },
                ],
            },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
