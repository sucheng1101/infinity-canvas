# 无限画布 · 短剧插件（Magpie）

把平台的出图 / 出视频 / 配音能力暴露给 Magpie 与 Agent。用户**复制两段文字**即可完成接入。

## 一、安装（复制这行贴到 Magpie 插件页底部输入框）

```
github:sucheng1101/infinity-canvas/integrations/magpie-drama-plugin
```

也可以填 npm 包名（发布后）或本机文件夹的绝对路径，例如：

```
D:\Desktop\object\03_AI图像与技能\无限画布\integrations\magpie-drama-plugin
```

安装后在插件设置里填两个环境变量：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `INFINITE_CANVAS_API` | 是 | 账户服务地址，本地为 `http://127.0.0.1:1011` |
| `INFINITE_CANVAS_TOKEN` | 否 | 用令牌鉴权时填；用浏览器 Cookie 会话时可留空 |

## 二、给 Agent 的连接提示词（复制这段发给 Agent）

```
你已接入「无限画布 · 短剧」插件，可调用以下工具：
- image.generate(prompt, modelId?)  出图，返回图片地址，约 0.1 元/张
- video.generate(prompt, imageUrl?, seconds?, modelId?)  出视频，耗时较长
- audio.speak(text, modelId?)        台词转语音，返回 wav 地址
- drama.list()                       列出可用模型，拿 modelId

调用约定：
1. 出图前先用 drama.list 确认可用模型；不确定 modelId 时用默认值。
2. 任务失败时读取错误码：QUOTA_INSUFFICIENT 提示用户充值；
   QUEUE_FULL 稍后重试；UPSTREAM_HTTP_ERROR 换模型或稍后再试。
3. 生成的都是**付费操作**，每次调用前先告知用户预估消耗。
4. 输出统一返回地址（url），不要把 base64 直接塞进对话。
```

## 三、能力对应的平台接口

| 工具 | 平台接口 | 计费 |
| --- | --- | --- |
| `image.generate` | `/quotes` → `/generation-tasks` → `/execute` 轮询 | 按模型定价（图片 0.1 元/张） |
| `video.generate` | 同上，`capability=video` | 按秒计费 |
| `audio.speak` | 同上，`capability=audio`（Gemini 语音模型自动适配） | 2 分/次 |
| `drama.list` | `GET /models` | 免费 |

## 四、实现说明与待校准项

- 插件按 **provider + tools** 的通用形状实现：导出 `tools` 对象，每个工具有 `description / parameters / run`。
- **Magpie 的插件清单字段（`magpie` 段的 `kind` / `capabilities` / `env`）需要在首次安装后按真实 schema 校准**——本机 `%LOCALAPPDATA%\magpie\market` 里只有 skills 索引，没有已安装插件的 `package.json` 样例，所以我按通用约定写的。装一次、看报错、改字段，一轮即可对齐。
- 所有工具都走现有 202 异步队列，长任务默认 120 秒超时，视频放宽到 600 秒。

## 五、后续可加的工具

- `drama.create(title, world)`：建短剧项目
- `drama.storyboard(script)`：剧本拆成场次与镜头
- `drama.cast(shotId)`：按镜头描述生成白模场景草稿

这三个要等短剧工作台的接口化改造完成后再补。
