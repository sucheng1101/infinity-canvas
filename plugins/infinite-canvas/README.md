# Infinite Canvas Plugin

让 Codex / ZCode 可以打开并操作 Infinite Canvas。

## 安装

### Codex

直接添加项目自有 GitHub marketplace：

```bash
codex plugin marketplace add https://github.com/sucheng1101/infinity-canvas.git
codex plugin add infinity-canvas@infinity-canvas
```

本仓库开发调试时也可以加载本地目录：

```powershell
codex plugin marketplace add "$PWD"
codex plugin add infinity-canvas@infinity-canvas
```

### ZCode

- 打开 **Settings → Plugin Management → Discover**，点击右上角 **`+`** 添加 marketplace。
- 选择 **本仓库目录**（`plugins/infinite-canvas`）或本仓库根目录，即可发现 `infinity-canvas` 插件并安装。
- 或在 ZCode 界面直接以本地目录方式加载该插件目录。

安装后新建一个任务，然后输入：

```text
帮我打开并连接到 Infinite Canvas
```

插件会运行 `@sucheng1101/canvas-agent`，并打开项目自有线上画布。安装或更新插件后请新建一个 Codex 对话，使 Skill 和 MCP 配置完整加载。
