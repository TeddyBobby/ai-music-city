# AI乐之城 · React 前端

中文音乐创作与播放界面。使用 React 19、TypeScript、Vite、Mantine 9、React Router、Zustand 和 Lucide。按钮、输入框、下拉菜单、滑块、标签页与弹窗采用 Mantine 组件。

## 启动

完整安装与模型准备见 [根目录 README](../README.md)。在仓库根目录执行：

```sh
npm ci --prefix frontend
npm run build --prefix frontend
uv run yue2-studio --open
```

FastAPI 提供构建后的 `yue2_studio/static/dist/`，日常使用无需启动 Node 开发服务器。安装完成后也可使用 [macOS 启动脚本](../scripts/macos/启动%20AI乐之城.command)。

开发时先运行 Python 服务，再启动 Vite：

```sh
uv run yue2-studio --reload
# 另一个终端
npm run dev --prefix frontend
```

使用终端打印的地址，默认端口为 5173，已占用时递增。API 与图片代理到本机 8765；代理仅为匹配开发主机的同源请求转换 Origin。

```sh
npm run check --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
```

后续前端构建完成后刷新页面即可，无需为样式修改重启 Python 服务。

## 页面与交互

- **首页**：音乐描述输入、灵感卡片、广场 / 封面 / 继续聆听入口、最近作品与动态声波背景。
- **创作与队列**：歌词、曲风、种子、ABC 乐谱和 LoRA 配置，保留草稿；SSE 更新真实阶段进度，支持取消与失败后重新创作。
- **作品与项目**：检索、网格 / 列表切换、下载、批量收录、版本比较、备注与专辑导出。
- **全屏播放**：点击封面或播放条右侧入口展开，从右下角过渡并原路收起；支持播放队列、进度、音量、循环 / 随机、封面与歌词左右切换，以及评分与乐评。收起保留原页面和播放状态。普通歌词没有时间戳，使用静态展示。
- **创作助手**：Hermes 对话与停止回复，结构化歌词和曲风建议，封面候选生成、应用与恢复；窄屏使用抽屉显示历史对话。
- **广场**：单曲、专辑、搜索和排行榜，使用后端本机发布记录；尚未连接互联网多用户社区。
- **外观与导航**：深色、浅色或跟随系统；桌面侧栏可手动收起；移动端仅保留底部导航，主题与用户入口位于「更多」。头像、名称及订阅状态为占位功能。

播放条向下滚动时收起，向上滚动或静止 800ms 后恢复；操作进度、键盘聚焦或打开队列时保持可见。全屏播放器使用 Mantine Modal 管理焦点，尊重减少动态效果偏好。

## 源码入口

- [App.tsx](src/App.tsx)：整体布局、路由与导航。
- [pages/](src/pages/)：各功能页面。
- [components/](src/components/)：共享组件、品牌字标、首页声波、用户与订阅入口。
- [tests/](tests/)：播放器状态、路由和相关功能测试。
- [vite.config.ts](vite.config.ts)：构建输出与开发代理。

前端连接现有 FastAPI 服务；作品、对话、连接配置、评分与发布记录仍由后端保存在 `data/`。AI 参考乐评使用文本与本机音频指标，当前不直接向模型发送音频试听。凭据与运行数据不应提交至仓库。
