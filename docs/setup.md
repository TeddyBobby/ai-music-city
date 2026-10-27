# 安装与使用

[返回项目介绍](../README.md)

## 本地安装

当前音乐引擎使用 MLX，需要 Apple Silicon Mac、原生 arm64 Python 3.12、`uv`、Node.js / npm。macOS 至少为 14.2，M5 芯片至少为 26.2；安装脚本会检查运行环境。建议至少 16 GB 统一内存，为基础模型预留约 15 GB 空间，可选模型另计。可生成的时长取决于模型、参数和剩余内存。

`ffmpeg` 用于音频处理与 MP3 导出，可通过 Homebrew 安装：

```sh
brew install ffmpeg
```

在仓库根目录执行：

```sh
uv sync
npm ci --prefix frontend
npm run build --prefix frontend
uv run python scripts/setup.py
uv run yue2-studio --open
```

默认地址为 <http://127.0.0.1:8765/>。Python 服务直接提供构建后的前端，日常使用无需启动 Vite。首次安装完成后，也可双击 [启动 AI乐之城.command](../scripts/macos/启动%20AI乐之城.command)。

### 可选模型与检查

| 命令 | 用途 |
| --- | --- |
| `uv run python scripts/setup.py` | 下载固定版本的生成器与 VAE，检查运行环境和权重 |
| `uv run python scripts/setup.py --with-cover` | 额外安装音频转谱所需的 SheetSage2 与 MERT |
| `uv run python scripts/setup.py --with-hum` | 额外安装转谱模型与哼唱适配器 |
| `uv run python scripts/setup.py --skip-download` | 只检查，不下载模型 |
| `uv run python scripts/setup.py --skip-download --no-verify-hashes` | 快速检查，跳过权重哈希校验 |

`--with-cover` 指音频改编，与图片封面无关。哼唱创作需要 `--with-hum`；纯音乐还需要将以下两个适配器放入 `models/loras/`，保留文件名：

- [`ar_lora_inst_v3abc.bf16.safetensors`](https://huggingface.co/Mothersuperior/YuE2-instrumental-cot-full-loras)：纯音乐 AR 适配器。
- [`nar_lora_joint_v4.bf16.safetensors`](https://huggingface.co/Mothersuperior/yue2-mothersuperior-realaudio-tokenizer-v4)：配套 NAR 适配器。

默认安装脚本不下载这两个纯音乐适配器；缺少时界面会提示模型尚未就绪。模型权重不随代码分发，各自许可见 [许可与来源](../README.md#许可与来源)。

### 只预览界面

安装 Python 依赖并构建前端后，可跳过音乐模型下载，使用模拟引擎：

```sh
YUE2_STUDIO_HOME=/tmp/ai-music-city-preview uv run yue2-studio --fake --port 8766 --open
```

模拟任务用于体验流程，不生成真实音乐。`--fake` 只替换音乐引擎；助手对话、语音识别和图片分析仍依赖各自的服务。依赖安装仍按上述 Apple Silicon 环境准备。

## 开始创作

首页有三种输入，均可选择「纯音乐」或「带歌词」：

| 入口 | 使用方式 |
| --- | --- |
| 一句话 | 描述主题、心情或想听的曲风；带歌词模式会先准备歌词 |
| 哼一段 | 录制或上传旋律，补充描述后转谱并继续创作 |
| 一张图 | 上传图片，可补充氛围描述；视觉模型将画面转为曲风、节奏和配器方向 |

图片支持 JPG、PNG、WebP，最大 8 MB，需使用支持视觉的 AI 模型。图片在本机校验、缩小并移除元数据，再发送给当前 AI 服务；不会自动作为作品封面。纯音乐模式不生成演唱歌词，使用上文的两个适配器。

提交后进入生成详情页，可查看阶段、进度、用时和结果。切换页面或刷新不会停止已提交的任务。在详情页修改标题、音乐描述、歌词或音乐类型后，点击「生成新版本」创建关联版本，原作品保留；哼唱版本继续使用原录音来源。快捷微调仅填入描述，确认生成后才提交。

使用 Suno 引擎时，微调中的「高级设置」默认收起，可调整 V6 系列模型、避免的风格、人声、时长、风格遵循、创意强度、音频影响、变化幅度及 Persona。留空使用服务默认值，百分比按 0–100% 输入。参数随版本保存；普通纯音乐隐藏人声和音频影响选项，哼唱版本保留音频影响选项，原作品不会被覆盖。字段依据 [Suno 生成接口](https://docs.sunoapi.org/suno-api/generate-music)与[上传音频翻唱接口](https://docs.sunoapi.org/suno-api/upload-and-cover-audio)。

「我的音乐」可按音乐类型筛选作品，并播放、微调、下载或分享。分享使用系统文件分享；浏览器不支持时可下载后发送，目前不生成公开分享链接。

## AI 助手连接

打开「设置 → AI 助手」，或从助手的聊天历史面板进入「助手设置」。填写支持 OpenAI 兼容接口的 Base URL 和 API Key。界面提供 OpenAI、DeepSeek、Kimi 中国内地的快捷地址，也可填写自定义服务；远端地址需使用 HTTPS，本机地址可使用 HTTP。

1. 选择服务商或填写地址和密钥。
2. 点击「测试连接」，检查鉴权和 `/models` 模型列表。
3. 点击「保存配置」，应用到当前账号。

测试不会保存配置或发起对话请求。模型选择只显示当前服务 `/models` 返回的模型，不混入固定目录；是否支持图片仍取决于所选模型。切换服务商只更新表单，不自动保存或发送消息。

已保存的密钥不回显。同一地址留空可保留原密钥，换地址需填写新服务的密钥。「恢复默认」会移除当前账号的个人连接，使用服务器默认配置。

### 对话与创作方案

输入框内可切换模型及「聊天 / 写歌词」。文字、图片、语音及补充描述都可用于交流，快捷灵感只填入输入框。助手先了解想法，在方向完整或用户表示可以生成时给出创作方案卡片，汇总标题、曲风、音乐类型和歌词。点击「生成音乐」才提交任务，也可以继续对话修改方案。

切换站内页面不会中断回复，点击停止按钮才会取消；服务器重启会中断未完成回复。图片附件同样支持 JPG / PNG / WebP、最大 8 MB，处理后的真实像素发送给所选视觉模型。

### 服务器默认连接

新安装可在首次启动前通过以下环境变量设置默认连接：

| 变量 | 内容 |
| --- | --- |
| `AMC_ASSISTANT_BASE_URL` | OpenAI 兼容 API 地址 |
| `AMC_ASSISTANT_MODEL` | 默认模型 ID，需存在于服务返回的模型列表 |
| `AMC_ASSISTANT_API_KEY` | 服务密钥 |

这些变量只用于初始化缺失的服务器配置，不覆盖已有配置。个人连接与服务器默认连接分开保存；管理员更改自己的连接也不会改变其他账号的默认连接。密钥只存于服务端，不通过配置查询接口返回浏览器。

## 可选：助手语音识别

助手语音输入用于转写说话内容；需要保留旋律时使用首页「哼一段」。语音最长 2 分钟、最大 20 MB，可与文字描述一起发送。

安装本地识别依赖与模型：

```sh
uv sync --extra assistant-voice
uv run --extra assistant-voice python scripts/setup_assistant_voice.py
uv run --extra assistant-voice yue2-studio --open
```

脚本下载多语言 faster-whisper base，默认保存在 `data/assistant/whisper-base/`。识别使用 CPU int8，在独立进程中运行，结束后释放模型内存。使用自定义运行目录时，需给安装脚本传入对应的 `--model-dir`，例如 `/path/to/studio/data/assistant/whisper-base`。

本地识别只将转写文字和补充描述发送给对话模型，原始音频保存在当前账号目录供回放；未安装本地识别时，程序会尝试已配置的 Hermes 语音识别服务，其音频处理方式取决于 Hermes 配置。两者都不可用时会提示识别失败。

有效音频没有可转写话语时，可保留为附件继续交流，但助手输入不会分析其中旋律。

## 可选：歌词校准

带歌词作品可在生成后进入本地校准队列，从实际音频识别歌词时间。安装依赖及模型：

```sh
brew install whisper-cpp ffmpeg
uv run python scripts/setup_lyrics.py
```

只检查已有依赖和模型，不下载：

```sh
uv run python scripts/setup_lyrics.py --check
```

模型为 `ggerganov/whisper.cpp` 的多语言 `ggml-small-q5_1.bin`，约 190 MB，保存在 `models/whisper/`。脚本使用固定版本，验证大小和 SHA-256；已有有效文件不会重复下载。下载支持 `HF_ENDPOINT`，模型路径遵循 `YUE2_STUDIO_HOME`。

校准在本机执行，不上传歌曲。可靠的时间点用于同步高亮；滑动歌词只浏览，点击歌词才跳转。未能可靠识别的部分保留静态显示，不按总时长平均分配时间戳。伴奏、口音、漏唱及重复段落可能影响识别效果。

## 账号与本地数据

使用邮箱和密码注册、登录。首个账号必须从运行服务的电脑直接访问 `localhost` 或 `127.0.0.1` 创建，作为管理员继承原有本机作品与对话。之后的账号使用独立空间。

| 位置 | 内容 |
| --- | --- |
| `data/auth/auth.db` | 账号和登录会话 |
| `data/` | 首个账号的原有作品、素材、对话和设置 |
| `data/users/<用户 ID>/` | 其他账号的作品、素材、对话和设置 |
| 各账号的 `assistant/chat-settings.json` | 个人 AI 连接，文件权限为 `0600` |
| `data/assistant/settings.json` | 服务器默认 AI 配置 |
| `models/` | 所有账号共用的模型文件 |

密码采用随机盐与 scrypt 哈希，登录会话使用 HttpOnly Cookie，退出后撤销会话。作品及音频接口要求当前账号登录。账号切换会清空浏览器中的个人草稿与播放状态，已提交的音乐任务继续运行。所有账号共用串行音乐引擎队列。

可用 `YUE2_STUDIO_HOME` 指定运行目录，`data/` 和 `models/` 都位于该目录下。默认使用主仓库根目录；Git worktree 也默认共用主仓库的数据，独立测试时应设置自己的运行目录。

`data/`、`models/`、`logs/`、`.venv/` 与 `node_modules/` 均不提交到 Git。迁移电脑时应单独备份运行数据、重新下载模型并检查连接配置；新克隆的仓库不会恢复个人作品、对话或密钥。

## 开发

```sh
# 终端一：后端
uv run yue2-studio --reload

# 终端二：前端
npm run dev --prefix frontend
```

Vite 默认监听 5173，将 API 和图片资源代理到本机 8765。生产前端由以下构建命令生成：

```sh
npm run check --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
uv run pytest
```

接口见 [API 文档](API.md)，前端开发见 [frontend/README.md](../frontend/README.md)。其他英文使用文档保留了上游界面说明，入口名称和页面布局可能与当前版本不同。
