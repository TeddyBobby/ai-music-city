# AI乐之城

面向中文创作的本地音乐工作台。使用 React、Mantine 与 FastAPI，将音乐生成、创作对话、封面、播放和乐评放在同一个界面中。

本项目基于 [ianiv/YuE2](https://github.com/ianiv/YuE2) 的 YuE2 Studio 扩展，保留原有音乐生成引擎和 MIT 许可。原版说明完整保存在 [docs/upstream/README.md](docs/upstream/README.md)，仅调整了迁移后的文档相对链接；其中界面介绍以原版为准。

## 已实现

- **音乐创作**：Apple Silicon 上通过 MLX 运行 YuE2-3B，支持歌词歌曲与纯音乐创作、量化模型、LoRA、随机种子和低内存模式。
- **任务与作品**：真实生成进度、任务取消、失败提示、作品检索、下载、项目与版本管理。
- **播放体验**：全屏播放器、封面与歌词左右切换、播放队列、循环与随机播放；底部播放条随滚动显示或收起。
- **创作助手**：连接本机 Hermes，进行对话、写词与曲风构思；封面可通过 Hermes 图片能力或配置的 OpenAI 兼容图片接口生成、应用和恢复。
- **评分与乐评**：手动 10 分制评分、评论及 Hermes AI 参考评估。AI 使用创作信息、乐谱和本机测得的音频指标，当前不直接听音。
- **音乐广场**：单曲、专辑、搜索与排行榜；发布和评分记录保存于本机数据库。
- **响应式界面**：中文页面、深浅主题、可收起侧栏、移动端底部导航、首页声波动画与 AI乐之城字标。

当前是本机单用户应用。头像、名称和订阅入口是产品占位，尚未实现真正的账号登录、订阅支付、用户隔离或互联网社区。当前音乐引擎依赖 macOS / Apple Silicon，不能直接当作 Linux GPU 生产服务部署。

## 安装与启动

需要 Apple Silicon Mac、原生 arm64 Python 3.12、`uv`、Node.js / npm，以及用于 MP3 导出和音频处理的 `ffmpeg`。建议至少 16 GB 统一内存，并为模型预留约 15 GB 磁盘空间；可选模型另计。实际能否生成及可用时长取决于剩余内存、模型和参数。

引擎要求 macOS 14.2 或更新；M5 需要 macOS 26.2 或更新。安装脚本会检查本机运行条件。

在仓库根目录执行：

```sh
uv sync
npm ci --prefix frontend
npm run build --prefix frontend
uv run python scripts/setup.py
uv run yue2-studio --open
```

浏览器默认打开 <http://127.0.0.1:8765/>。前端构建后由 Python 服务直接提供，日常使用无需额外运行 Vite。

完成首次安装后，也可以双击 [启动 AI乐之城.command](scripts/macos/启动%20AI乐之城.command)。

安装脚本选项：

| 命令 | 用途 |
| --- | --- |
| `uv run python scripts/setup.py` | 下载固定版本的生成模型与 VAE，并检查运行环境 |
| `uv run python scripts/setup.py --with-cover` | 额外下载音频改编所需的 SheetSage2 与 MERT 模型 |
| `uv run python scripts/setup.py --with-hum` | 额外下载改编模型及哼唱适配器 |
| `uv run python scripts/setup.py --skip-download` | 只运行检查，不下载模型 |
| `uv run python scripts/setup.py --skip-download --no-verify-hashes` | 跳过较耗时的权重哈希校验，进行快速检查 |

`--with-cover` 指音频改编，不是图片封面生成。图片封面与对话需要在「创作助手 → 连接设置」中另行配置；Hermes 需先在本机安装并启动。模型下载与外部助手 / 图片服务会访问网络，所用服务可能需要自己的账号和额度。

### 可选：本地歌词校准

歌词高亮需要从实际演唱中识别时间，不能用歌曲总时长平均分配。安装以下可选依赖后，带歌词作品会自动进入本地校准队列；识别成功的歌词可随播放高亮，滑动仅浏览，点击歌词才跳转。无法可靠识别的句子保留为静态歌词，不编造时间戳。伴奏、口音、漏唱和重复段落仍可能影响识别结果。

```sh
# 仅首次需要；安装脚本不会自动运行 Homebrew
brew install whisper-cpp ffmpeg
uv run python scripts/setup_lyrics.py

# 只检查已安装依赖和模型，不下载
uv run python scripts/setup_lyrics.py --check
```

校准在本机运行，不上传歌曲。可选模型为 `ggerganov/whisper.cpp` 的多语言 `ggml-small-q5_1.bin`（约 190 MB），保存到 `models/whisper/`。下载固定版本并核验大小与 SHA-256 后才替换文件；已有有效模型不会重复下载。下载沿用 `HF_ENDPOINT` 环境变量；设置了 `YUE2_STUDIO_HOME` 时，模型保存到该目录下的 `models/whisper/`。模型和歌词校准结果属于本机运行数据，不提交到 Git。

## 开发

```sh
# 终端一：后端
uv run yue2-studio --reload

# 终端二：前端
npm run dev --prefix frontend
```

Vite 默认使用 5173 端口，将 API 和图片资源代理到本机 8765。更多说明见 [frontend/README.md](frontend/README.md)。

```sh
npm run check --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
uv run pytest
```

## 目录与数据

| 路径 | 内容 |
| --- | --- |
| `frontend/` | React + TypeScript + Mantine 前端源码和测试 |
| `yue2_studio/` | FastAPI、任务队列、模型适配、助手、乐评与广场服务 |
| `scripts/` | 安装、运行与维护脚本 |
| `tests/` | 后端测试 |
| `docs/` | 开发文档、原版使用说明与归档 |
| `examples/` | 示例生成请求 |
| `samples/`、`design/` | 可选的精选作品导出和设计素材，不参与程序运行 |

`models/`、`data/`、`logs/`、`node_modules/`、`.venv/` 不进入 Git。`data/` 包含作品、对话、评分、广场记录和本机连接配置，应单独保管；新克隆的仓库不会自动恢复这些记录。模型在目标电脑重新下载，服务凭据在目标电脑重新配置。前端发布文件由构建命令生成。

## 许可与来源

代码遵循 [MIT License](LICENSE)，保留 YuE2 Studio 原作者 Ianiv Schweber 的版权声明。MLX 推理由 mlx-Yue 提供，依赖版本固定在 [pyproject.toml](pyproject.toml) 和 [uv.lock](uv.lock)。

模型权重与代码使用不同许可：上游说明中的 YuE2-3B、MLX 转换权重、VAE 及示例 LoRA 为 **CC BY-NC 4.0（非商业使用）**；mlx-Yue 为 Apache 2.0，abcjs 为 MIT。应用代码的 MIT 许可不覆盖模型授权，商用前应单独核对所选模型、素材与外部服务条款。模型和运行时凭据不随代码仓库分发。
