import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
    server: {
        proxy: {
            "/api": "http://127.0.0.1:1011",
        },
    },
    build: {
        rollupOptions: {
            output: {
                // Split stable, heavy dependencies into their own chunks so route chunks stay small.
                // mermaid / shiki are only reached through streamdown's dynamic import and must stay lazy here.
                manualChunks(id: string) {
                    if (!id.includes("node_modules")) return;
                    const path = id.replace(/\\/g, "/");
                    if (/\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(path)) return "react";
                    if (/\/(antd|@ant-design|@rc-component|rc-[a-z-]+)\//.test(path)) return "antd";
                    if (/\/(@codemirror|@lezer|@uiw)\//.test(path)) return "codemirror";
                    if (/\/(streamdown|marked|unified|remark-[a-z-]+|rehype-[a-z-]+|hast-[a-z-]+|micromark[a-z-]*|mdast-[a-z-]+|unist-[a-z-]+|remend|html-url-attributes)\//.test(path)) return "agent";
                },
            },
        },
    },
});
