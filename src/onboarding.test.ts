import { describe, expect, it, vi } from "vitest";
import {
  ONBOARDED_KEY,
  TOUR_STEPS,
  hasOnboarded,
  markOnboarded,
  pickVisibleSteps,
  tourTarget,
} from "./onboarding";
import type { MainView } from "./types";

const VIEWS: MainView[] = ["charts", "details", "dispersion", "overview"];

describe("使用指南步骤", () => {
  it("覆盖 12 步以上，key 唯一、字段完整", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(TOUR_STEPS.map((s) => s.key)).size).toBe(TOUR_STEPS.length);
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.description).toBeTruthy();
      expect(s.view).toBeDefined();
      expect(VIEWS).toContain(s.view);
    }
  });

  it("每个锚点最多被一步使用，锚点名与组件里的 data-tour 约定一致", () => {
    const anchors = TOUR_STEPS.map((s) => s.anchor).filter(Boolean) as string[];
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const a of anchors) {
      expect(a).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("首步是居中说明（没有锚点），四类视图都有对应步骤", () => {
    expect(TOUR_STEPS[0].anchor).toBeUndefined();
    for (const v of VIEWS) {
      expect(TOUR_STEPS.some((s) => s.view === v)).toBe(true);
    }
  });

  it("找不到锚点的步骤会被跳过，没有锚点的步骤始终保留", () => {
    // 图表页的步骤要求锚点在；切视图的步骤留到切过去之后判
    const ready = (s: (typeof TOUR_STEPS)[number]) =>
      s.view !== "charts" || !s.anchor || s.anchor === "live-speed";
    expect(pickVisibleSteps(TOUR_STEPS, ready).map((s) => s.key)).toEqual([
      "welcome",
      "live-speed",
      "shots-table",
      "dispersion-tools",
      "overview-list",
      "overview-timeline",
    ]);
    expect(pickVisibleSteps(TOUR_STEPS, () => true)).toHaveLength(
      TOUR_STEPS.length
    );
    // 全部锚点都缺失时仍能走完（只剩居中说明步骤，不会卡死）
    expect(
      pickVisibleSteps(TOUR_STEPS, (s) => !s.anchor).map((s) => s.key)
    ).toEqual(["welcome"]);
  });

  it("没有 DOM 时取锚点返回 null（服务端/测试环境不会炸）", () => {
    expect(tourTarget("live-speed")).toBeNull();
  });
});

describe("引导记忆标记", () => {
  it("存储不可用时当作已看过，避免每次都弹欢迎框", () => {
    expect(hasOnboarded()).toBe(true);
  });

  it("标记后 hasOnboarded 为真", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      expect(hasOnboarded()).toBe(false);
      markOnboarded();
      expect(hasOnboarded()).toBe(true);
      expect(store.get(ONBOARDED_KEY)).toBe("1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
