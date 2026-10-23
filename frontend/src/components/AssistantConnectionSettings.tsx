import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Select } from "@mantine/core";
import {
  assistantApi,
  type AssistantConfig,
  type AssistantStatus,
} from "../lib/assistant";
import {
  assistantConnectionPatch,
  assistantProviders,
  canKeepAssistantKey,
  normalizeAssistantUrl,
  providerForUrl,
} from "../lib/assistantProviders";
import { assistantConversation } from "../lib/assistantConversation";
import { errorMessage } from "../lib/utils";
import { Button, Input } from "./ui";
import "./AssistantConnectionSettings.css";

export function AssistantConnectionSettings() {
  const id = useId();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [operation, setOperation] = useState<"test" | "save" | "reset" | null>(
    null,
  );
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const request = new AbortController();
    activeRequest.current = request;
    setNotice(null);
    assistantApi
      .config(request.signal)
      .then((saved) => {
        if (request.signal.aborted) return;
        setConfig(saved);
        setBaseUrl(saved.hermes_base_url);
        setApiKey("");
      })
      .catch((error) => {
        if (!request.signal.aborted)
          setNotice({ text: errorMessage(error), error: true });
      });
    return () => activeRequest.current?.abort();
  }, [attempt]);

  const busy = operation !== null;
  const keepKey = !!config && canKeepAssistantKey(config, baseUrl);
  const ready = !!config && !!baseUrl.trim() && (!!apiKey.trim() || keepKey);
  const dirty =
    !!config &&
    (normalizeAssistantUrl(baseUrl) !==
      normalizeAssistantUrl(config.hermes_base_url) ||
      !!apiKey.trim());
  const provider = providerForUrl(baseUrl);

  function changeUrl(value: string) {
    setBaseUrl(value);
    setApiKey("");
    setNotice(null);
  }

  function checkMessage(result: AssistantStatus) {
    return result.chat.available
      ? `连接成功${result.chat.model_count != null ? `，发现 ${result.chat.model_count} 个可用模型` : ""}`
      : result.chat.message || "连接失败，请检查服务地址和 API Key。";
  }

  async function run(action: "test" | "save" | "reset") {
    if (!config || busy || (action !== "reset" && !ready)) return;
    const request = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = request;
    setOperation(action);
    setNotice(null);
    try {
      const patch =
        action === "reset"
          ? { hermes_base_url: "" }
          : assistantConnectionPatch(baseUrl, apiKey);
      if (action === "test") {
        const result = await assistantApi.checkConfig(patch, request.signal);
        if (!request.signal.aborted)
          setNotice({
            text: checkMessage(result),
            error: !result.chat.available,
          });
        return;
      }
      const saved = await assistantApi.saveConfig(patch, request.signal);
      if (request.signal.aborted) return;
      setConfig(saved);
      setBaseUrl(saved.hermes_base_url);
      setApiKey("");
      setNotice({ text: action === "reset" ? "已恢复默认服务" : "配置已保存" });
      assistantConversation.setConnected(false);
      void assistantConversation.refreshModels();
      // A failed connectivity check must not suggest the completed save was rolled back.
      try {
        const status = await assistantApi.check(request.signal);
        if (request.signal.aborted) return;
        assistantConversation.setConnected(status.chat.available);
        setNotice({
          text: `${action === "reset" ? "已恢复默认服务" : "配置已保存"}。${checkMessage(status)}`,
          error: !status.chat.available,
        });
      } catch (error) {
        if (!request.signal.aborted)
          setNotice({
            text: `配置已保存。${errorMessage(error)}`,
            error: true,
          });
      }
    } catch (error) {
      if (!request.signal.aborted)
        setNotice({ text: errorMessage(error), error: true });
    } finally {
      if (!request.signal.aborted) setOperation(null);
    }
  }

  if (!config)
    return (
      <div className="assistant-connection-loading">
        <p role={notice?.error ? "alert" : "status"}>
          {notice?.text || "正在读取助手配置…"}
        </p>
        {notice?.error && (
          <Button onClick={() => setAttempt((value) => value + 1)}>
            重新加载
          </Button>
        )}
      </div>
    );

  return (
    <form
      className="assistant-connection"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void run("save");
      }}
    >
      <div className="assistant-connection-row">
        <div className="assistant-connection-label">
          <label htmlFor={`${id}-provider`}>服务商</label>
        </div>
        <Select
          id={`${id}-provider`}
          className="assistant-connection-control"
          value={provider}
          onChange={(value) => {
            if (!value || value === provider) return;
            changeUrl(
              assistantProviders.find((item) => item.id === value)?.baseUrl ||
                "",
            );
          }}
          data={[
            { value: "custom", label: "自定义" },
            ...assistantProviders.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
          allowDeselect={false}
          disabled={busy}
          comboboxProps={{ withinPortal: true, zIndex: 650 }}
        />
      </div>
      <div className="assistant-connection-row">
        <label htmlFor={`${id}-url`}>Base URL</label>
        <Input
          id={`${id}-url`}
          className="assistant-connection-control"
          type="url"
          autoComplete="off"
          spellCheck={false}
          required
          placeholder="https://api.example.com/v1"
          value={baseUrl}
          onChange={(event) => changeUrl(event.target.value)}
          disabled={busy}
        />
      </div>
      <div className="assistant-connection-row">
        <div className="assistant-connection-label">
          <label htmlFor={`${id}-key`}>API Key</label>
          {keepKey && <p>留空保持不变</p>}
        </div>
        <Input
          id={`${id}-key`}
          className="assistant-connection-control"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          placeholder={keepKey ? "已保存 API Key" : "输入 API Key"}
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            setNotice(null);
          }}
          disabled={busy}
        />
      </div>
      <div className="assistant-connection-footer">
        {(notice || config.source === "default") && (
          <div className="assistant-connection-status">
            {!notice && (
              <p>{config.default_configured ? "使用默认服务" : "未配置服务"}</p>
            )}
            {notice && (
              <p
                className={notice.error ? "is-error" : "is-success"}
                role={notice.error ? "alert" : "status"}
              >
                {notice.text}
              </p>
            )}
          </div>
        )}
        <div className="assistant-connection-actions">
          {config.source === "custom" && config.default_configured && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run("reset")}
            >
              恢复默认
            </Button>
          )}
          <Button disabled={busy || !ready} onClick={() => void run("test")}>
            {operation === "test" ? "测试中…" : "测试连接"}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !ready || !dirty}
          >
            {operation === "save" ? "保存中…" : "保存配置"}
          </Button>
        </div>
      </div>
    </form>
  );
}
