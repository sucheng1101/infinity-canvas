# 短剧 3D 白模片场 Spec（横店方案）

> 状态：待确认后开工。本文替代此前「分镜抽屉」的设计，短剧不再寄生在画布里。
> 调研数据来自 GitHub API（2026-11-05 实时拉取）。

## 1. 定位

一个项目内两种工作区：

- **画布**：宣发图、一图联动多视频等自由创作（保持现状）。
- **短剧**：主流短剧流程 + **3D 白模片场预演**，预演确认后再出片。

核心差异点是「横店」：**先花零成本在 3D 白模里把机位、走位、运镜、节奏排好，满意了再花钱生成**。解决的问题是短剧最大的浪费——生成完才发现构图不对、机位穿帮、节奏拖沓。

## 2. 调研结论

| 项目 | 星 | 许可 | 结论 |
|---|---|---|---|
| [NomaDamas/CozyClay](https://github.com/NomaDamas/CozyClay) | 1.5k | **AGPL-3.0** | 形态与我们目标**完全一致**：Stage（搭景+人物）→ Motion → Camera（分镜+剪辑点）→ Export（首尾帧、灰模视频、相机参数、深度/法线通道、OTIO 剪辑表）→ AI 视频模型。**但 AGPL 不能用于闭源 SaaS**，只能借鉴设计，不能抄代码 |
| [GuiYi-Xi/monoform-previs-studio](https://github.com/GuiYi-Xi/monoform-previs-studio) | 131 | 无 LICENSE 文件（默认保留所有权利） | 中文白模预演台：Three.js + React，资源库（人物/几何体/拱门/楼梯/家具/车辆）、导入 GLB/GLTF、骨骼与预设动作、参考图摆姿。**设计参考价值高，代码同样不能用** |
| [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | 2.3k | MIT | ✅ 可直接依赖：VRM 人形模型加载与姿态 |
| three.js | — | MIT | ✅ 可直接依赖：渲染与相机 |

**结论：没有可以直接用的成品，但有清晰可抄的设计**（CozyClay 的四段式管线与导出内容），代码层面全部自研，依赖只用 MIT 的 three.js 与 three-vrm。

## 3. 关键决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 预演层 | 自研，three.js | AGPL 传染风险不可接受 |
| 人物 | 起步用胶囊体 + 尺寸参数；后续支持导入 VRM/GLB | 先让流程跑通，不依赖美术资源 |
| 场景 | 程序化白模（地面/墙体/台阶/门/家具由几何体拼） + 支持导入 GLB | 「白模片场」不需要贴图与美术资产 |
| 数据 | **全部本地**（IndexedDB + OPFS），云端只存账户与积分 | 用户要求「我们只提供平台」 |
| 备份 | 一键导出 `.icdrama`（zip：manifest + 场景 JSON + 模型文件 + 图片），可导入到另一台电脑 | 换机复用 |
| 计费 | 预演**免费**；出图 / 出视频 / 配音按积分 | 用户确认 |

## 4. 信息架构

```
项目（Project）
├─ 画布工作区   /canvas/:id           现有
└─ 短剧工作区   /drama/:id            新增
     ├─ ① 定妆   角色卡 / 场景卡 / 道具卡（可导入 GLB/VRM）
     ├─ ② 分镜   场次 ▸ 镜头（镜号、景别、机位、时长、台词、出场角色）
     ├─ ③ 预演   3D 白模片场：摆位、机位、运镜关键帧、时间轴、实时预览
     ├─ ④ 拍摄   逐镜出参考图 → 出视频 → 配音，状态可视、可重拍
     └─ ⑤ 成片   时间轴对齐 → 导出工程包 / 剪映草稿
```

入口：顶部导航「短剧」→ 列表 → 新建/打开 → 直接进短剧工作台（不再进画布）。

## 5. 数据模型（本地）

```ts
type DramaProject = {
  id: string; title: string; createdAt: number; updatedAt: number;
  characters: CharacterCard[]; scenes: SceneCard[]; props: PropCard[];
  shots: Shot[]; timeline: { fps: number; totalSec: number };
};

type CharacterCard = { id: string; name: string; prompt: string; refImages: string[]; modelKey?: string /* GLB/VRM 本地文件 key */; heightCm: number; color: string };
type SceneCard     = { id: string; name: string; template: string /* 程序化模板 id */; glbKey?: string; size: { x: number; y: number; z: number } };

type Shot = {
  id: string; sceneId: string; index: number;
  shotSize: "特写" | "近景" | "中景" | "全景" | "远景";
  durationSec: number; dialogue: string; prompt: string;
  cast: Array<{ characterId: string; position: [number, number, number]; rotationY: number }>;
  camera: { keys: CameraKey[]; lens: number };
  status: "待预演" | "已预演" | "已出图" | "已出片";
  output?: { imageUrl?: string; videoUrl?: string; audioUrl?: string };
};

type CameraKey = { t: number; position: [number, number, number]; target: [number, number, number]; fov: number; easing: string };
```

## 6. 本地存储与备份

| 数据 | 位置 | 说明 |
|---|---|---|
| 项目 JSON（角色/场景/镜头/相机轨迹） | IndexedDB | 与画布项目同一套 localforage 封装 |
| 导入的 GLB/VRM 模型 | **OPFS**（Origin Private File System） | 模型动辄几十 MB，IndexedDB 不合适；存不下时降级 IndexedDB |
| 生成结果（图/视频/音频） | 现有图片/媒体存储 | 复用 |

**备份包 `.icdrama`（zip）**
```
manifest.json      { schemaVersion, app, projectId, exportedAt, files: [...] }
project.json       完整 DramaProject
models/<key>.glb   本地模型
media/<key>.<ext>  参考图、生成图（可选，体积大时默认不含）
```
导入时校验 `schemaVersion`，高于当前版本直接拒绝并提示「请先升级」；低于当前版本走迁移。

## 7. 3D 预演技术方案

- **渲染**：three.js（懒加载，独立 chunk）
- **场景**：程序化模板（空场/街道/室内/宫殿/校园），全部用几何体拼装，白模灰材质 + 网格地面
- **人物**：胶囊体 + 朝向标记；导入 VRM 时用 three-vrm 渲染、支持预设动作
- **操作**：WASD/轨道相机漫游、拖拽摆人、拖拽机位、点选镜头「从当前视角建立机位」
- **时间轴**：0.1s 精度，多个 CameraKey 之间线性/缓入缓出插值；播放时相机沿轨迹运动，可实时预览
- **导出（每镜头）**：
  - 首帧 / 尾帧 PNG
  - 灰模参考片段（WebM，10fps 足够）
  - 深度图 / 法线图（`WebGLRenderTarget` 渲染，供后续条件生成）
  - 相机参数 JSON + 文本化运镜描述（供提示词）
- **性能边界**：单场景 ≤ 200 个几何体、≤ 8 个角色；超出提示降级

## 8. 3D → 出片

```
镜头预演 → 导出首帧 + 深度图 + 相机/运镜描述
        → 拼成图片/视频请求（首帧作参考图，运镜描述进 prompt）
        → 走现有 202 异步队列 → 失败可重拍
```
没有预演的镜头退化走纯文本提示词（保持可用，不阻塞）。

## 9. 计费

| 动作 | 计费 |
|---|---|
| 搭景、摆位、预览、导出首尾帧/深度图 | **免费**（纯本地计算） |
| 出图 / 出视频 / 配音 | 走现有积分体系（图片 0.1 元/张等） |
| 备份导出/导入 | 免费 |

## 10. 复用现有能力

- 202 异步队列与任务中心（已实现）
- 资产库（角色/场景/道具卡可从资产库导入）
- 导出工程包与剪映草稿（已实现，短剧工作台直接调用）
- 积分与订阅（已实现）

## 11. 并行开发拆分（4 个 stream）

| Stream | 负责 | 文件所有权 | 依赖 |
|---|---|---|---|
| A 数据与本地存储 | 项目/角色/场景/镜头模型、IndexedDB + OPFS、`.icdrama` 导入导出 | `web/src/lib/drama/**`、`web/src/stores/drama/**` | 无 |
| B 3D 预演引擎 | three.js 场景、程序化白模、人物摆位、相机关键帧、时间轴、导出首尾帧/深度/灰模片段 | `web/src/components/drama/previs/**`、`web/src/lib/drama/previs/**` | A 的模型类型 |
| C 短剧工作台 UI | 工作台骨架、定妆/分镜/拍摄/成片四页、镜头表格、状态流转 | `web/src/pages/drama/**` | A |
| D 出片与计费 | 预演结果 → 生成请求、批量拍摄、计费校验、导出调用 | `web/src/lib/drama/render/**`、`server` 如需改动 | B、C |

**约定**：A 先给出类型定义（半天），B/C/D 再并行；四者不交叉改同一文件。

## 12. 验收标准

1. 新建短剧 → 进工作台（不是画布），刷新后仍在
2. 搭一个白模场景（≥ 1 个场景 + 2 个角色），摆 3 个镜头，每条机位不同
3. 播放预览：相机沿轨迹移动，时长与镜头设定一致
4. 导出某个镜头的首帧 + 深度图，文件可打开
5. 从预演一键出图，返回的图与首帧构图一致（人工判断）
6. 一键备份 → 清空浏览器 → 导入 → 场景与镜头完全恢复
7. 出图扣积分、预演不扣积分

## 13. 风险

| 风险 | 说明 | 对策 |
|---|---|---|
| three.js 体积 | 约 600KB（gzip 后 ~150KB） | 独立 chunk，仅短剧工作台懒加载 |
| 深度图条件生成效果不确定 | 视频模型对深度/首帧的遵循度因模型而异 | 先小样本试，效果差就只用首帧 + 运镜描述 |
| OPFS 兼容性 | Safari 支持较新 | 降级到 IndexedDB；导入大模型时提示体积 |
| 本地数据丢失 | 清缓存即丢 | 首屏提示「定期备份」，导出入口常驻 |
| AGPL 传染 | CozyClay 仅作设计参考 | 代码零拷贝，只借鉴流程 |

## 14. 已决策（2026-11-05 确认）

| 项 | 结论 |
| --- | --- |
| 场景模板 | 两个大世界：**修行**、**都市**；通用小场景：空场 / 室内 / 街道 / 宫殿；都市侧：都市街道 / 公寓 / 办公室 / 店铺 |
| 备份内容 | **只保留场景布局与镜头**，不含生成结果媒体（图/视频/音频） |
| 人物 | 第一期用胶囊体人偶；VRM / GLB 导入放第二期 |
| 预演计费 | 免费；只有出图 / 出视频 / 配音扣积分 |

### 首批场景清单

| id | 名称 | 世界 | 说明 |
| --- | --- | --- | --- |
| empty | 空场 | 通用 | 40×40 地面，用于自由搭景 |
| indoor | 室内 | 通用 | 12×10 四面墙 |
| street | 街道 | 修行 | 30×12，两侧店铺盒 |
| palace | 宫殿 | 修行 | 40×30，台阶 + 6 立柱 + 屋顶 |
| urban_street | 都市街道 | 都市 | 30×12，路面 + 路灯 |
| apartment | 公寓 | 都市 | 10×8，床/桌 |
| office | 办公室 | 都市 | 12×10，工位 |
| shop | 店铺 | 都市 | 12×10，柜台 |

## 15. 并行开发状态

| Stream | 内容 | 状态 |
| --- | --- | --- |
| 契约 | `web/src/types/drama.ts` | ✅ 已完成 |
| A | 数据层、场景模板、模型文件存储、备份导入导出 | 进行中 |
| B | three.js 预演引擎（场景/人物/相机插值/导首帧深度法线） | 进行中 |
| C | 短剧列表页与工作台（定妆/分镜/拍摄） | 进行中 |
| D | 出片与计费逻辑（提示词拼装、批量拍摄、并发控制） | 进行中 |
