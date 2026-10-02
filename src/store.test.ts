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

  it("toggleCompare 可勾选多组，再点取消勾选", () => {
    const s = useAppStore.getState();
    s.startGroup({ ...EMPTY_PARAMS });
    s.startGroup({ ...EMPTY_PARAMS });
    s.startGroup({ ...EMPTY_PARAMS });
    const ids = useAppStore.getState().groups.map((g) => g.id);
    ids.forEach((id) => useAppStore.getState().toggleCompare(id));
    // 不再限制两组，勾选顺序即列顺序
    expect(useAppStore.getState().compareIds).toEqual(ids);
    useAppStore.getState().toggleCompare(ids[1]);
    expect(useAppStore.getState().compareIds).toEqual([ids[0], ids[2]]);
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

describe("测试 → 组 两级结构", () => {
  beforeEach(() => {
    useAppStore.getState().clearAll();
  });

  it("新建测试、组编号按测试内递增", () => {
    const st = () => useAppStore.getState();
    const t1 = st().startTest();
    expect(st().tests).toHaveLength(1);
    expect(st().tests[0].name).toBe("第1次测试");
    expect(st().activeTestId).toBe(t1);

    st().startGroup({ ...EMPTY_PARAMS });
    st().endGroup();
    st().startGroup({ ...EMPTY_PARAMS });
    const g1 = st().groups.filter((g) => g.testId === t1);
    expect(g1.map((g) => g.name)).toEqual(["组1", "组2"]);
    expect(g1.every((g) => g.testId === t1)).toBe(true);

    // 第二个测试里编号重新从组1开始
    const t2 = st().startTest("第二次测试");
    st().startGroup({ ...EMPTY_PARAMS });
    const g2 = st().groups.filter((g) => g.testId === t2);
    expect(g2.map((g) => g.name)).toEqual(["组1"]);
    expect(st().activeTestId).toBe(t2);
  });

  it("重命名测试与组", () => {
    const st = () => useAppStore.getState();
    const t = st().startTest();
    st().startGroup({ ...EMPTY_PARAMS });
    const g = st().groups[0];
    st().renameTest(t, "夜间测试");
    st().renameGroup(g.id, "组A");
    expect(st().tests[0].name).toBe("夜间测试");
    expect(st().groups[0].name).toBe("组A");
    // 空名字不覆盖
    st().renameTest(t, "   ");
    expect(st().tests[0].name).toBe("夜间测试");
  });

  it("切测试时查看焦点跟随，勾选对比被清理", () => {
    const st = () => useAppStore.getState();
    const t1 = st().startTest();
    st().startGroup({ ...EMPTY_PARAMS });
    const g1 = st().groups.filter((g) => g.testId === t1);
    st().toggleCompare(g1[0].id);

    const t2 = st().startTest();
    st().startGroup({ ...EMPTY_PARAMS });
    const g2 = st().groups.filter((g) => g.testId === t2);
    expect(st().viewingGroupId).toBe(g2[0].id);
    expect(st().compareIds).toEqual([]); // 跨测试的勾选被清掉

    st().setActiveTest(t1);
    expect(st().viewingGroupId).toBe(g1[0].id);
  });

  it("删除测试连带删除其下所有组", () => {
    const st = () => useAppStore.getState();
    const t1 = st().startTest();
    st().startGroup({ ...EMPTY_PARAMS });
    st().endGroup();
    st().startGroup({ ...EMPTY_PARAMS });
    const t2 = st().startTest();
    st().startGroup({ ...EMPTY_PARAMS });

    st().deleteTest(t1);
    expect(st().tests.map((t) => t.id)).toEqual([t2]);
    expect(st().groups.some((g) => g.testId === t1)).toBe(false);
    expect(st().activeTestId).toBe(t2);
    expect(st().groups.filter((g) => g.testId === t2)).toHaveLength(1);

    // 删掉最后一个测试后回到空态
    st().deleteTest(t2);
    expect(st().tests).toHaveLength(0);
    expect(st().groups).toHaveLength(0);
    expect(st().activeTestId).toBeNull();
    expect(st().viewingGroupId).toBeNull();
  });

  it("备注可写入测试与组，清空后测试不留空字段", () => {
    const st = () => useAppStore.getState();
    const t = st().startTest();
    st().startGroup({ ...EMPTY_PARAMS, note: "建组时写的备注" });
    const g = st().groups[0];
    expect(g.params.note).toBe("建组时写的备注");

    st().setTestNote(t, "  设备 A，室温 25℃  ");
    expect(st().tests[0].note).toBe("设备 A，室温 25℃");
    st().setGroupNote(g.id, "换新摩擦轮");
    expect(st().groups[0].params.note).toBe("换新摩擦轮");

    st().setTestNote(t, "   ");
    expect(st().tests[0].note).toBeUndefined();
    st().setGroupNote(g.id, "");
    expect(st().groups[0].params.note).toBe("");
  });

  it("没有测试时点开始新组会自动建测试", () => {
    const st = () => useAppStore.getState();
    expect(st().tests).toHaveLength(0);
    st().startGroup({ ...EMPTY_PARAMS });
    expect(st().tests).toHaveLength(1);
    expect(st().groups[0].testId).toBe(st().tests[0].id);
    expect(st().groups[0].name).toBe("组1");
  });
});
