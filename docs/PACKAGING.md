# 打包与交付

本次交付为 AI乐之城本地创作平台的源码快照，保留上游 Git 历史与版权声明。GitHub 仓库为私有，上传代码不等于将应用部署到公网。

## 包含内容

- Python / FastAPI 服务、React / TypeScript / Mantine 前端。
- `yue2_studio/static/dist/` 已构建界面，静态图片与品牌素材。
- 测试、依赖锁文件、模型安装脚本、文档。
- `scripts/macos/` 可随仓库移动的启动和停止助手脚本。
- `design/` 历史中文设计稿、Figma 脚本及交接文件。
- `samples/` 两个本机生成的非商业演示音频。
- `docs/archive/` 历史本机使用说明；其中硬件参数与测试记录仅供归档。

## 不包含内容

`models/`、`data/`、`logs/`、`.venv/`、`frontend/node_modules/`、`.env*`、私钥、数据库及缓存不上传。模型权重和适配器在目标机器重新安装；本机作品库、聊天记录、API 密钥及 Hermes 登录状态保留在原电脑。

应用代码与模型及适配器的许可不同，详见根目录 README 与上游说明。

## 本次验证（2026-10-21）

- `.venv/bin/python -m pytest -q`：597 项通过。
- `npm test --prefix frontend`：29 项通过。
- `npm run build --prefix frontend`：通过。
- macOS 启动与停止脚本通过 `zsh -n` 语法检查。
- 上传候选文件无超过 50 MiB 的文件；凭据模式扫描仅命中现有测试中的假密钥。

现有警告：OpenAPI 中 GET/HEAD 路由的 operation ID 重复；Vite 提示部分输出块超过 500 kB。未阻止本次测试与构建；本次未进行新的真实模型推理。

## 重新制作源码包

在提交工作后运行：

```sh
mkdir -p releases
git archive --format=zip --prefix=ai-music-city/ --output=releases/ai-music-city-source.zip HEAD
shasum -a 256 releases/ai-music-city-source.zip
```

此命令只打包已提交文件，不读取本地密钥、数据库或模型目录。
