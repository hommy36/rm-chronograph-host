import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BlockOutlined,
  BorderOutlined,
  CloseOutlined,
  MinusOutlined,
} from "@ant-design/icons";
import { isTauri } from "../api";

/** 自定义窗口操作按钮（无边框窗口用）：最小化 / 最大化·还原 / 关闭 */
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized);
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  if (!isTauri()) return null;
  const win = getCurrentWindow();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        paddingRight: 20,
        flexShrink: 0,
      }}
    >
      <button
        className="wc-btn"
        title="最小化"
        onClick={() => win.minimize()}
      >
        <MinusOutlined />
      </button>
      <button
        className="wc-btn"
        title={maximized ? "还原" : "最大化"}
        onClick={async () => {
          await win.toggleMaximize();
          setMaximized(await win.isMaximized());
        }}
      >
        {maximized ? <BlockOutlined /> : <BorderOutlined />}
      </button>
      <button
        className="wc-btn wc-close"
        title="关闭"
        onClick={() => win.close()}
      >
        <CloseOutlined />
      </button>
    </div>
  );
}
