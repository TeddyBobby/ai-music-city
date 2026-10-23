import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { StudioProvider } from "./components/StudioProvider";
import "@mantine/core/styles.css";
import "./styles.css";
import "./Product.css";
import "./mobile.css";
import "./pages/Auth.css";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: any) {
    console.error("工作台页面错误", error);
  }
  render() {
    return this.state.error ? (
      <div style={{ padding: 40 }}>
        <h1>页面暂时遇到问题</h1>
        <p>已保存的作品不受影响，请刷新重试。</p>
        <button className="btn" onClick={() => location.reload()}>
          刷新页面
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <ErrorBoundary>
    <StudioProvider>
      <App />
    </StudioProvider>
  </ErrorBoundary>,
);
