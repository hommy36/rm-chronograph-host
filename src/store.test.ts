import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";
import { EMPTY_PARAMS } from "./types";

describe("分组管理", () => {
  beforeEach(() => {
    useAppStore.getState().clearAll();
  });

  it("deleteGroup 删除指定组并切走查看焦点", () => {
    const s = useAppStore.getState();
    s.startGroup({ ...EMPTY_PARAMS, stage1_rpm: "405" });
    const g1 = useAppStore.getState().groups[0];
    s.startGroup({ ...EMPTY_PARAMS, stage1_rpm: "410" });
    const g2 = useAppStore.getState().groups[1];
    expect(useAppStore.getState().viewingGroupId).toBe(g2.id);

    useAppStore.getState().deleteGroup(g2.id);
    const st = useAppStore.getState();
    expect(st.groups.map((g) => g.id)).toEqual([g1.id]);
    expect(st.viewingGroupId).toBe(g1.id);
    expect(st.activeGroupId).toBeNull();
  });

  it("删除后不残留对比勾选", () => {
    const s = useAppStore.getState();
    s.startGroup({ ...EMPTY_PARAMS });
    const g1 = useAppStore.getState().groups[0];
    s.startGroup({ ...EMPTY_PARAMS });
    const g2 = useAppStore.getState().groups[1];
    useAppStore.getState().toggleCompare(g1.id);
    useAppStore.getState().toggleCompare(g2.id);
    expect(useAppStore.getState().compareIds).toEqual([g1.id, g2.id]);

    useAppStore.getState().deleteGroup(g2.id);
    expect(useAppStore.getState().compareIds).toEqual([g1.id]);
  });

  it("删掉最后一组后查看焦点清空", () => {
    useAppStore.getState().startGroup({ ...EMPTY_PARAMS });
    const g = useAppStore.getState().groups[0];
    useAppStore.getState().deleteGroup(g.id);
    const st = useAppStore.getState();
    expect(st.groups).toHaveLength(0);
    expect(st.viewingGroupId).toBeNull();
  });

  it("toggleCompare 最多保留两个", () => {
    const s = useAppStore.getState();
    s.startGroup({ ...EMPTY_PARAMS });
    s.startGroup({ ...EMPTY_PARAMS });
    s.startGroup({ ...EMPTY_PARAMS });
    const ids = useAppStore.getState().groups.map((g) => g.id);
    ids.forEach((id) => useAppStore.getState().toggleCompare(id));
    expect(useAppStore.getState().compareIds).toEqual(ids.slice(-2));
  });

  it("组内波形通道分配可写入并随组保留", () => {
    useAppStore.getState().startGroup({ ...EMPTY_PARAMS });
    const id = useAppStore.getState().groups[0].id;
    useAppStore.getState().setGroupWaveConfig(id, {
      groups: [{ id: 1, name: "一级", channels: [0, 2, 4] }],
      channelLabels: { 0: "一1", 2: "一2", 4: "一3" },
      channelCount: 14,
    });
    const g = useAppStore.getState().groups[0];
    expect(g.waveConfig?.groups[0].channels).toEqual([0, 2, 4]);
    expect(g.waveConfig?.channelCount).toBe(14);
    // 组内配置不影响全局默认
    expect(useAppStore.getState().waveConfig.groups).toHaveLength(0);
  });

  it("散布数据写入与清除", () => {
    useAppStore.getState().startGroup({ ...EMPTY_PARAMS });
    const id = useAppStore.getState().groups[0].id;
    useAppStore.getState().setGroupDispersion(id, {
      imageDataUrl: "data:image/jpeg;base64,AAAA",
      effSpec: { name: "A4·横向", w: 297, h: 210 },
      points: [{ x: 10, y: 20 }],
      texts: [],
      updatedAt: 123,
    });
    let g = useAppStore.getState().groups[0];
    expect(g.dispersion?.points).toHaveLength(1);
    expect(g.dispersion?.effSpec.w).toBe(297);

    useAppStore.getState().setGroupDispersion(id, undefined);
    g = useAppStore.getState().groups[0];
    expect(g.dispersion).toBeUndefined();
  });
});
